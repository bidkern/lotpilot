import {
  IntegrationStatus,
  InventoryProviderType,
  JobPriority,
  QueueJobType,
  type Prisma,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { QUEUE_NAMES } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import {
  buildIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  reserveIdempotencyKey,
} from "@/lib/services/idempotency-service";
import { enqueueBackgroundJob } from "@/lib/services/job-service";
import { queueSourceSync } from "@/lib/services/inventory-service";

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

export async function createInventoryProviderConnection(input: {
  baseUrl?: string | null;
  createdById?: string | null;
  credentialReference?: string | null;
  externalAccountId?: string | null;
  metadata?: unknown;
  name: string;
  providerType: InventoryProviderType;
  sourceId?: string | null;
  syncCron?: string | null;
  tenantId: string;
}) {
  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.inventoryProviderConnection.create({
      data: {
        baseUrl: input.baseUrl ?? undefined,
        createdById: input.createdById ?? undefined,
        credentialReference: input.credentialReference ?? undefined,
        externalAccountId: input.externalAccountId ?? undefined,
        metadata: input.metadata !== undefined ? asJson(input.metadata) : undefined,
        name: input.name,
        providerType: input.providerType,
        status:
          input.providerType === InventoryProviderType.WEBSITE_SCRAPER
            ? IntegrationStatus.ACTIVE
            : IntegrationStatus.PENDING,
        syncCron: input.syncCron ?? undefined,
        tenantId: input.tenantId,
      },
    });

    if (input.sourceId) {
      const source = await tx.inventorySource.findFirst({
        where: {
          id: input.sourceId,
          tenantId: input.tenantId,
        },
        select: {
          id: true,
        },
      });

      if (source) {
        await tx.inventorySource.update({
          where: {
            id: source.id,
          },
          data: {
            inventoryProviderConnectionId: created.id,
            providerType: input.providerType,
          },
        });
      }
    }

    return created;
  });

  await createAuditLog({
    action: "provider.connection.created",
    actorId: input.createdById ?? undefined,
    entityId: connection.id,
    entityType: "InventoryProviderConnection",
    metadata: asJson({
      providerType: input.providerType,
      sourceId: input.sourceId,
    }),
    summary: `Created ${input.providerType} provider connection ${input.name}.`,
    tenantId: input.tenantId,
  });

  return connection;
}

export async function getInventoryProviderConnections(tenantId: string) {
  const connections = await prisma.inventoryProviderConnection.findMany({
    where: {
      tenantId,
    },
    include: {
      inventorySources: {
        select: {
          id: true,
          lastSyncedAt: true,
          name: true,
          status: true,
        },
      },
    },
    orderBy: [
      {
        providerType: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return connections.map((connection) => ({
    baseUrl: connection.baseUrl,
    createdAt: connection.createdAt.toISOString(),
    credentialReference: connection.credentialReference,
    externalAccountId: connection.externalAccountId,
    id: connection.id,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    linkedSources: connection.inventorySources.map((source) => ({
      id: source.id,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      name: source.name,
      status: source.status,
    })),
    metadata: connection.metadata,
    name: connection.name,
    providerType: connection.providerType,
    status: connection.status,
    syncCron: connection.syncCron,
  }));
}

export async function queueInventoryProviderSync(input: {
  createdById?: string | null;
  providerConnectionId: string;
  tenantId: string;
}) {
  const connection = await prisma.inventoryProviderConnection.findFirst({
    where: {
      id: input.providerConnectionId,
      tenantId: input.tenantId,
    },
  });

  if (!connection) {
    throw new Error("Inventory provider connection not found.");
  }

  const reservation = await reserveIdempotencyKey({
    expiresInSeconds: 30 * 60,
    key: buildIdempotencyKey([connection.id, "provider-sync"]),
    payload: {
      providerConnectionId: connection.id,
    },
    scope: "provider-sync",
    tenantId: input.tenantId,
  });

  if (!reservation.isNew) {
    const existingJob = await prisma.backgroundJob.findFirst({
      where: {
        idempotencyKeyId: reservation.record.id,
        tenantId: input.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existingJob) {
      return existingJob;
    }

    throw new Error("A provider sync is already queued for this connection.");
  }

  try {
    const backgroundJob = await enqueueBackgroundJob({
      createdById: input.createdById ?? undefined,
      idempotencyKeyId: reservation.record.id,
      payload: asJson({
        providerConnectionId: connection.id,
      }),
      priority: JobPriority.NORMAL,
      queueName: QUEUE_NAMES.providerSync,
      tenantId: input.tenantId,
      type: QueueJobType.PROVIDER_SYNC,
    });

    await completeIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      resourceId: backgroundJob.id,
      resourceType: "BackgroundJob",
    });

    await createAuditLog({
      action: "provider.sync.queued",
      actorId: input.createdById ?? undefined,
      entityId: connection.id,
      entityType: "InventoryProviderConnection",
      summary: `Queued a provider sync for ${connection.name}.`,
      tenantId: input.tenantId,
    });

    return backgroundJob;
  } catch (error) {
    await failIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      responsePayload: {
        error: error instanceof Error ? error.message : "Unable to queue provider sync.",
      },
    });
    throw error;
  }
}

export async function executeInventoryProviderSync(backgroundJobId: string, providerConnectionId: string) {
  const connection = await prisma.inventoryProviderConnection.findUnique({
    where: {
      id: providerConnectionId,
    },
    include: {
      inventorySources: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  });

  if (!connection) {
    throw new Error(`Provider connection not found: ${providerConnectionId}`);
  }

  const syncableSources = connection.inventorySources.filter(
    (source) => source.status !== "ARCHIVED" && source.status !== "FAILED",
  );

  const queuedSourceRuns = [];
  for (const source of syncableSources) {
    try {
      const syncRun = await queueSourceSync({
        createdById: connection.createdById,
        sourceId: source.id,
        tenantId: connection.tenantId,
      });
      queuedSourceRuns.push({
        id: syncRun.id,
        sourceId: source.id,
        sourceName: source.name,
      });
    } catch {
      continue;
    }
  }

  const updatedConnection = await prisma.inventoryProviderConnection.update({
    where: {
      id: connection.id,
    },
    data: {
      lastSyncedAt: new Date(),
      status:
        connection.providerType === InventoryProviderType.VAUTO && !syncableSources.length
          ? IntegrationStatus.ACTION_REQUIRED
          : IntegrationStatus.ACTIVE,
    },
  });

  await createAuditLog({
    action: "provider.sync.completed",
    entityId: connection.id,
    entityType: "InventoryProviderConnection",
    metadata: asJson({
      backgroundJobId,
      queuedSourceRuns,
    }),
    summary: `Provider sync completed for ${connection.name}.`,
    tenantId: connection.tenantId,
  });

  return {
    providerConnectionId: updatedConnection.id,
    queuedSourceRuns,
    status: updatedConnection.status,
  };
}
