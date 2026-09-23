import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  connectPayPalMerchant,
  findPayPalOAuthContext,
} from "../models/paypal-oauth.server";

function redirectToEmbeddedApp(
  shopDomain: string,
  host: string | null,
  status: string,
) {
  const params = new URLSearchParams({ shop: shopDomain, paypal: status });

  if (host) {
    params.set("host", host);
  }

  return redirect(`/app?${params.toString()}`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("merchantId") ?? url.searchParams.get("state");
  const merchantId = url.searchParams.get("merchantIdInPayPal");
  const permissionsGranted = url.searchParams.get("permissionsGranted");
  const consentStatus = url.searchParams.get("consentStatus");
  const paypalError = url.searchParams.get("error");

  if (!state) {
    return redirect("/?paypal=failed");
  }

  const oauthContext = await findPayPalOAuthContext(state);

  if (!oauthContext) {
    return redirect("/?paypal=failed");
  }

  if (
    paypalError ||
    !merchantId ||
    permissionsGranted !== "true" ||
    consentStatus !== "true"
  ) {
    return redirectToEmbeddedApp(
      oauthContext.shopDomain,
      oauthContext.host,
      "cancelled",
    );
  }

  try {
    const connection = await connectPayPalMerchant(
      state,
      merchantId,
    );
    return redirectToEmbeddedApp(
      connection.shopDomain,
      connection.host,
      "connected",
    );
  } catch {
    return redirectToEmbeddedApp(
      oauthContext.shopDomain,
      oauthContext.host,
      "failed",
    );
  }
};
