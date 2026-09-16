import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { disconnectPayPal } from "../models/shop-config.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await disconnectPayPal(session.shop);

  return redirect("/app?paypal=disconnected");
};