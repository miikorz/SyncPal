import type { ActionFunctionArgs } from "react-router";
import { enqueuePayPalSync } from "../lib/paypal-sync-queue.server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

interface FulfillmentWebhookPayload {
  id?: number | string;
  order_id?: number | string;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
}

function getTrackingNumbers(payload: FulfillmentWebhookPayload): string[] {
  const candidates = [
    ...(payload.tracking_numbers ?? []),
    ...(payload.tracking_number ? [payload.tracking_number] : []),
  ];

  return [...new Set(candidates.map((number) => number.trim()).filter(Boolean))];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await authenticate.webhook(request);
  const fulfillment = payload as FulfillmentWebhookPayload;
  const orderId = fulfillment.order_id?.toString();
  const fulfillmentId = fulfillment.id?.toString();
  const trackingNumbers = getTrackingNumbers(fulfillment);

  if (!orderId || !fulfillmentId || trackingNumbers.length === 0) {
    return new Response(null, { status: 200 });
  }

  const shopConfig = await db.shopConfig.findUnique({
    where: { shopDomain: shop },
    select: { paypalConnectionStatus: true },
  });

  if (shopConfig?.paypalConnectionStatus !== "CONNECTED") {
    return new Response(null, { status: 200 });
  }

  for (const trackingNumber of trackingNumbers) {
    const syncLog = await db.syncLog.upsert({
      where: {
        shopDomain_fulfillmentId_trackingNumber: {
          shopDomain: shop,
          fulfillmentId,
          trackingNumber,
        },
      },
      create: {
        shopDomain: shop,
        orderId,
        fulfillmentId,
        trackingNumber,
      },
      update: {},
    });

    if (syncLog.status === "PENDING") {
      await enqueuePayPalSync({
        syncLogId: syncLog.id,
        shopDomain: shop,
        orderId,
        fulfillmentId,
        trackingNumber,
        ...(fulfillment.tracking_company
          ? { trackingCompany: fulfillment.tracking_company }
          : {}),
      });
    }
  }

  return new Response(null, { status: 200 });
};