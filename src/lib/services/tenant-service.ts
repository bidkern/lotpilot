import { hash } from "bcryptjs";
import {
  InventorySourceStatus,
  PlatformRole,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
  UserStatus,
  type Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function uniqueTenantSlug(name: string) {
  const base = slugify(name) || "dealer-workspace";

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.tenant.findUnique({
      where: {
        slug: candidate,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate a unique workspace slug.");
}

export async function registerTenantOwner(input: {
  email: string;
  name: string;
  password: string;
  tenantName: string;
  websiteUrl?: string | null;
}) {
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new Error("An account with that email already exists.");
  }

  const passwordHash = await hash(input.password, 12);
  const tenantSlug = await uniqueTenantSlug(input.tenantName);

  return prisma.$transaction(async (transaction) => {
    const tenant = await transaction.tenant.create({
      data: {
        name: input.tenantName,
        primaryWebsiteUrl: input.websiteUrl ?? undefined,
        slug: tenantSlug,
        status: TenantStatus.TRIALING,
      },
    });

    const user = await transaction.user.create({
      data: {
        email,
        name: input.name,
        passwordHash,
        platformRole: PlatformRole.USER,
        status: UserStatus.ACTIVE,
      },
    });

    await transaction.tenantMembership.create({
      data: {
        isDefault: true,
        role: UserRole.OWNER,
        tenantId: tenant.id,
        userId: user.id,
      },
    });

    await transaction.subscription.create({
      data: {
        planKey: "starter-trial",
        status: SubscriptionStatus.TRIAL,
        tenantId: tenant.id,
      },
    });

    return {
      tenant,
      user,
    };
  });
}

export async function getTenantWorkspaceState(tenantId: string) {
  const [activeSourceCount, latestSource] = await Promise.all([
    prisma.inventorySource.count({
      where: {
        status: InventorySourceStatus.ACTIVE,
        tenantId,
      },
    }),
    prisma.inventorySource.findFirst({
      where: {
        tenantId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        detectionRuns: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        },
        sourceProfile: true,
      },
    }),
  ]);

  return {
    activeSourceCount,
    latestSource,
    requiresOnboarding: activeSourceCount === 0 && !latestSource,
  };
}

export function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}
