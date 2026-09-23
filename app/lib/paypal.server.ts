import type { ShopConfig } from "@prisma/client";

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
}

interface PayPalTracker {
  transaction_id: string;
  tracking_number: string;
  tracking_number_type: "CARRIER_PROVIDED";
  status: "SHIPPED";
  carrier: string;
  carrier_name_other?: string;
}

interface PayPalTrackingResponse {
  tracker_identifiers?: unknown[];
  errors?: unknown[];
}

interface PayPalPartnerReferralResponse {
  links?: Array<{ href?: string; rel?: string }>;
}

const PAYPAL_GLOBAL_CARRIERS = new Map<string, string>([
  ["correos express", "CORREOS_ES"],
  ["dhl", "DHL"],
  ["dhl express", "DHL"],
  ["dpd", "DPD"],
  ["gls", "GLS"],
  ["united parcel service", "UPS"],
  ["ups", "UPS"],
]);

export class PayPalRequestError extends Error {
  constructor(
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super("PayPal request failed");
  }
}

function getPayPalBaseUrl(): string {
  const environment = process.env.PAYPAL_ENVIRONMENT ?? "sandbox";

  if (environment === "production") {
    return "https://api-m.paypal.com";
  }

  if (environment === "sandbox") {
    return "https://api-m.sandbox.paypal.com";
  }

  throw new Error("PAYPAL_ENVIRONMENT must be sandbox or production");
}

function getPartnerCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const partnerAttributionId = process.env.PAYPAL_PARTNER_ATTRIBUTION_ID;

  if (!clientId || !clientSecret || !partnerAttributionId) {
    throw new Error(
      "PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_PARTNER_ATTRIBUTION_ID are required",
    );
  }

  return { clientId, clientSecret, partnerAttributionId };
}

export function isPayPalPartnerConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.PAYPAL_PARTNER_ATTRIBUTION_ID,
  );
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const body = await response.text();

  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return { message: "PayPal returned a non-JSON response" };
  }
}

function sanitizeResponseBody(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return null;
  }

  const body = value as Record<string, unknown>;
  const allowedKeys = [
    "name",
    "message",
    "debug_id",
    "details",
    "errors",
    "tracker_identifiers",
  ];

  return Object.fromEntries(
    allowedKeys
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, body[key]]),
  );
}

async function getPlatformAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getPartnerCredentials();
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw new PayPalRequestError(
      isRetryableStatus(response.status),
      response.status,
      sanitizeResponseBody(responseBody),
    );
  }

  const token = responseBody as PayPalTokenResponse;

  if (!token.access_token || !token.expires_in) {
    throw new PayPalRequestError(false, response.status, {
      reason: "PayPal returned an invalid token response",
    });
  }

  return token.access_token;
}

function buildPayPalAuthAssertion(merchantId: string): string {
  const { clientId } = getPartnerCredentials();
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: clientId, payer_id: merchantId }),
  ).toString("base64url");

  return `${header}.${payload}.`;
}

export async function createPayPalPartnerReferral(
  trackingId: string,
  returnUrl: string,
): Promise<string> {
  const { partnerAttributionId } = getPartnerCredentials();
  const accessToken = await getPlatformAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/customer/partner-referrals`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Partner-Attribution-Id": partnerAttributionId,
      },
      body: JSON.stringify({
        tracking_id: trackingId,
        operations: [
          {
            operation: "API_INTEGRATION",
            api_integration_preference: {
              rest_api_integration: {
                integration_method: "PAYPAL",
                integration_type: "THIRD_PARTY",
                third_party_details: { features: ["PAYMENT", "REFUND"] },
              },
            },
          },
        ],
        products: ["EXPRESS_CHECKOUT"],
        legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
        partner_config_override: {
          return_url: returnUrl,
          return_url_description: "Return to SyncPal",
        },
      }),
    },
  );
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw new PayPalRequestError(
      isRetryableStatus(response.status),
      response.status,
      sanitizeResponseBody(responseBody),
    );
  }

  const referral = responseBody as PayPalPartnerReferralResponse;
  const actionUrl = referral.links?.find(({ rel }) => rel === "action_url")?.href;

  if (!actionUrl) {
    throw new PayPalRequestError(false, response.status, {
      reason: "PayPal did not return a partner onboarding URL",
    });
  }

  return actionUrl;
}

export function buildPayPalTracker(
  transactionId: string,
  trackingNumber: string,
  trackingCompany: string,
): PayPalTracker {
  const carrierName = trackingCompany.trim();

  if (!carrierName) {
    throw new PayPalRequestError(false, undefined, {
      reason: "tracking_carrier_required",
    });
  }

  const knownCarrier = PAYPAL_GLOBAL_CARRIERS.get(carrierName.toLowerCase());

  return {
    transaction_id: transactionId,
    tracking_number: trackingNumber,
    tracking_number_type: "CARRIER_PROVIDED",
    status: "SHIPPED",
    carrier: knownCarrier ?? "OTHER",
    ...(knownCarrier ? {} : { carrier_name_other: carrierName }),
  };
}

export async function addPayPalTracking(
  shopConfig: ShopConfig,
  transactionId: string,
  trackingNumber: string,
  trackingCompany: string,
): Promise<unknown> {
  if (!shopConfig.paypalMerchantId) {
    throw new PayPalRequestError(false, undefined, {
      reason: "PayPal merchant connection is missing",
    });
  }

  const { partnerAttributionId } = getPartnerCredentials();
  const accessToken = await getPlatformAccessToken();
  const response = await fetch(
    `${getPayPalBaseUrl()}/v1/shipping/trackers-batch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Auth-Assertion": buildPayPalAuthAssertion(
          shopConfig.paypalMerchantId,
        ),
        "PayPal-Partner-Attribution-Id": partnerAttributionId,
      },
      body: JSON.stringify({
        trackers: [
          buildPayPalTracker(transactionId, trackingNumber, trackingCompany),
        ],
      }),
    },
  );
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw new PayPalRequestError(
      isRetryableStatus(response.status),
      response.status,
      sanitizeResponseBody(responseBody),
    );
  }

  const trackingResponse = responseBody as PayPalTrackingResponse | null;

  if (trackingResponse?.errors?.length) {
    throw new PayPalRequestError(
      false,
      response.status,
      sanitizeResponseBody(responseBody),
    );
  }

  return sanitizeResponseBody(responseBody);
}
