import { getQueue, QUEUE_NAMES } from "@/lib/queue";

const SOURCE_SYNC_TIMEZONE = "America/New_York";

export async function ensureSourceSyncSchedule(input: {
  cron: string;
  sourceId: string;
}) {
  const queue = await getQueue();

  await queue.schedule(
    QUEUE_NAMES.inventorySync,
    input.cron,
    {
      sourceId: input.sourceId,
    },
    {
      key: `source-sync:${input.sourceId}`,
      singletonKey: `source-sync:${input.sourceId}`,
      tz: SOURCE_SYNC_TIMEZONE,
    },
  );
}
