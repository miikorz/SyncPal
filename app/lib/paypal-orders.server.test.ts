import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { ShopConfig } from "@prisma/client";
import { addPayPalOrderTracking } from "./paypal-orders.server";
import { PayPalRequestError } from "./paypal.server";

const originalFetch = globalThis.fetch;
const environmentKeys = [
  "PAYPAL_ENVIRONMENT",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_PARTNER_ATTRIBUTION_ID",
] as const;
const previousEnvironment = environmentKeys.map((key) => process.env[key]);
const captureId = "1KP04409DE262003N";
const orderId = "7W418369W11889701";
const merchantId = "59S9BNM2PWNXQ";
const trackerId = `${captureId}-TRACK-1`;
const shop = {
  paypalConnectionStatus: "CONNECTED",
  paypalMerchantId: merchantId,
} as ShopConfig;

beforeEach(() => {
  process.env.PAYPAL_ENVIRONMENT = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "test-bn";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  environmentKeys.forEach((key, index) => {
    if (previousEnvironment[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnvironment[index];
  });
});

function order(
  trackers: Array<{ id: string; status: string }> = [],
  seller = merchantId,
) {
  return {
    id: orderId,
    purchase_units: [
      {
        payee: { merchant_id: seller },
        payments: { captures: [{ id: captureId, status: "COMPLETED" }] },
        shipping: { trackers },
      },
    ],
  };
}

function mockRequests(before: unknown, after: unknown, postStatus = 201) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let reads = 0;
  globalThis.fetch = async (input, init) => {
    const url = input.toString();
    requests.push({ url, init });
    let body: unknown;
    let status = 200;
    if (url.endsWith("/v1/oauth2/token"))
      body = { access_token: "test-token", expires_in: 3600 };
    else if (url.includes("/v2/payments/captures/"))
      body = {
        id: captureId,
        status: "COMPLETED",
        supplementary_data: { related_ids: { order_id: orderId } },
      };
    else if (url.endsWith("/track")) {
      status = postStatus;
      body =
        status < 400
          ? order()
          : {
              name: "NOT_AUTHORIZED",
              details: [{ issue: "PERMISSION_DENIED", value: "private-value" }],
            };
    } else body = reads++ === 0 ? before : after;
    return new Response(JSON.stringify(body), { status });
  };
  return requests;
}

test("resolves the capture's order and independently verifies tracking before success", async () => {
  const requests = mockRequests(
    order(),
    order([{ id: trackerId, status: "SHIPPED" }]),
  );
  const result = await addPayPalOrderTracking(
    shop,
    captureId,
    "TRACK-1",
    "UPS",
  );
  assert.deepEqual(result, {
    api: "orders_v2",
    paypalOrderId: orderId,
    captureId,
    verifiedTracker: { id: trackerId, status: "SHIPPED" },
  });
  assert.equal(requests.length, 5);
  assert.equal(
    requests[3].url,
    `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/track`,
  );
  assert.deepEqual(JSON.parse(requests[3].init?.body as string), {
    capture_id: captureId,
    tracking_number: "TRACK-1",
    carrier: "UPS",
    notify_payer: false,
  });
  assert.equal(requests[4].init?.method, "GET");
});

test("does not post again when a previous attempt already stored this tracker", async () => {
  const existing = order([{ id: trackerId, status: "DELIVERED" }]);
  const requests = mockRequests(existing, existing);
  await addPayPalOrderTracking(shop, captureId, "TRACK-1", "UPS");
  assert.equal(requests.filter(({ url }) => url.endsWith("/track")).length, 0);
});

test("refuses a different seller before sending tracking", async () => {
  const requests = mockRequests(order([], "OTHERSELLER01"), order());
  await assert.rejects(
    addPayPalOrderTracking(shop, captureId, "TRACK-1", "UPS"),
    (error: unknown) => error instanceof PayPalRequestError && !error.retryable,
  );
  assert.equal(
    requests.some(({ url }) => url.endsWith("/track")),
    false,
  );
});

test("does not report success when the POST succeeds but read-back has another tracker", async () => {
  mockRequests(order(), order([{ id: "ANOTHER-TRACKER", status: "SHIPPED" }]));
  await assert.rejects(
    addPayPalOrderTracking(shop, captureId, "TRACK-1", "UPS"),
    (error: unknown) => error instanceof PayPalRequestError && error.retryable,
  );
});

test("authorization errors are terminal and exclude raw payment details", async () => {
  mockRequests(order(), order(), 403);
  await assert.rejects(
    addPayPalOrderTracking(shop, captureId, "TRACK-1", "UPS"),
    (error: unknown) =>
      error instanceof PayPalRequestError &&
      !error.retryable &&
      error.statusCode === 403 &&
      !JSON.stringify(error.details).includes("private-value"),
  );
});
