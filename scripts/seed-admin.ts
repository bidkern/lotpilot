import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import { ensureSeedWorkspace } from "../src/lib/services/bootstrap-service";

async function main() {
  const result = await ensureSeedWorkspace();
  console.log(
    JSON.stringify(
      {
        seeded: Boolean(result),
        tenantSlug: result?.tenant.slug ?? null,
        userEmail: result?.user.email ?? null,
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
    await prisma.$disconnect();
  });
