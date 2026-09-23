import type { ActionFunctionArgs } from "react-router";
import { createPayPalPartnerOnboardingUrl } from "../models/paypal-oauth.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requestUrl = new URL(request.url);
  const host = requestUrl.searchParams.get("host");

  if (!host) {
    throw new Response("Missing Shopify host", { status: 400 });
  }

  const authorizationUrl = await createPayPalPartnerOnboardingUrl(
    session.shop,
    host,
    `${requestUrl.origin}/app/paypal/callback`,
  );

  return { authorizationUrl };
};
