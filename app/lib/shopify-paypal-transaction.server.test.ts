import assert from "node:assert/strict";
import test from "node:test";
import {
  PayPalTransactionLookupError,
  resolvePayPalTransactionId,
  type ShopifyPayPalTransaction,
} from "./shopify-paypal-transaction.server";

function payment(
  overrides: Partial<ShopifyPayPalTransaction> = {},
): ShopifyPayPalTransaction {
  return {
    gateway: "paypal",
    kind: "SALE",
    status: "SUCCESS",
    authorizationCode: "8MC585209K746392H",
    test: true,
    ...overrides,
  };
}

test("uses a PayPal provider reference from the successful sale, not an authorization or refund", () => {
  assert.equal(resolvePayPalTransactionId([
    payment({ kind: "AUTHORIZATION", authorizationCode: "53Y56775AE587553X" }),
    payment(),
    payment({ kind: "REFUND", authorizationCode: "53Y56775AE587553X" }),
  ], "sandbox"), "8MC585209K746392H");
});

test("requires a PayPal payment instead of accepting a manually paid or Bogus order", () => {
  for (const gateway of ["bogus", "manual", "shopify_payments"]) {
    assert.throws(
      () => resolvePayPalTransactionId([payment({ gateway })], "sandbox"),
      (error: unknown) => error instanceof PayPalTransactionLookupError && error.reason === "paypal_payment_not_found",
    );
  }
});

test("rejects Live Shopify payments when using Sandbox and test payments when using Live", () => {
  for (const [testPayment, environment] of [[false, "sandbox"], [true, "production"]] as const) {
    assert.throws(
      () => resolvePayPalTransactionId([payment({ test: testPayment })], environment),
      (error: unknown) => error instanceof PayPalTransactionLookupError && error.reason === "paypal_environment_mismatch",
    );
  }
});

test("fails safely if the provider reference is missing or is a Shopify payment ID", () => {
  for (const authorizationCode of [null, "", "#1001.1", "gid://shopify/OrderTransaction/1"]) {
    assert.throws(
      () => resolvePayPalTransactionId([payment({ authorizationCode })], "sandbox"),
      (error: unknown) => error instanceof PayPalTransactionLookupError && error.reason === "paypal_provider_reference_unavailable",
    );
  }
});

test("requires explicit association when the order has multiple distinct PayPal captures", () => {
  assert.throws(
    () => resolvePayPalTransactionId([
      payment({ kind: "CAPTURE" }),
      payment({ kind: "CAPTURE", authorizationCode: "53Y56775AE587553X" }),
    ], "sandbox"),
    (error: unknown) => error instanceof PayPalTransactionLookupError && error.reason === "paypal_multiple_payments",
  );
});
