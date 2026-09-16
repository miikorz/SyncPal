import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { connectPayPalWithAuthorizationCode } from "../models/paypal-oauth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const paypalError = url.searchParams.get("error");

  if (paypalError || !code || !state) {
    return redirect("/app?paypal=cancelled");
  }

  try {
    await connectPayPalWithAuthorizationCode(state, code);
    return redirect("/app?paypal=connected");
  } catch {
    return redirect("/app?paypal=failed");
  }
};