import db from "../db.server";
import { Prisma } from "@prisma/client";
import { enqueuePayPalSync } from "../lib/paypal-sync-queue.server";

interface QueueTrackingInput {
  shopDomain: string;
  orderId: string;
  fulfillmentId: string;
  trackingNumber: string;
  trackingCompany: string;
}

export async function queueFulfillmentTracking(
  input: QueueTrackingInput,
): Promise<boolean> {
  const syncLog = await db.syncLog.upsert({
    where: {
      shopDomain_fulfillmentId_trackingNumber: {
        shopDomain: input.shopDomain,
        fulfillmentId: input.fulfillmentId,
        trackingNumber: input.trackingNumber,
      },
    },
    create: input,
    update: { trackingCompany: input.trackingCompany },
  });

  if (syncLog.status !== "PENDING") {
    return false;
  }

  await enqueuePayPalSync({
    syncLogId: syncLog.id,
    ...input,
  });

  return true;
}

export async function retryFailedSyncLog(
  shopDomain: string,
  syncLogId: string,
  trackingCompany: string,
): Promise<boolean> {
  const syncLog = await db.syncLog.findFirst({
    where: { id: syncLogId, shopDomain, status: "FAILED" },
  });

  if (!syncLog) {
    return false;
  }

  const normalizedTrackingCompany = trackingCompany.trim();
  if (!normalizedTrackingCompany) {
    throw new Error("A shipping carrier is required to retry this synchronization");
  }

  await db.syncLog.update({
    where: { id: syncLog.id },
    data: {
      status: "PENDING",
      retryCount: 0,
      trackingCompany: normalizedTrackingCompany,
      rawResponse: Prisma.JsonNull,
    },
  });

  await enqueuePayPalSync(
    {
      syncLogId: syncLog.id,
      shopDomain,
      orderId: syncLog.orderId,
      fulfillmentId: syncLog.fulfillmentId,
      trackingNumber: syncLog.trackingNumber,
      trackingCompany: normalizedTrackingCompany,
    },
    { replaceExisting: true },
  );

  return true;
}
