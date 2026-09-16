import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createPayPalAuthorizationUrl } from "../models/paypal-oauth.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const authorizationUrl = await createPayPalAuthorizationUrl(session.shop);

  return redirect(authorizationUrl);
};