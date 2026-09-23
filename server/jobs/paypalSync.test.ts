import assert from "node:assert/strict";
import test from "node:test";
import type { Job } from "bullmq";
import type { Prisma, ShopConfig } from "@prisma/client";
import type { PayPalSyncJobData } from "../../app/lib/paypal-sync-queue.server";

process.env.SHOPIFY_API_KEY ??= "test-key";
process.env.SHOPIFY_API_SECRET ??= "test-secret";
process.env.SHOPIFY_APP_URL ??= "https://example.com";
process.env.SCOPES ??= "read_orders,read_fulfillments";

const { processPayPalSyncJobWithDependencies } = await import("./paypalSync");

function createShopConfig(): ShopConfig {
  const now = new Date();

  return {
    shopDomain: "example.myshopify.com",
    paypalConnectionStatus: "CONNECTED",
    paypalMerchantId: "MERCHANT-1",
    paypalAccessToken: "encrypted-access-token",
    paypalRefreshToken: "encrypted-refresh-token",
    paypalTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    subscriptionStatus: "PENDING",
    trialEndsAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

test("passes the Shopify carrier to PayPal and records success", async () => {
  const shopConfig = createShopConfig();
  const updates: Array<{
    id: string;
    data: Prisma.SyncLogUpdateArgs["data"];
  }> = [];
  let trackingArguments: unknown[] = [];

  const job = {
    data: {
      syncLogId: "sync-log-1",
      shopDomain: shopConfig.shopDomain,
      orderId: "1001",
      fulfillmentId: "2001",
      trackingNumber: "TRACK-1",
      trackingCompany: "UPS",
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as Job<PayPalSyncJobData>;

  await processPayPalSyncJobWithDependencies(job, {
    getShopConfig: async () => shopConfig,
    findTransactionId: async () => "PAYPAL-TX-1",
    addTracking: async (...args) => {
      trackingArguments = args;
      return { tracker_identifiers: [] };
    },
    updateSyncLog: async (id, data) => {
      updates.push({ id, data });
    },
  });

  assert.deepEqual(trackingArguments, [
    shopConfig,
    "PAYPAL-TX-1",
    "TRACK-1",
    "UPS",
  ]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.id, "sync-log-1");
  assert.equal(updates[0]?.data.status, "SUCCESS");
  assert.equal(updates[0]?.data.retryCount, 1);
});
