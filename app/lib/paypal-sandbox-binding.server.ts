import { PayPalTransactionLookupError } from "./shopify-paypal-transaction.server";

interface SandboxBinding {
  shopDomain: string;
  shopifyOrderId: string;
  paypalMerchantId: string;
  captureId: string;
}

export function resolveSandboxCaptureBinding(
  input: {
    shopDomain: string;
    orderId: string;
    merchantId: string | null;
    isTestOrder: boolean;
    environment: "sandbox" | "production";
  },
  configuration = process.env.PAYPAL_SANDBOX_ORDER_BINDINGS,
): string | null {
  if (!configuration?.trim()) return null;
  const fail = (reason: string): never => {
    throw new PayPalTransactionLookupError(
      "Sandbox payment binding cannot be used",
      reason,
    );
  };
  if (input.environment !== "sandbox")
    fail("sandbox_bindings_forbidden_in_live");
  let bindings: SandboxBinding[];
  try {
    const value: unknown = JSON.parse(configuration);
    if (
      !Array.isArray(value) ||
      value.some(
        (binding) =>
          !binding ||
          typeof binding.shopDomain !== "string" ||
          !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(binding.shopDomain) ||
          typeof binding.shopifyOrderId !== "string" ||
          !/^\d+$/.test(binding.shopifyOrderId) ||
          typeof binding.paypalMerchantId !== "string" ||
          !/^[A-Z0-9]{13}$/.test(binding.paypalMerchantId) ||
          typeof binding.captureId !== "string" ||
          !/^[A-Z0-9]{17}$/.test(binding.captureId),
      )
    )
      return fail("invalid_sandbox_bindings");
    bindings = value;
  } catch {
    return fail("invalid_sandbox_bindings");
  }
  const matches = bindings.filter(
    ({ shopDomain, shopifyOrderId }) =>
      shopDomain === input.shopDomain && shopifyOrderId === input.orderId,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) return fail("ambiguous_sandbox_binding");
  if (!input.isTestOrder || matches[0].paypalMerchantId !== input.merchantId) {
    return fail("sandbox_binding_order_or_seller_mismatch");
  }
  if (
    bindings.filter(({ captureId }) => captureId === matches[0].captureId)
      .length !== 1
  ) {
    return fail("sandbox_capture_reused");
  }
  return matches[0].captureId;
}
