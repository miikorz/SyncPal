import type { ShopConfig } from "@prisma/client";
import {
  buildPayPalTracker,
  getPayPalBaseUrl,
  getPayPalMerchantRequestHeaders,
  PayPalRequestError,
} from "./paypal.server";

interface Capture {
  id?: string;
  status?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
}

interface Order {
  id?: string;
  purchase_units?: Array<{
    payee?: { merchant_id?: string };
    payments?: { captures?: Capture[] };
    shipping?: { trackers?: Array<{ id?: string; status?: string }> };
  }>;
}

async function request<T>(
  path: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${getPayPalBaseUrl()}${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new PayPalRequestError(true, undefined, {
      reason: "paypal_network_error",
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PayPalRequestError(
      response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      response.status,
      {
        name: typeof body?.name === "string" ? body.name : "request_failed",
        debug_id: response.headers.get("paypal-debug-id"),
        issues: Array.isArray(body?.details)
          ? body.details.flatMap((detail: { issue?: unknown }) =>
              typeof detail?.issue === "string" ? [detail.issue] : [],
            )
          : [],
      },
    );
  }
  if (!body || typeof body !== "object") {
    throw new PayPalRequestError(true, response.status, {
      reason: "paypal_invalid_response",
    });
  }
  return body as T;
}

function captureUnit(
  order: Order,
  orderId: string,
  captureId: string,
  merchantId: string,
) {
  const units = order.purchase_units?.filter((unit) =>
    unit.payments?.captures?.some(
      (capture) => capture.id === captureId && capture.status === "COMPLETED",
    ),
  );
  if (
    order.id !== orderId ||
    units?.length !== 1 ||
    units[0].payee?.merchant_id !== merchantId
  ) {
    throw new PayPalRequestError(false, undefined, {
      reason: "paypal_order_capture_seller_mismatch",
    });
  }
  return units[0];
}

export async function addPayPalOrderTracking(
  shopConfig: ShopConfig,
  captureId: string,
  trackingNumber: string,
  trackingCompany: string,
): Promise<unknown> {
  if (
    !/^[A-Z0-9]{17}$/.test(captureId) ||
    !trackingNumber.trim() ||
    trackingNumber.length > 64
  ) {
    throw new PayPalRequestError(false, undefined, {
      reason: "invalid_capture_or_tracking_number",
    });
  }
  const tracker = buildPayPalTracker(
    captureId,
    trackingNumber,
    trackingCompany,
  );
  const headers = await getPayPalMerchantRequestHeaders(shopConfig);
  const capture = await request<Capture>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}`,
    headers,
  );
  const orderId = capture.supplementary_data?.related_ids?.order_id;
  if (
    capture.id !== captureId ||
    capture.status !== "COMPLETED" ||
    !orderId ||
    !/^[A-Z0-9]{1,36}$/.test(orderId)
  ) {
    throw new PayPalRequestError(false, undefined, {
      reason: "paypal_completed_capture_order_unavailable",
    });
  }
  const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const order = await request<Order>(path, headers);
  const unit = captureUnit(
    order,
    orderId,
    captureId,
    shopConfig.paypalMerchantId!,
  );
  const trackerId = `${captureId}-${trackingNumber}`;
  const existing = unit.shipping?.trackers?.find(({ id }) => id === trackerId);
  if (existing?.status === "CANCELLED") {
    throw new PayPalRequestError(false, undefined, {
      reason: "paypal_tracker_cancelled",
    });
  }
  // PayPal identifies a shipment by capture + tracking. Read first so retries after
  // a timeout or database failure do not submit a second shipment.
  if (!existing) {
    await request<Order>(`${path}/track`, headers, {
      capture_id: captureId,
      tracking_number: trackingNumber,
      carrier: tracker.carrier,
      ...(tracker.carrier_name_other
        ? { carrier_name_other: tracker.carrier_name_other }
        : {}),
      notify_payer: false,
    });
  }
  const verifiedOrder = await request<Order>(path, headers);
  const verified = captureUnit(
    verifiedOrder,
    orderId,
    captureId,
    shopConfig.paypalMerchantId!,
  ).shipping?.trackers?.find(({ id }) => id === trackerId);
  if (
    !verified?.status ||
    !["SHIPPED", "DELIVERED"].includes(verified.status)
  ) {
    throw new PayPalRequestError(true, undefined, {
      reason: "paypal_tracker_readback_unconfirmed",
    });
  }
  return {
    api: "orders_v2",
    paypalOrderId: orderId,
    captureId,
    verifiedTracker: { id: trackerId, status: verified.status },
  };
}
