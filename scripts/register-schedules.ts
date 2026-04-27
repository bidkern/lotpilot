import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { stopQueue } from "../src/lib/queue";
import { ensureSourceSyncSchedule } from "../src/lib/services/source-scheduler";

async function main() {
  const sources = await prisma.inventorySource.findMany({
    where: {
      status: "ACTIVE",
    },
  });

  for (const source of sources) {
    if (!source.syncCron) {
      continue;
    }

    await ensureSourceSyncSchedule({
      cron: source.syncCron,
      sourceId: source.id,
    });
  }

  console.log(
    JSON.stringify(
      {
        scheduledSources: sources.filter((source) => Boolean(source.syncCron)).length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopQueue();
    await prisma.$disconnect();
  });
