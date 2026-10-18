import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { ShopConfig } from "@prisma/client";
import {
  addPayPalTracking,
  buildPayPalTracker,
  createPayPalPartnerReferral,
  getPayPalBaseUrl,
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

test("does not require the legacy tracking feature for Orders v2 onboarding", async () => {
  let referralBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    if (input.toString().endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "platform-access-token", expires_in: 3600 }), { status: 200 });
    }
    referralBody = JSON.parse(init?.body as string) as Record<string, unknown>;
    return new Response(JSON.stringify({
      links: [{ rel: "action_url", href: "https://www.sandbox.paypal.com/onboarding" }],
    }), { status: 201 });
  };
  assert.equal(
    await createPayPalPartnerReferral("test-state", "https://example.com/return"),
    "https://www.sandbox.paypal.com/onboarding",
  );
  assert.deepEqual(referralBody?.operations, [{
    operation: "API_INTEGRATION",
    api_integration_preference: {
      rest_api_integration: {
        integration_method: "PAYPAL",
        integration_type: "THIRD_PARTY",
        third_party_details: { features: ["PAYMENT", "REFUND"] },
      },
    },
  }]);
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

    if (requests.length === 3) {
      return new Response(JSON.stringify({
        transaction_id: "TX-1",
        tracking_number: "TRACK-1",
        status: "SHIPPED",
        carrier: "OTHER",
      }), { status: 200 });
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
  assert.equal(requests.length, 3);
  assert.equal(requests[2]?.url, "https://api-m.sandbox.paypal.com/v1/shipping/trackers/TX-1-TRACK-1");
});

test("does not report success when PayPal omits the requested tracker", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1
      ? { access_token: "platform-access-token", expires_in: 3600 }
      : { tracker_identifiers: [] }), { status: 200 });
  };
  await assert.rejects(
    addPayPalTracking(createConnectedShopConfig(), "TX-1", "TRACK-1", "UPS"),
    (error: unknown) => error instanceof PayPalRequestError && error.retryable,
  );
});

test("does not report success when read-back belongs to a different shipment", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const bodies = [
      { access_token: "platform-access-token", expires_in: 3600 },
      { tracker_identifiers: [{ transaction_id: "TX-1", tracking_number: "TRACK-1" }] },
      { transaction_id: "TX-OTHER", tracking_number: "TRACK-1", status: "SHIPPED" },
    ];
    return new Response(JSON.stringify(bodies[calls - 1]), { status: 200 });
  };
  await assert.rejects(
    addPayPalTracking(createConnectedShopConfig(), "TX-1", "TRACK-1", "UPS"),
    (error: unknown) => error instanceof PayPalRequestError && error.retryable,
  );
});

test("selects PayPal endpoints explicitly and independently from Node's environment", () => {
  const originalNodeEnvironment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    process.env.PAYPAL_ENVIRONMENT = "sandbox";
    assert.equal(getPayPalBaseUrl(), "https://api-m.sandbox.paypal.com");
    process.env.PAYPAL_ENVIRONMENT = "production";
    assert.equal(getPayPalBaseUrl(), "https://api-m.paypal.com");
    process.env.PAYPAL_ENVIRONMENT = "live";
    assert.throws(() => getPayPalBaseUrl());
  } finally {
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
  }
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
