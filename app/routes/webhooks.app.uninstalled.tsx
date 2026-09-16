import type { ActionFunctionArgs } from "react-router";
import { removePendingJobsForShop } from "../lib/paypal-sync-queue.server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session } = await authenticate.webhook(request);

  await removePendingJobsForShop(shop);
  await db.shopConfig.delete({ where: { shopDomain: shop } }).catch((error) => {
    if (error.code !== "P2025") {
      throw error;
    }
  });

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
