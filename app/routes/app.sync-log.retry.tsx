import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import db from "../db.server";
import { retryFailedSyncLog } from "../models/sync-log.server";
import { authenticate } from "../shopify.server";

interface FulfillmentTrackingResponse {
  data?: {
    fulfillment?: {
      trackingInfo: Array<{ company: string | null; number: string | null }>;
    } | null;
  };
}

async function findTrackingCompany(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  fulfillmentId: string,
  trackingNumber: string,
): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      query SyncPalFulfillmentTracking($id: ID!) {
        fulfillment(id: $id) {
          trackingInfo(first: 20) {
            company
            number
          }
        }
      }`,
    { variables: { id: `gid://shopify/Fulfillment/${fulfillmentId}` } },
  );
  const result = (await response.json()) as FulfillmentTrackingResponse;
  const tracking = result.data?.fulfillment?.trackingInfo.find(
    ({ number }) => number === trackingNumber,
  );

  return tracking?.company?.trim() || null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const syncLogId = formData.get("syncLogId");

  if (typeof syncLogId !== "string" || !syncLogId) {
    return redirect("/app/history?retry=unavailable");
  }

  const syncLog = await db.syncLog.findFirst({
    where: { id: syncLogId, shopDomain: session.shop, status: "FAILED" },
    select: {
      fulfillmentId: true,
      trackingNumber: true,
      trackingCompany: true,
    },
  });
  if (!syncLog) {
    return redirect("/app/history?retry=unavailable");
  }

  const trackingCompany =
    syncLog.trackingCompany ??
    (await findTrackingCompany(
      admin,
      syncLog.fulfillmentId,
      syncLog.trackingNumber,
    ));
  if (!trackingCompany) {
    return redirect("/app/history?retry=carrier-unavailable");
  }

  const queued = await retryFailedSyncLog(
    session.shop,
    syncLogId,
    trackingCompany,
  );

  return redirect(`/app/history?retry=${queued ? "queued" : "unavailable"}`);
};
