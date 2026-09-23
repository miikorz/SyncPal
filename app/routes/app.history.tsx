import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";

function formatErrorDetails(rawResponse: unknown): string {
  if (!rawResponse || typeof rawResponse !== "object") {
    return "No error details were recorded.";
  }

  const response = rawResponse as {
    message?: unknown;
    details?: unknown;
  };
  const message = typeof response.message === "string" ? response.message : null;
  if (!response.details) {
    return message ?? "No error details were recorded.";
  }

  const details = JSON.stringify(response.details);
  return message ? `${message}: ${details}` : details;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requestUrl = new URL(request.url);
  const syncLogs = await db.syncLog.findMany({
    where: { shopDomain: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      orderId: true,
      fulfillmentId: true,
      trackingNumber: true,
      trackingCompany: true,
      status: true,
      retryCount: true,
      rawResponse: true,
      updatedAt: true,
    },
  });

  return {
    retry: requestUrl.searchParams.get("retry"),
    syncLogs: syncLogs.map((syncLog) => ({
      ...syncLog,
      updatedAt: syncLog.updatedAt.toISOString(),
      errorDetails:
        syncLog.status === "FAILED"
          ? formatErrorDetails(syncLog.rawResponse)
          : null,
    })),
  };
};

export default function History() {
  const { retry, syncLogs } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Synchronization history">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-link href="/app">Back to dashboard</s-link>
          {retry === "queued" ? (
            <s-paragraph>The synchronization was queued for retry.</s-paragraph>
          ) : null}
          {retry === "unavailable" ? (
            <s-paragraph>
              This synchronization is no longer available for retry.
            </s-paragraph>
          ) : null}
          {retry === "carrier-unavailable" ? (
            <s-paragraph>
              SyncPal could not find the carrier for this fulfillment. Update the tracking information in Shopify and try again.
            </s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      {syncLogs.length === 0 ? (
        <s-section heading="No synchronization activity yet">
          <s-paragraph>
            Fulfillments with tracking information will appear here after they are queued.
          </s-paragraph>
        </s-section>
      ) : (
        syncLogs.map((syncLog) => (
          <s-section
            key={syncLog.id}
            heading={`${syncLog.trackingCompany ?? "Carrier"} · ${syncLog.trackingNumber}`}
          >
            <s-stack direction="block" gap="small">
              <s-paragraph>
                Status: {syncLog.status} · Attempts: {syncLog.retryCount} · Updated: {new Date(syncLog.updatedAt).toLocaleString()}
              </s-paragraph>
              <s-paragraph>
                Shopify order {syncLog.orderId}, fulfillment {syncLog.fulfillmentId}
              </s-paragraph>
              {syncLog.errorDetails ? (
                <s-paragraph>{syncLog.errorDetails}</s-paragraph>
              ) : null}
              {syncLog.status === "FAILED" ? (
                <Form action="/app/sync-log/retry" method="post">
                  <input type="hidden" name="syncLogId" value={syncLog.id} />
                  <s-button type="submit" variant="secondary">
                    Retry synchronization
                  </s-button>
                </Form>
              ) : null}
            </s-stack>
          </s-section>
        ))
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
