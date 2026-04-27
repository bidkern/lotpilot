import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { executeSourceSync } from "../src/lib/services/inventory-service";

async function main() {
  const sourceId = process.argv[2];

  const source =
    (sourceId
      ? await prisma.inventorySource.findUnique({
          where: {
            id: sourceId,
          },
        })
      : await prisma.inventorySource.findFirst({
          where: {
            status: "ACTIVE",
          },
          orderBy: {
            updatedAt: "desc",
          },
        })) ?? null;

  if (!source) {
    throw new Error("No active inventory source found. Pass a source id or onboard a site first.");
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      sourceId: source.id,
      status: "QUEUED",
      tenantId: source.tenantId,
    },
  });

  const result = await executeSourceSync(syncRun.id);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
