import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [shopConfig, pending, successful, failed] = await Promise.all([
    db.shopConfig.findUnique({
      where: { shopDomain: session.shop },
      select: { paypalConnectionStatus: true },
    }),
    db.syncLog.count({
      where: { shopDomain: session.shop, status: "PENDING" },
    }),
    db.syncLog.count({
      where: { shopDomain: session.shop, status: "SUCCESS" },
    }),
    db.syncLog.count({
      where: { shopDomain: session.shop, status: "FAILED" },
    }),
  ]);

  return {
    isPayPalConnected: shopConfig?.paypalConnectionStatus === "CONNECTED",
    pending,
    successful,
    failed,
  };
};

 export default function Index() {
   const { isPayPalConnected, pending, successful, failed } =
     useLoaderData<typeof loader>();

   return (
     <s-page heading="SyncPal">
       <s-section heading="PayPal connection">
         <s-stack direction="block" gap="base">
           <s-paragraph>
             {isPayPalConnected
               ? "PayPal is connected. New Shopify fulfillments will be synchronized automatically."
               : "Connect PayPal to synchronize Shopify fulfillment tracking information."}
           </s-paragraph>
           <form
             action={
               isPayPalConnected
                 ? "/app/paypal/disconnect"
                 : "/app/paypal/connect"
             }
             method="post"
           >
             <s-button type="submit" variant={isPayPalConnected ? "secondary" : "primary"}>
               {isPayPalConnected ? "Disconnect PayPal" : "Connect PayPal"}
             </s-button>
           </form>
         </s-stack>
       </s-section>

       <s-section heading="Synchronization activity">
         <s-stack direction="inline" gap="large">
           <s-stack direction="block" gap="small">
             <s-text>Pending</s-text>
             <s-heading>{pending}</s-heading>
           </s-stack>
           <s-stack direction="block" gap="small">
             <s-text>Successful</s-text>
             <s-heading>{successful}</s-heading>
           </s-stack>
           <s-stack direction="block" gap="small">
             <s-text>Failed</s-text>
             <s-heading>{failed}</s-heading>
           </s-stack>
         </s-stack>
       </s-section>

       <s-section slot="aside" heading="Data use">
         <s-paragraph>
           SyncPal processes tracking information only to update the matching
           PayPal transaction.
         </s-paragraph>
         <s-link href="/privacy">Privacy policy</s-link>
       </s-section>
     </s-page>
   );
 }

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
