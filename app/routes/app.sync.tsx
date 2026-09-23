import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { queueFulfillmentTracking } from "../models/sync-log.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface EligibleOrdersResponse {
  data?: {
    orders?: {
      nodes: Array<{
        legacyResourceId: string | number | null;
        fulfillments: {
          nodes: Array<{
            legacyResourceId: string | number | null;
            trackingInfo: Array<{ company: string | null; number: string | null }>;
          }>;
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const MAX_INITIAL_SYNC_ORDERS = 100;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopConfig = await db.shopConfig.findUnique({
    where: { shopDomain: session.shop },
    select: { paypalConnectionStatus: true },
  });

  if (shopConfig?.paypalConnectionStatus !== "CONNECTED") {
    return redirect("/app?sync=not-connected");
  }

  const response = await admin.graphql(
    `#graphql
      query SyncPalEligibleFulfillments($first: Int!) {
        orders(first: $first, query: "fulfillment_status:fulfilled", sortKey: UPDATED_AT, reverse: true) {
          nodes {
            legacyResourceId
            fulfillments(first: 100) {
              nodes {
                legacyResourceId
                trackingInfo(first: 20) {
                  company
                  number
                }
              }
            }
          }
        }
      }`,
    { variables: { first: MAX_INITIAL_SYNC_ORDERS } },
  );
  const result = (await response.json()) as EligibleOrdersResponse;

  if (result.errors?.length) {
    return redirect("/app?sync=lookup-failed");
  }

  let queued = 0;
  for (const order of result.data?.orders?.nodes ?? []) {
    if (!order.legacyResourceId) {
      continue;
    }

    for (const fulfillment of order.fulfillments.nodes) {
      if (!fulfillment.legacyResourceId) {
        continue;
      }

      for (const tracking of fulfillment.trackingInfo) {
        const trackingCompany = tracking.company?.trim();
        const trackingNumber = tracking.number?.trim();
        if (!trackingCompany || !trackingNumber) {
          continue;
        }

        const wasQueued = await queueFulfillmentTracking({
          shopDomain: session.shop,
          orderId: String(order.legacyResourceId),
          fulfillmentId: String(fulfillment.legacyResourceId),
          trackingNumber,
          trackingCompany,
        });
        if (wasQueued) {
          queued += 1;
        }
      }
    }
  }

  return redirect(`/app?sync=queued&count=${queued}`);
};
