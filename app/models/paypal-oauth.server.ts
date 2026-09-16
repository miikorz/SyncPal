import { createHash, randomBytes } from "node:crypto";
import { encrypt } from "../lib/crypto.server";
import {
  buildPayPalAuthorizationUrl,
  exchangePayPalAuthorizationCode,
} from "../lib/paypal.server";
import db from "../db.server";

const STATE_TTL_MS = 10 * 60 * 1_000;

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createPayPalAuthorizationUrl(
  shopDomain: string,
): Promise<string> {
  const state = randomBytes(32).toString("base64url");

  await db.shopConfig.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: {},
  });
  await db.payPalOAuthState.deleteMany({
    where: { shopDomain },
  });
  await db.payPalOAuthState.create({
    data: {
      shopDomain,
      stateHash: hashState(state),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  return buildPayPalAuthorizationUrl(state);
}

export async function connectPayPalWithAuthorizationCode(
  state: string,
  code: string,
): Promise<void> {
  const oauthState = await db.payPalOAuthState.delete({
    where: { stateHash: hashState(state) },
  });

  if (oauthState.expiresAt <= new Date()) {
    throw new Error("PayPal authorization has expired");
  }

  const token = await exchangePayPalAuthorizationCode(code);
  const refreshToken = token.refresh_token;

  if (!refreshToken) {
    throw new Error("PayPal did not return a refresh token");
  }

  await db.shopConfig.update({
    where: { shopDomain: oauthState.shopDomain },
    data: {
      paypalConnectionStatus: "CONNECTED",
      paypalAccessToken: encrypt(token.access_token),
      paypalRefreshToken: encrypt(refreshToken),
      paypalTokenExpiresAt: new Date(Date.now() + token.expires_in * 1_000),
    },
  });
}