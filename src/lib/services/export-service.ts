import {
  ExportJobItemStatus,
  JobPriority,
  QueueJobStatus,
  QueueJobType,
  VehicleChangeType,
  VehicleExportStatus,
  type ExportFormat,
  type Prisma,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { serializeMarketplaceExport } from "@/lib/marketplace";
import { prisma } from "@/lib/prisma";
import { QUEUE_NAMES } from "@/lib/queue";
import {
  buildIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashSelectionFingerprint,
  reserveIdempotencyKey,
} from "@/lib/services/idempotency-service";
import { enqueueBackgroundJob } from "@/lib/services/job-service";
import { buildStorageKey, storeTextObject } from "@/lib/storage";

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function recordExportChangeEvents(input: {
  nextStatus: VehicleExportStatus;
  summary: string;
  tenantId: string;
  vehicleIds: string[];
}) {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      id: {
        in: input.vehicleIds,
      },
      tenantId: input.tenantId,
    },
    select: {
      exportStatus: true,
      id: true,
    },
  });

  if (!vehicles.length) {
    return;
  }

  await prisma.vehicleChangeEvent.createMany({
    data: vehicles.map((vehicle) => ({
      changeType: VehicleChangeType.STATUS_CHANGED,
      fieldName: "exportStatus",
      nextValue: input.nextStatus,
      previousValue: vehicle.exportStatus,
      summary: input.summary,
      tenantId: input.tenantId,
      vehicleId: vehicle.id,
    })),
  });
}

