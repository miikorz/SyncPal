import {
  closePayPalSyncWorker,
  createPayPalSyncWorker,
} from "./jobs/paypalSync";

const worker = createPayPalSyncWorker();

async function shutdown(): Promise<void> {
  await closePayPalSyncWorker(worker);
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

worker.on("error", (error) => {
  console.error("PayPal sync worker error", error.message);
});