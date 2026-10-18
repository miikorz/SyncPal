export interface ShopifyPayPalTransaction {
  gateway: string | null;
  kind: string;
  status: string;
  authorizationCode: string | null;
  test: boolean;
}

export class PayPalTransactionLookupError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
  }
}

export function resolvePayPalTransactionId(
  transactions: ShopifyPayPalTransaction[],
  environment: "sandbox" | "production",
): string {
  const payments = transactions.filter(
    ({ gateway, kind, status }) =>
      gateway?.toLowerCase().includes("paypal") &&
      ["SALE", "CAPTURE"].includes(kind) &&
      status === "SUCCESS",
  );

  if (payments.length === 0) {
    throw new PayPalTransactionLookupError(
      "No successful PayPal payment was found for this order",
      "paypal_payment_not_found",
    );
  }

  if (payments.some(({ test }) => test !== (environment === "sandbox"))) {
    throw new PayPalTransactionLookupError(
      "The Shopify payment does not match the configured PayPal environment",
      "paypal_environment_mismatch",
    );
  }

  // paymentId identifies a Shopify payment, not a PayPal transaction. The
  // deprecated provider reference remains a compatibility path until verified
  // against actual Shopify PayPal payments; never guess from receiptJson.
  const references = payments.map(({ authorizationCode }) =>
    authorizationCode?.trim(),
  );
  if (references.some((reference) => !reference || !/^[A-Z0-9]{17}$/.test(reference))) {
    throw new PayPalTransactionLookupError(
      "Shopify did not supply a usable PayPal transaction reference; manual review is required",
      "paypal_provider_reference_unavailable",
    );
  }

  const uniqueReferences = [...new Set(references)];
  if (uniqueReferences.length !== 1) {
    throw new PayPalTransactionLookupError(
      "Multiple PayPal payments were found; the fulfillment needs an explicit payment association",
      "paypal_multiple_payments",
    );
  }

  return uniqueReferences[0]!;
}
