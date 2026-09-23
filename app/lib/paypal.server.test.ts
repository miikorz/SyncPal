import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { ShopConfig } from "@prisma/client";
import {
  addPayPalTracking,
  buildPayPalTracker,
  PayPalRequestError,
} from "./paypal.server";

const originalEnvironment = process.env.PAYPAL_ENVIRONMENT;
const originalClientId = process.env.PAYPAL_CLIENT_ID;
const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
const originalPartnerAttributionId = process.env.PAYPAL_PARTNER_ATTRIBUTION_ID;
const originalFetch = globalThis.fetch;

function createConnectedShopConfig(): ShopConfig {
  const now = new Date();

  return {
    shopDomain: "example.myshopify.com",
    paypalConnectionStatus: "CONNECTED",
    paypalMerchantId: "MERCHANT-1",
    paypalAccessToken: null,
    paypalRefreshToken: null,
    paypalTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    subscriptionStatus: "PENDING",
    trialEndsAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "platform-client-id";
  process.env.PAYPAL_CLIENT_SECRET = "platform-client-secret";
  process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "partner-bn-code";
});

afterEach(() => {
  process.env.PAYPAL_ENVIRONMENT = originalEnvironment;
  process.env.PAYPAL_CLIENT_ID = originalClientId;
  process.env.PAYPAL_CLIENT_SECRET = originalClientSecret;
  process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = originalPartnerAttributionId;
  globalThis.fetch = originalFetch;
});

test("maps known global carriers to PayPal values", () => {
  assert.deepEqual(buildPayPalTracker("TX-1", "TRACK-1", "UPS"), {
    transaction_id: "TX-1",
    tracking_number: "TRACK-1",
    tracking_number_type: "CARRIER_PROVIDED",
    status: "SHIPPED",
    carrier: "UPS",
  });
});

test("uses OTHER while preserving an unknown carrier name", () => {
  assert.deepEqual(
    buildPayPalTracker("TX-1", "TRACK-1", "Local Courier"),
    {
      transaction_id: "TX-1",
      tracking_number: "TRACK-1",
      tracking_number_type: "CARRIER_PROVIDED",
      status: "SHIPPED",
      carrier: "OTHER",
      carrier_name_other: "Local Courier",
    },
  );
});

test("posts tracking information to the batch endpoint", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];

  globalThis.fetch = async (input, init) => {
    requests.push({ url: input.toString(), init });

    if (requests.length === 1) {
      return new Response(
        JSON.stringify({ access_token: "platform-access-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        tracker_identifiers: [
          { transaction_id: "TX-1", tracking_number: "TRACK-1" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  await addPayPalTracking(
    createConnectedShopConfig(),
    "TX-1",
    "TRACK-1",
    "Local Courier",
  );

  assert.equal(
    requests[1]?.url,
    "https://api-m.sandbox.paypal.com/v1/shipping/trackers-batch",
  );
  assert.equal(requests[1]?.init?.method, "POST");
  assert.equal(
    new Headers(requests[1]?.init?.headers).get("PayPal-Partner-Attribution-Id"),
    "partner-bn-code",
  );
  assert.deepEqual(JSON.parse(requests[1]?.init?.body as string), {
    trackers: [
      {
        transaction_id: "TX-1",
        tracking_number: "TRACK-1",
        tracking_number_type: "CARRIER_PROVIDED",
        status: "SHIPPED",
        carrier: "OTHER",
        carrier_name_other: "Local Courier",
      },
    ],
  });
});

test("treats errors in a successful batch response as a failed sync", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;

    return calls === 1
      ? new Response(
          JSON.stringify({ access_token: "platform-access-token", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      : new Response(
          JSON.stringify({
            errors: [
              {
                name: "RESOURCE_NOT_FOUND",
                message: "The specified resource does not exist.",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
  };

  await assert.rejects(
    addPayPalTracking(
      createConnectedShopConfig(),
      "TX-1",
      "TRACK-1",
      "UPS",
    ),
    (error: unknown) =>
      error instanceof PayPalRequestError && error.retryable === false,
  );
});
