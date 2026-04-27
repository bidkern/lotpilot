import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { registerTenantOwner } from "@/lib/services/tenant-service";

export async function ensureSeedWorkspace() {
  if (!env.SEED_DEMO_EMAIL || !env.SEED_DEMO_PASSWORD || !env.SEED_DEMO_TENANT_NAME) {
    return null;
  }

  const existingMembership = await prisma.tenantMembership.findFirst({
    where: {
      user: {
        email: env.SEED_DEMO_EMAIL.toLowerCase(),
      },
    },
    include: {
      tenant: true,
      user: true,
    },
  });

  if (existingMembership) {
    return {
      tenant: existingMembership.tenant,
      user: existingMembership.user,
    };
  }

  return registerTenantOwner({
    email: env.SEED_DEMO_EMAIL,
    name: env.SEED_DEMO_NAME ?? "Demo Owner",
    password: env.SEED_DEMO_PASSWORD,
    tenantName: env.SEED_DEMO_TENANT_NAME,
    websiteUrl: env.SEED_DEMO_WEBSITE_URL,
  });
}
