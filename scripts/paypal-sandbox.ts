import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const environmentFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
}

const db = (await import("../app/db.server")).default;
const {
  addPayPalTracking,
  createPayPalPartnerReferral,
  getPayPalMerchantRequestHeaders,
  PayPalRequestError,
  readPayPalTracking,
} = await import("../app/lib/paypal.server");

interface SandboxOrder {
  id?: string;
  status?: string;
  links?: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    amount?: { currency_code: string; value: string };
    payee?: { merchant_id?: string };
    payments?: {
      captures?: Array<{ id: string; status: string }>;
    };
    shipping?: {
      trackers?: Array<{ id?: string; status?: string }>;
    };
  }>;
}

const [command, ...args] = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function run(): Promise<void> {
  if (process.env.PAYPAL_ENVIRONMENT !== "sandbox") {
    throw new Error("This tool requires PAYPAL_ENVIRONMENT=sandbox and cannot run in Live");
  }

  if (!["authorize-tracking", "create-payment", "capture-payment", "send-tracking", "verify-tracking", "send-order-tracking", "verify-order-tracking"].includes(command)) {
    throw new Error("Usage: npm run sandbox:paypal -- <authorize-tracking|create-payment|capture-payment|send-tracking|verify-tracking|send-order-tracking|verify-order-tracking> --shop <shop.myshopify.com> [--order <paypal-order-id>] [--transaction <seller-capture-id> --tracking <number> --carrier <name>]");
  }

  const shopDomain = requiredOption("shop");
  const shopConfig = await db.shopConfig.findUnique({ where: { shopDomain } });
  if (shopConfig?.paypalConnectionStatus !== "CONNECTED" || !shopConfig.paypalMerchantId) {
    throw new Error("Connect this shop's Business Sandbox seller in SyncPal first");
  }
  const sellerMerchantId = shopConfig.paypalMerchantId;

  if (command === "authorize-tracking") {
    const authorizationUrl = await createPayPalPartnerReferral(
      `syncpal-sandbox-${randomUUID()}`,
      "https://example.com/syncpal-sandbox/authorized",
      { legacyTracking: true },
    );
    const url = new URL(authorizationUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com") {
      throw new Error("PayPal did not return a Sandbox authorization URL");
    }
    console.log(JSON.stringify({
      authorizationUrl,
      sellerMerchantId: shopConfig.paypalMerchantId,
      requiredFeature: "TRACKING_SHIPMENT_READWRITE",
      nextStep: "Authorize with the existing connected Business Sandbox seller, not the Personal buyer or the platform account. This does not change SyncPal's stored seller. The return page is a placeholder.",
    }, null, 2));
    return;
  }

  const baseUrl = "https://api-m.sandbox.paypal.com";
  const headers = await getPayPalMerchantRequestHeaders(shopConfig);

  async function orderRequest(path: string, init?: RequestInit): Promise<SandboxOrder> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    const body = await response.json() as SandboxOrder & {
      name?: string;
      debug_id?: string;
      details?: Array<{ issue?: string }>;
    };
    console.log(JSON.stringify({
      environment: "sandbox",
      method: init?.method ?? "GET",
      path,
      httpStatus: response.status,
      debugId: body.debug_id ?? response.headers.get("paypal-debug-id"),
    }));
    if (!response.ok) {
      throw new Error(`PayPal Sandbox HTTP ${response.status}: ${body.name ?? "request_failed"}; issues=${body.details?.map(({ issue }) => issue).filter(Boolean).join(",") ?? "none"}; debug_id=${body.debug_id ?? "unavailable"}`);
    }
    return body;
  }

  if (command === "create-payment") {
    const order = await orderRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `syncpal-sandbox-${randomUUID()}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: "syncpal-sandbox-test",
          description: "SyncPal Sandbox tracking integration test",
          payee: { merchant_id: shopConfig.paypalMerchantId },
          amount: { currency_code: "EUR", value: "1.00" },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: "https://example.com/syncpal-sandbox/approved",
              cancel_url: "https://example.com/syncpal-sandbox/cancelled",
            },
          },
        },
      }),
    });
    const approvalUrl = order.links?.find(({ rel }) => ["approve", "payer-action"].includes(rel))?.href;
    if (!order.id || !approvalUrl || new URL(approvalUrl).hostname !== "www.sandbox.paypal.com") {
      throw new Error("PayPal did not return a Sandbox approval URL");
    }
    console.log(JSON.stringify({
      paypalOrderId: order.id,
      approvalUrl,
      nextStep: "Open approvalUrl and approve EUR 1.00 using a Personal Sandbox buyer, then run capture-payment. The return page is a placeholder.",
    }, null, 2));
    return;
  }

  if (command === "capture-payment") {
    const orderId = requiredOption("order");
    const orderPath = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
    let order = await orderRequest(orderPath);
    const unit = order.purchase_units?.[0];
    if (
      order.purchase_units?.length !== 1 ||
      unit?.payee?.merchant_id !== shopConfig.paypalMerchantId ||
      unit?.amount?.currency_code !== "EUR" ||
      Number(unit.amount.value) !== 1
    ) {
      throw new Error("Only a EUR 1.00 Sandbox order for this connected seller can be captured by this tool");
    }
    if (order.status === "APPROVED") {
      order = await orderRequest(`${orderPath}/capture`, {
        method: "POST",
        headers: { "PayPal-Request-Id": `syncpal-sandbox-capture-${orderId}` },
        body: "{}",
      });
    }
    const capture = order.purchase_units?.[0]?.payments?.captures?.find(
      ({ status }) => status === "COMPLETED",
    );
    if (!capture) {
      throw new Error(`No completed seller capture exists. PayPal order status: ${order.status ?? "unknown"}`);
    }
    console.log(JSON.stringify({
      paypalOrderId: orderId,
      sellerTransactionId: capture.id,
      status: capture.status,
      nextStep: "Run send-tracking with sellerTransactionId, a test tracking number and carrier. This PayPal payment is not a Shopify checkout payment.",
    }, null, 2));
    return;
  }

  const transactionId = requiredOption("transaction");
  const trackingNumber = requiredOption("tracking");
  if (command === "send-order-tracking" || command === "verify-order-tracking") {
    const orderId = requiredOption("order");
    const orderPath = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
    const trackerId = `${transactionId}-${trackingNumber}`;
    let order = await orderRequest(orderPath);

    const validateTestOrder = (value: SandboxOrder) => {
      const unit = value.purchase_units?.[0];
      if (
        value.id !== orderId ||
        value.purchase_units?.length !== 1 ||
        unit?.payee?.merchant_id !== sellerMerchantId ||
        unit?.amount?.currency_code !== "EUR" ||
        Number(unit.amount.value) !== 1 ||
        !unit.payments?.captures?.some(({ id, status }) => id === transactionId && status === "COMPLETED")
      ) {
        throw new Error("Orders v2 tracking validation requires the matching EUR 1.00 completed Sandbox capture for this connected seller");
      }
      return unit;
    };

    const unit = validateTestOrder(order);
    if (command === "send-order-tracking") {
      const carrier = requiredOption("carrier");
      if (carrier !== "UPS") {
        throw new Error("This isolated Orders v2 probe currently supports --carrier UPS only");
      }
      // Reuse the same capture/tracking pair on retries to avoid duplicate test shipments.
      if (!unit.shipping?.trackers?.some(({ id }) => id === trackerId)) {
        await orderRequest(`${orderPath}/track`, {
          method: "POST",
          body: JSON.stringify({
            capture_id: transactionId,
            tracking_number: trackingNumber,
            carrier,
            notify_payer: false,
          }),
        });
      }
      order = await orderRequest(orderPath);
    }

    const tracker = validateTestOrder(order).shipping?.trackers?.find(({ id }) => id === trackerId);
    if (!tracker || tracker.status !== "SHIPPED") {
      throw new Error("Orders v2 read-back did not confirm the requested active tracker; do not mark this test successful");
    }
    console.log(JSON.stringify({
      verified: true,
      environment: "sandbox",
      api: "Orders v2",
      paypalOrderId: orderId,
      sellerTransactionId: transactionId,
      sellerMerchantId: shopConfig.paypalMerchantId,
      tracker: { id: tracker.id, status: tracker.status },
      shopifyEndToEndVerified: false,
    }, null, 2));
    return;
  }
  if (command === "send-tracking") {
    await addPayPalTracking(shopConfig, transactionId, trackingNumber, requiredOption("carrier"));
  }
  const tracker = await readPayPalTracking(shopConfig, transactionId, trackingNumber);
  console.log(JSON.stringify({
    verified: true,
    environment: "sandbox",
    sellerMerchantId: shopConfig.paypalMerchantId,
    tracker,
    shopifyEndToEndVerified: false,
  }, null, 2));
}

try {
  await run();
} catch (error) {
  if (error instanceof PayPalRequestError) {
    console.error(JSON.stringify({
      message: "PayPal Sandbox request failed",
      statusCode: error.statusCode,
      details: error.details,
    }));
  } else {
    console.error(error instanceof Error ? error.message : "Sandbox verification failed");
  }
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
