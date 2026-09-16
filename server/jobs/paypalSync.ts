import { UnrecoverableError, Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import type { Prisma } from "@prisma/client";
import {
  createRedisConnection,
  PAYPAL_SYNC_QUEUE_NAME,
  type PayPalSyncJobData,
} from "../../app/lib/paypal-sync-queue.server";
import {
  addPayPalTracking,
  PayPalRequestError,
} from "../../app/lib/paypal.server";
import db from "../../app/db.server";
import { unauthenticated } from "../../app/shopify.server";

interface OrderTransactionsResponse {
  data?: {
    order?: {
      transactions: Array<{
        gateway: string | null;
        kind: string;
        paymentId: string | null;
        status: string;
      }>;
    } | null;
  };
  errors?: Array<{ message: string }>;
}

interface PayPalSyncDependencies {
  getShopConfig: (
    shopDomain: string,
  ) => Promise<Awaited<ReturnType<typeof getShopConfig>>>;
  findTransactionId: (shopDomain: string, orderId: string) => Promise<string>;
  addTracking: typeof addPayPalTracking;
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

async function findPayPalTransactionId(
  shopDomain: string,
  orderId: string,
): Promise<string> {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(
    `#graphql
      query SyncPalOrderTransactions($id: ID!) {
        order(id: $id) {
          transactions {
            gateway
            kind
            paymentId
            status
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

  const transaction = result.data?.order?.transactions
    .slice()
    .reverse()
    .find(
      ({ gateway, kind, paymentId, status }) =>
        gateway?.toLowerCase().includes("paypal") &&
        ["SALE", "CAPTURE"].includes(kind) &&
        status === "SUCCESS" &&
        Boolean(paymentId),
    );

  if (!transaction?.paymentId) {
    throw new SyncError("No successful PayPal transaction was found", true, {
      service: "shopify",
      reason: "paypal_transaction_not_found",
    });
  }

  return transaction.paymentId;
}

const defaultDependencies: PayPalSyncDependencies = {
  getShopConfig,
  findTransactionId: findPayPalTransactionId,
  addTracking: addPayPalTracking,
  updateSyncLog: async (id, data) => {
    await db.syncLog.update({ where: { id }, data });
  },
};

function normalizeError(error: unknown): SyncError {
  if (error instanceof SyncError) {
    return error;
  }

  if (error instanceof PayPalRequestError) {
    return new SyncError("PayPal tracking synchronization failed", error.retryable, {
      service: "paypal",
      ...(error.statusCode ? { statusCode: error.statusCode } : {}),
      ...(error.details !== undefined
        ? { response: error.details as Prisma.InputJsonValue }
        : {}),
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

    if (
      !shopConfig ||
      shopConfig.paypalConnectionStatus !== "CONNECTED"
    ) {
      throw new SyncError("PayPal is disconnected", false, {
        reason: "paypal_disconnected",
      });
    }

    const transactionId = await dependencies.findTransactionId(
      job.data.shopDomain,
      job.data.orderId,
    );
    const currentShopConfig = await dependencies.getShopConfig(
      job.data.shopDomain,
    );

    if (
      !currentShopConfig ||
      currentShopConfig.paypalConnectionStatus !== "CONNECTED"
    ) {
      throw new SyncError("PayPal is disconnected", false, {
        reason: "paypal_disconnected",
      });
    }

    const paypalResponse = await dependencies.addTracking(
      currentShopConfig,
      transactionId,
      job.data.trackingNumber,
      job.data.trackingCompany ?? "",
    );

    await dependencies.updateSyncLog(job.data.syncLogId, {
      status: "SUCCESS",
      retryCount: job.attemptsMade + 1,
      rawResponse: {
        service: "paypal",
        transactionId,
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
