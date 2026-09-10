import type { ShopConfig } from "@prisma/client";
import { decrypt, encrypt } from "./crypto.server";
import db from "../db.server";

interface PayPalTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

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
    "tracker_identifiers",
  ];

  return Object.fromEntries(
    allowedKeys
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, body[key]]),
  );
}

async function refreshAccessToken(shopConfig: ShopConfig): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret || !shopConfig.paypalRefreshToken) {
    throw new PayPalRequestError(false, undefined, {
      reason: "PayPal reauthorization is required",
    });
  }

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decrypt(shopConfig.paypalRefreshToken),
    }),
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

  await db.shopConfig.update({
    where: { shopDomain: shopConfig.shopDomain },
    data: {
      paypalAccessToken: encrypt(token.access_token),
      paypalRefreshToken: token.refresh_token
        ? encrypt(token.refresh_token)
        : shopConfig.paypalRefreshToken,
      paypalTokenExpiresAt: new Date(Date.now() + token.expires_in * 1_000),
    },
  });

  return token.access_token;
}

async function getAccessToken(shopConfig: ShopConfig): Promise<string> {
  const expiresSoon =
    shopConfig.paypalTokenExpiresAt !== null &&
    shopConfig.paypalTokenExpiresAt.getTime() <= Date.now() + 60_000;

  if (shopConfig.paypalAccessToken && !expiresSoon) {
    return decrypt(shopConfig.paypalAccessToken);
  }

  return refreshAccessToken(shopConfig);
}

export async function addPayPalTracking(
  shopConfig: ShopConfig,
  transactionId: string,
  trackingNumber: string,
): Promise<unknown> {
  const accessToken = await getAccessToken(shopConfig);
  const response = await fetch(`${getPayPalBaseUrl()}/v1/shipping/trackers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      trackers: [
        {
          transaction_id: transactionId,
          tracking_number: trackingNumber,
          status: "SHIPPED",
        },
      ],
    }),
  });
  const responseBody = await readResponseBody(response);

  if (!response.ok) {
    throw new PayPalRequestError(
      isRetryableStatus(response.status),
      response.status,
      sanitizeResponseBody(responseBody),
    );
  }

  return sanitizeResponseBody(responseBody);
}