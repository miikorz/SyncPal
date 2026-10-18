import assert from "node:assert/strict";
import test from "node:test";
import { resolveSandboxCaptureBinding } from "./paypal-sandbox-binding.server";

const binding = {
  shopDomain: "example.myshopify.com",
  shopifyOrderId: "1001",
  paypalMerchantId: "59S9BNM2PWNXQ",
  captureId: "1KP04409DE262003N",
};
const configuration = JSON.stringify([binding]);
const input = {
  shopDomain: binding.shopDomain,
  orderId: binding.shopifyOrderId,
  merchantId: binding.paypalMerchantId,
  isTestOrder: true,
  environment: "sandbox" as const,
};

test("explicit bindings are scoped to a test order, shop and seller", () => {
  assert.equal(
    resolveSandboxCaptureBinding(input, configuration),
    binding.captureId,
  );
  assert.equal(
    resolveSandboxCaptureBinding(
      { ...input, shopDomain: "other.myshopify.com" },
      configuration,
    ),
    null,
  );
  assert.equal(
    resolveSandboxCaptureBinding({ ...input, orderId: "1002" }, configuration),
    null,
  );
  assert.throws(() =>
    resolveSandboxCaptureBinding(
      { ...input, merchantId: "OTHERMERCHANT" },
      configuration,
    ),
  );
  assert.throws(() =>
    resolveSandboxCaptureBinding(
      { ...input, isTestOrder: false },
      configuration,
    ),
  );
});

test("Live, malformed, duplicate and reused-capture bindings fail closed", () => {
  assert.throws(() =>
    resolveSandboxCaptureBinding(
      { ...input, environment: "production" },
      configuration,
    ),
  );
  assert.equal(
    resolveSandboxCaptureBinding({ ...input, environment: "production" }, ""),
    null,
  );
  assert.throws(() => resolveSandboxCaptureBinding(input, "{"));
  assert.throws(() =>
    resolveSandboxCaptureBinding(input, JSON.stringify([binding, binding])),
  );
  assert.throws(() =>
    resolveSandboxCaptureBinding(
      input,
      JSON.stringify([binding, { ...binding, shopifyOrderId: "1002" }]),
    ),
  );
});
