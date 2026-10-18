import { UnrecoverableError, Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import type { Prisma } from "@prisma/client";
import {
  createRedisConnection,
  PAYPAL_SYNC_QUEUE_NAME,
  type PayPalSyncJobData,
} from "../../app/lib/paypal-sync-queue.server";
import {
  getPayPalEnvironment,
  PayPalRequestError,
} from "../../app/lib/paypal.server";
import { addPayPalOrderTracking } from "../../app/lib/paypal-orders.server";
import { resolveSandboxCaptureBinding } from "../../app/lib/paypal-sandbox-binding.server";
import {
  PayPalTransactionLookupError,
  resolvePayPalTransactionId,
  type ShopifyPayPalTransaction,
} from "../../app/lib/shopify-paypal-transaction.server";
import db from "../../app/db.server";
import { unauthenticated } from "../../app/shopify.server";

interface OrderTransactionsResponse {
  data?: {
    order?: {
      test: boolean;
      transactions: ShopifyPayPalTransaction[];
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface PayPalSyncDependencies {
  getShopConfig: (
    shopDomain: string,
  ) => Promise<Awaited<ReturnType<typeof getShopConfig>>>;
  findPayment: (
    shopDomain: string,
    orderId: string,
    merchantId: string | null,
  ) => Promise<{
    captureId: string;
    source: "shopify" | "sandbox_fixture";
  }>;
  addTracking: typeof addPayPalOrderTracking;
  updateSyncLog: (
    id: string,
    data: Prisma.SyncLogUpdateArgs["data"],
  ) => Promise<void>;
}

class SyncError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Prisma.InputJsonValue,
  ) {
    super(message);
  }
}

const workerConnections = new WeakMap<Worker<PayPalSyncJobData>, IORedis>();

async function getShopConfig(shopDomain: string) {
  return db.shopConfig.findUnique({ where: { shopDomain } });
}

async function findPayPalPayment(
  shopDomain: string,
  orderId: string,
  merchantId: string | null,
): Promise<{ captureId: string; source: "shopify" | "sandbox_fixture" }> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(
    `#graphql
      query SyncPalOrderTransactions($id: ID!) {
        order(id: $id) {
          test
          transactions {
            gateway
            kind
            authorizationCode
            status
            test
          }
        }
      }`,
    {
      variables: { id: `gid://shopify/Order/${orderId}` },
    },
  );
  const result = (await response.json()) as OrderTransactionsResponse;

  if (result.errors?.length) {
    throw new SyncError("Shopify transaction lookup failed", true, {
      service: "shopify",
      errors: result.errors.map(({ message }) => ({ message })),
    });
  }

  if (!result.data?.order) {
    throw new PayPalTransactionLookupError(
      "Shopify order was not found",
      "shopify_order_not_found",
    );
  }
  const boundCapture = resolveSandboxCaptureBinding({
    shopDomain,
    orderId,
    merchantId,
    isTestOrder: result.data.order.test,
    environment: getPayPalEnvironment(),
  });
  if (boundCapture)
    return { captureId: boundCapture, source: "sandbox_fixture" };
  return {
    captureId: resolvePayPalTransactionId(
      result.data?.order?.transactions ?? [],
      getPayPalEnvironment(),
    ),
    source: "shopify",
  };
}

const defaultDependencies: PayPalSyncDependencies = {
  getShopConfig,
  findPayment: findPayPalPayment,
  addTracking: addPayPalOrderTracking,
  updateSyncLog: async (id, data) => {
    await db.syncLog.update({ where: { id }, data });
  },
};

function normalizeError(error: unknown): SyncError {
  if (error instanceof SyncError) {
    return error;
  }

  if (error instanceof PayPalRequestError) {
    return new SyncError(
      "PayPal tracking synchronization failed",
      error.retryable,
      {
        service: "paypal",
        ...(error.statusCode ? { statusCode: error.statusCode } : {}),
        ...(error.details !== undefined
          ? { response: error.details as Prisma.InputJsonValue }
          : {}),
      },
    );
  }

  if (error instanceof PayPalTransactionLookupError) {
    return new SyncError(error.message, false, {
      service: "shopify",
      reason: error.reason,
    });
  }

  return new SyncError("Tracking synchronization failed", true, {
    reason: "unexpected_error",
  });
}

export async function processPayPalSyncJobWithDependencies(
  job: Job<PayPalSyncJobData>,
  dependencies: PayPalSyncDependencies,
): Promise<void> {
  try {
    const shopConfig = await dependencies.getShopConfig(job.data.shopDomain);

    if (!shopConfig || shopConfig.paypalConnectionStatus !== "CONNECTED") {
      throw new SyncError("PayPal is disconnected", false, {
        reason: "paypal_disconnected",
      });
    }

    const payment = await dependencies.findPayment(
      job.data.shopDomain,
      job.data.orderId,
      shopConfig.paypalMerchantId,
    );
    const currentShopConfig = await dependencies.getShopConfig(
      job.data.shopDomain,
    );

    if (
      !currentShopConfig ||
      currentShopConfig.paypalConnectionStatus !== "CONNECTED" ||
      currentShopConfig.paypalMerchantId !== shopConfig.paypalMerchantId
    ) {
      throw new SyncError("PayPal is disconnected", false, {
        reason: "paypal_disconnected",
      });
    }

    const paypalResponse = await dependencies.addTracking(
      currentShopConfig,
      payment.captureId,
      job.data.trackingNumber,
      job.data.trackingCompany ?? "",
    );

    await dependencies.updateSyncLog(job.data.syncLogId, {
      status: "SUCCESS",
      retryCount: job.attemptsMade + 1,
      rawResponse: {
        service: "paypal",
        transactionId: payment.captureId,
        associationSource: payment.source,
        response: paypalResponse as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const syncError = normalizeError(error);
    const attempt = job.attemptsMade + 1;
    const finalAttempt = attempt >= (job.opts.attempts ?? 1);

    await dependencies.updateSyncLog(job.data.syncLogId, {
      status: !syncError.retryable || finalAttempt ? "FAILED" : "PENDING",
      retryCount: attempt,
      rawResponse: {
        message: syncError.message,
        ...(syncError.details ? { details: syncError.details } : {}),
      },
    });

    if (!syncError.retryable) {
      throw new UnrecoverableError(syncError.message);
    }

    throw syncError;
  }
}

export async function processPayPalSyncJob(
  job: Job<PayPalSyncJobData>,
): Promise<void> {
  await processPayPalSyncJobWithDependencies(job, defaultDependencies);
}

export function createPayPalSyncWorker(): Worker<PayPalSyncJobData> {
  const connection = createRedisConnection();
  const worker = new Worker<PayPalSyncJobData>(
    PAYPAL_SYNC_QUEUE_NAME,
    processPayPalSyncJob,
    {
      connection,
      concurrency: 5,
    },
  );

  workerConnections.set(worker, connection);
  return worker;
}

export async function closePayPalSyncWorker(
  worker: Worker<PayPalSyncJobData>,
): Promise<void> {
  await worker.close();
  await workerConnections.get(worker)?.quit();
  workerConnections.delete(worker);
}
