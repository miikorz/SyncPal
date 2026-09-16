import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const environmentFile = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
}

const { closePayPalSyncWorker, createPayPalSyncWorker } = await import(
  "./jobs/paypalSync"
);
const { purgeExpiredSyncLogs } = await import("./jobs/dataRetention");

const worker = createPayPalSyncWorker();
const retentionInterval = setInterval(
  () => void purgeExpiredSyncLogs(),
  24 * 60 * 60 * 1_000,
);
retentionInterval.unref();
void purgeExpiredSyncLogs();

async function shutdown(): Promise<void> {
  clearInterval(retentionInterval);
  await closePayPalSyncWorker(worker);
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

worker.on("error", (error) => {
  console.error("PayPal sync worker error", error.message);
});