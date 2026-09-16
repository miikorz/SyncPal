import db from "../../app/db.server";

const DEFAULT_RETENTION_DAYS = 90;

export function getDataRetentionDays(): number {
  const configuredDays = Number(process.env.DATA_RETENTION_DAYS);

  if (!Number.isInteger(configuredDays) || configuredDays < 1) {
    return DEFAULT_RETENTION_DAYS;
  }

  return configuredDays;
}

export async function purgeExpiredSyncLogs(): Promise<number> {
  const retentionDays = getDataRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  const result = await db.syncLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return result.count;
}