export async function queueExportJob(input: {
  createdById?: string | null;
  format: ExportFormat;
  tenantId: string;
  vehicleIds: string[];
}) {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      id: {
        in: input.vehicleIds,
      },
      tenantId: input.tenantId,
    },
    select: {
      id: true,
    },
  });

  if (!vehicles.length) {
    throw new Error("No tenant-scoped vehicles were found for export.");
  }

  const sortedVehicleIds = vehicles.map((vehicle) => vehicle.id).sort();
  const idempotencyReservation = await reserveIdempotencyKey({
    expiresInSeconds: 60 * 60,
    key: buildIdempotencyKey([
      input.format,
      hashSelectionFingerprint(sortedVehicleIds),
    ]),
    payload: {
      format: input.format,
      vehicleIds: sortedVehicleIds,
    },
    scope: "export-job",
    tenantId: input.tenantId,
  });

  if (!idempotencyReservation.isNew) {
    if (idempotencyReservation.record.resourceId) {
      const existingExportJob = await prisma.exportJob.findUnique({
        where: {
          id: idempotencyReservation.record.resourceId,
        },
      });

      if (existingExportJob) {
        return existingExportJob;
      }
    }

    const existingBackgroundJob = await prisma.backgroundJob.findFirst({
      where: {
        idempotencyKeyId: idempotencyReservation.record.id,
        tenantId: input.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existingBackgroundJob) {
      const existingExportJob = await prisma.exportJob.findFirst({
        where: {
          backgroundJobId: existingBackgroundJob.id,
        },
      });

      if (existingExportJob) {
        return existingExportJob;
      }
    }

    throw new Error("An export request for this selection is already being prepared.");
  }

  try {
    const exportJob = await prisma.exportJob.create({
      data: {
        createdById: input.createdById ?? undefined,
        filters: asJson({ vehicleIds: sortedVehicleIds }),
        format: input.format,
        itemCount: vehicles.length,
        items: {
          create: vehicles.map((vehicle) => ({
            status: ExportJobItemStatus.PENDING,
            tenantId: input.tenantId,
            vehicleId: vehicle.id,
          })),
        },
        tenantId: input.tenantId,
      },
    });

    await prisma.vehicle.updateMany({
      where: {
        id: {
          in: sortedVehicleIds,
        },
      },
      data: {
        exportStatus: VehicleExportStatus.QUEUED,
      },
    });

    await recordExportChangeEvents({
      nextStatus: VehicleExportStatus.QUEUED,
      summary: "Vehicle was added to an export queue.",
      tenantId: input.tenantId,
      vehicleIds: sortedVehicleIds,
    });

    const backgroundJob = await enqueueBackgroundJob({
      createdById: input.createdById ?? undefined,
      idempotencyKeyId: idempotencyReservation.record.id,
      payload: asJson({ exportJobId: exportJob.id }),
      priority: JobPriority.NORMAL,
      queueName: QUEUE_NAMES.exportGeneration,
      tenantId: input.tenantId,
      type: QueueJobType.EXPORT_GENERATION,
    });

    const updatedExportJob = await prisma.exportJob.update({
      where: {
        id: exportJob.id,
      },
      data: {
        backgroundJobId: backgroundJob.id,
      },
    });

    await completeIdempotencyKey({
      idempotencyKeyId: idempotencyReservation.record.id,
      resourceId: updatedExportJob.id,
      resourceType: "ExportJob",
      responsePayload: {
        exportJobId: updatedExportJob.id,
      },
    });

    await createAuditLog({
      action: "export.queued",
      actorId: input.createdById ?? undefined,
      entityId: updatedExportJob.id,
      entityType: "ExportJob",
      metadata: asJson({ format: input.format, vehicleIds: sortedVehicleIds }),
      summary: `Queued export job for ${vehicles.length} vehicle(s).`,
      tenantId: input.tenantId,
    });

    return updatedExportJob;
  } catch (error) {
    await failIdempotencyKey({
      idempotencyKeyId: idempotencyReservation.record.id,
      responsePayload: {
        error: error instanceof Error ? error.message : "Unable to queue export job.",
      },
    });
    throw error;
  }
}

export async function executeExportJob(exportJobId: string) {
  const exportJob = await prisma.exportJob.findUnique({
    where: {
      id: exportJobId,
    },
    include: {
      items: {
        include: {
          vehicle: true,
        },
      },
    },
  });

  if (!exportJob) {
    throw new Error(`Export job not found: ${exportJobId}`);
  }

  const vehicleIds = exportJob.items.map((item) => item.vehicleId);

  await prisma.$transaction([
    prisma.exportJob.update({
      where: {
        id: exportJob.id,
      },
      data: {
        status: QueueJobStatus.PROCESSING,
      },
    }),
    prisma.exportJobItem.updateMany({
      where: {
        exportJobId: exportJob.id,
      },
      data: {
        status: ExportJobItemStatus.PROCESSING,
      },
    }),
    prisma.vehicle.updateMany({
      where: {
        id: {
          in: vehicleIds,
        },
      },
      data: {
        exportAttemptCount: {
          increment: 1,
        },
        exportStatus: VehicleExportStatus.PROCESSING,
      },
    }),
  ]);

  await recordExportChangeEvents({
    nextStatus: VehicleExportStatus.PROCESSING,
    summary: "Vehicle export is processing.",
    tenantId: exportJob.tenantId,
    vehicleIds,
  });

  const fileStamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const extension = exportJob.format === "CSV" ? "csv" : "json";
  const fileName = `${exportJob.tenantId}-inventory-export-${fileStamp}.${extension}`;
  const contentType =
    exportJob.format === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
  const storageKey = buildStorageKey("tenants", exportJob.tenantId, "exports", fileName);
  const storedObject = await storeTextObject(
    storageKey,
    contentType,
    serializeMarketplaceExport(
      exportJob.items.map((item) => item.vehicle),
      exportJob.format,
    ),
  );

  const completedAt = new Date();

  await prisma.$transaction([
    prisma.exportJob.update({
      where: {
        id: exportJob.id,
      },
      data: {
        completedAt,
        failureCount: 0,
        fileName,
        status: QueueJobStatus.COMPLETED,
        storageKey: storedObject.key,
        storagePath: storedObject.key,
        storageProvider: storedObject.provider,
        successCount: vehicleIds.length,
      },
    }),
    prisma.exportJobItem.updateMany({
      where: {
        exportJobId: exportJob.id,
      },
      data: {
        status: ExportJobItemStatus.COMPLETED,
      },
    }),
    prisma.vehicle.updateMany({
      where: {
        id: {
          in: vehicleIds,
        },
      },
      data: {
        exportStatus: VehicleExportStatus.COMPLETED,
        lastExportedAt: completedAt,
      },
    }),
  ]);

  await recordExportChangeEvents({
    nextStatus: VehicleExportStatus.COMPLETED,
    summary: "Vehicle export completed successfully.",
    tenantId: exportJob.tenantId,
    vehicleIds,
  });

  await createAuditLog({
    action: "export.completed",
    actorId: exportJob.createdById ?? undefined,
    entityId: exportJob.id,
    entityType: "ExportJob",
    metadata: asJson({
      fileName,
      itemCount: vehicleIds.length,
      storageKey: storedObject.key,
      storageProvider: storedObject.provider,
    }),
    summary: `Export job completed: ${fileName}.`,
    tenantId: exportJob.tenantId,
  });

  return {
    fileName,
    itemCount: vehicleIds.length,
    storagePath: storedObject.key,
  };
}

export async function failExportJob(exportJobId: string, errorText: string) {
  const exportJob = await prisma.exportJob.findUnique({
    where: {
      id: exportJobId,
    },
    include: {
      items: true,
    },
  });

  if (!exportJob) {
    return null;
  }

  const vehicleIds = exportJob.items.map((item) => item.vehicleId);

  await prisma.$transaction([
    prisma.exportJob.update({
      where: {
        id: exportJob.id,
      },
      data: {
        errorText,
        failureCount: vehicleIds.length,
        status: QueueJobStatus.FAILED,
      },
    }),
    prisma.exportJobItem.updateMany({
      where: {
        exportJobId: exportJob.id,
      },
      data: {
        errorText,
        status: ExportJobItemStatus.FAILED,
      },
    }),
    prisma.vehicle.updateMany({
      where: {
        id: {
          in: vehicleIds,
        },
      },
      data: {
        exportStatus: VehicleExportStatus.FAILED,
      },
    }),
  ]);

  await recordExportChangeEvents({
    nextStatus: VehicleExportStatus.FAILED,
    summary: "Vehicle export failed and needs review.",
    tenantId: exportJob.tenantId,
    vehicleIds,
  });

  await createAuditLog({
    action: "export.failed",
    actorId: exportJob.createdById ?? undefined,
    entityId: exportJob.id,
    entityType: "ExportJob",
    metadata: asJson({ errorText }),
    summary: "Export job failed.",
    tenantId: exportJob.tenantId,
  });

  return exportJob;
}
