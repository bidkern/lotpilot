import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireApiRole } from "@/lib/request-auth";
import { queueInventoryProviderSync } from "@/lib/services/inventory-provider-service";

type RouteContext = {
  params: Promise<{
    providerId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const { providerId } = await context.params;
    const job = await queueInventoryProviderSync({
      createdById: authResult.user!.id,
      providerConnectionId: providerId,
      tenantId: authResult.user!.tenantId!,
    });

    return NextResponse.json({
      backgroundJobId: job.id,
      status: job.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to queue provider sync.",
      },
      { status: 400 },
    );
  }
}
