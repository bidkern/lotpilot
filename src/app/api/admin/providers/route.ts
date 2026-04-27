import { InventoryProviderType, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import {
  createInventoryProviderConnection,
  getInventoryProviderConnections,
} from "@/lib/services/inventory-provider-service";

const payloadSchema = z.object({
  baseUrl: z.string().url().optional(),
  credentialReference: z.string().min(1).optional(),
  externalAccountId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  name: z.string().min(2),
  providerType: z.nativeEnum(InventoryProviderType),
  sourceId: z.string().min(1).optional(),
  syncCron: z.string().min(5).optional(),
});

export async function GET() {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  const connections = await getInventoryProviderConnections(authResult.user!.tenantId!);
  return NextResponse.json({
    connections,
  });
}

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const connection = await createInventoryProviderConnection({
      baseUrl: payload.baseUrl,
      createdById: authResult.user!.id,
      credentialReference: payload.credentialReference,
      externalAccountId: payload.externalAccountId,
      metadata: payload.metadata,
      name: payload.name,
      providerType: payload.providerType,
      sourceId: payload.sourceId,
      syncCron: payload.syncCron,
      tenantId: authResult.user!.tenantId!,
    });

    return NextResponse.json({
      connection,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create inventory provider.",
      },
      { status: 400 },
    );
  }
}
