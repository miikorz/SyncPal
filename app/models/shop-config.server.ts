import { removePendingJobsForShop } from "../lib/paypal-sync-queue.server";
import db from "../db.server";

export async function disconnectPayPal(shopDomain: string): Promise<void> {
  await db.shopConfig.update({
    where: { shopDomain },
    data: {
      paypalConnectionStatus: "DISCONNECTED",
      paypalAccessToken: null,
      paypalRefreshToken: null,
      paypalTokenExpiresAt: null,
    },
  });

  await removePendingJobsForShop(shopDomain);

  await db.syncLog.updateMany({
    where: {
      shopDomain,
      status: "PENDING",
    },
    data: {
      status: "FAILED",
      rawResponse: {
        message: "PayPal was disconnected before synchronization",
        details: { reason: "paypal_disconnected" },
      },
    },
  });
}