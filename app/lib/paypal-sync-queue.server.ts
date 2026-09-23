import { Queue, type Job } from "bullmq";
import IORedis from "ioredis";

export const PAYPAL_SYNC_QUEUE_NAME = "paypal-tracking-sync";

export interface PayPalSyncJobData {
  syncLogId: string;
  shopDomain: string;
  orderId: string;
  fulfillmentId: string;
  trackingNumber: string;
  trackingCompany?: string;
}

let paypalSyncQueue: Queue<PayPalSyncJobData> | undefined;
let paypalSyncQueueConnection: IORedis | undefined;

export function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}

export function getPayPalSyncQueue(): Queue<PayPalSyncJobData> {
  if (!paypalSyncQueue) {
    paypalSyncQueueConnection = createRedisConnection();
    paypalSyncQueue = new Queue<PayPalSyncJobData>(
      PAYPAL_SYNC_QUEUE_NAME,
      {
        connection: paypalSyncQueueConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5_000,
          },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      },
    );
  }

  return paypalSyncQueue;
}

export async function closePayPalSyncQueue(): Promise<void> {
  await paypalSyncQueue?.close();
  await paypalSyncQueueConnection?.quit();
  paypalSyncQueue = undefined;
  paypalSyncQueueConnection = undefined;
}

export async function enqueuePayPalSync(
  data: PayPalSyncJobData,
  options: { replaceExisting?: boolean } = {},
): Promise<Job<PayPalSyncJobData>> {
  const queue = getPayPalSyncQueue();

  if (options.replaceExisting) {
    const existingJob = await queue.getJob(data.syncLogId);
    if (existingJob) {
      await existingJob.remove();
    }
  }

  return queue.add("sync-tracking", data, {
    jobId: data.syncLogId,
  });
}

export async function removePendingJobsForShop(
  shopDomain: string,
): Promise<void> {
  const jobs = await getPayPalSyncQueue().getJobs([
    "waiting",
    "delayed",
    "prioritized",
  ]);

  await Promise.all(
    jobs
      .filter((job) => job.data.shopDomain === shopDomain)
      .map((job) => job.remove()),
  );
}
