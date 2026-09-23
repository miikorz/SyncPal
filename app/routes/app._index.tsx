import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useRevalidator } from "react-router";
import db from "../db.server";
import { isPayPalPartnerConfigured } from "../lib/paypal.server";
import { createPayPalPartnerOnboardingUrl } from "../models/paypal-oauth.server";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requestUrl = new URL(request.url);
  const host = requestUrl.searchParams.get("host");
  const sync = requestUrl.searchParams.get("sync");
  const syncCount = requestUrl.searchParams.get("count");
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

  const isPayPalConnected =
    shopConfig?.paypalConnectionStatus === "CONNECTED";
  let paypalAuthorizationUrl: string | null = null;
  let paypalOnboardingError: string | null = null;

  if (!isPayPalConnected) {
    if (!host) {
      paypalOnboardingError = "Shopify host context is unavailable.";
    } else if (!isPayPalPartnerConfigured()) {
      paypalOnboardingError =
        "PayPal Partner setup is incomplete. Add PAYPAL_PARTNER_ATTRIBUTION_ID to the environment.";
    } else {
      try {
        paypalAuthorizationUrl = await createPayPalPartnerOnboardingUrl(
          session.shop,
          host,
          `${requestUrl.origin}/app/paypal/callback`,
        );
      } catch {
        paypalOnboardingError =
          "PayPal could not create an onboarding link. Check the Partner app configuration.";
      }
    }
  }

  return {
    isPayPalConnected,
    paypalAuthorizationUrl,
    paypalOnboardingError,
    pending,
    successful,
    failed,
    sync,
    syncCount,
  };
};

export default function Index() {
  const {
    isPayPalConnected,
    paypalAuthorizationUrl,
    paypalOnboardingError,
    pending,
    successful,
    failed,
    sync,
    syncCount,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (pending === 0) {
      return;
    }

    const interval = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 10_000);

    return () => window.clearInterval(interval);
  }, [pending, revalidator]);

  return (
     <s-page heading="SyncPal">
       <s-section heading="PayPal connection">
         <s-stack direction="block" gap="base">
           <s-paragraph>
             {isPayPalConnected
               ? "PayPal is connected. New Shopify fulfillments will be synchronized automatically."
               : "Connect PayPal to synchronize Shopify fulfillment tracking information."}
           </s-paragraph>
           {paypalOnboardingError ? (
             <s-paragraph>{paypalOnboardingError}</s-paragraph>
           ) : null}
           {isPayPalConnected ? (
             <Form action="/app/paypal/disconnect" method="post">
               <s-button type="submit" variant="secondary">
                 Disconnect PayPal
               </s-button>
             </Form>
           ) : (
             <s-button
               href={paypalAuthorizationUrl ?? undefined}
               disabled={!paypalAuthorizationUrl}
               target="_top"
               variant="primary"
             >
               Connect PayPal
             </s-button>
           )}
         </s-stack>
       </s-section>

      <s-section heading="Synchronization activity">
        <s-stack direction="block" gap="base">
          {sync === "queued" ? (
            <s-paragraph>
              {syncCount ?? 0} eligible tracking update{syncCount === "1" ? " was" : "s were"} queued.
            </s-paragraph>
          ) : null}
          {sync === "not-connected" ? (
            <s-paragraph>Connect PayPal before starting a synchronization.</s-paragraph>
          ) : null}
          {sync === "lookup-failed" ? (
            <s-paragraph>
              Shopify could not load eligible fulfillments. Please try again.
            </s-paragraph>
          ) : null}
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
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={() => revalidator.revalidate()}
              disabled={revalidator.state !== "idle"}
              variant="secondary"
            >
              Refresh activity
            </s-button>
            {isPayPalConnected ? (
              <Form action="/app/sync" method="post">
                <s-button type="submit" variant="primary">
                  Sync eligible fulfillments
                </s-button>
              </Form>
            ) : null}
            <s-link href="/app/history">View history</s-link>
          </s-stack>
          {pending > 0 ? (
            <s-paragraph>
              Activity refreshes automatically every 10 seconds while synchronizations are pending.
            </s-paragraph>
          ) : null}
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
