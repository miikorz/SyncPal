import { createHash, randomBytes } from "node:crypto";
import { createPayPalPartnerReferral } from "../lib/paypal.server";
import db from "../db.server";

const STATE_TTL_MS = 10 * 60 * 1_000;

export interface PayPalConnectionResult {
  shopDomain: string;
  host: string | null;
}

export interface PayPalOAuthContext {
  shopDomain: string;
  host: string | null;
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createPayPalPartnerOnboardingUrl(
  shopDomain: string,
  host: string,
  returnUrl: string,
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const stateHash = hashState(state);

  await db.shopConfig.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: {},
  });
  await db.payPalOAuthState.deleteMany({ where: { shopDomain } });
  await db.payPalOAuthState.create({
    data: {
      shopDomain,
      host,
      stateHash,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  try {
    return await createPayPalPartnerReferral(state, returnUrl);
  } catch (error) {
    await db.payPalOAuthState.deleteMany({ where: { stateHash } });
    throw error;
  }
}

export async function connectPayPalMerchant(
  state: string,
  merchantId: string,
): Promise<PayPalConnectionResult> {
  const oauthState = await db.payPalOAuthState.delete({
    where: { stateHash: hashState(state) },
  });

  if (oauthState.expiresAt <= new Date()) {
    throw new Error("PayPal authorization has expired");
  }

  await db.shopConfig.update({
    where: { shopDomain: oauthState.shopDomain },
    data: {
      paypalConnectionStatus: "CONNECTED",
      paypalMerchantId: merchantId,
      paypalAccessToken: null,
      paypalRefreshToken: null,
      paypalTokenExpiresAt: null,
    },
  });

  return { shopDomain: oauthState.shopDomain, host: oauthState.host };
}

export async function findPayPalOAuthContext(
  state: string,
): Promise<PayPalOAuthContext | null> {
  const oauthState = await db.payPalOAuthState.findUnique({
    where: { stateHash: hashState(state) },
    select: { shopDomain: true, host: true },
  });

  return oauthState;
}
