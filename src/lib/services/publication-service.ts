import {
  JobPriority,
  MessagingChannel,
  MessagingConnectionStatus,
  PublicationChannel,
  PublicationStatus,
  PublicationSyncReason,
  QueueJobType,
  type Prisma,
} from "@prisma/client";
import { createHash } from "crypto";

import { createAuditLog } from "@/lib/audit";
import {
  buildMarketplaceDescription,
  buildMarketplaceTitle,
  formatCurrency,
  formatNumber,
} from "@/lib/marketplace";
import { prisma } from "@/lib/prisma";
import { QUEUE_NAMES } from "@/lib/queue";
import {
  buildIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  reserveIdempotencyKey,
} from "@/lib/services/idempotency-service";
import { enqueueBackgroundJob } from "@/lib/services/job-service";

const publicationVehicleInclude = {
  images: {
    orderBy: {
      sortOrder: "asc",
    },
    take: 4,
  },
  publications: {
    include: {
      messagingConnection: {
        select: {
          id: true,
          pageId: true,
          pageName: true,
          pageUsername: true,
        },
      },
      metaAuthAccount: {
        select: {
          displayName: true,
          facebookUserId: true,
          id: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  },
  source: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.VehicleInclude;

type PublicationVehicleRecord = Prisma.VehicleGetPayload<{
  include: typeof publicationVehicleInclude;
}>;

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function publicationStatusFromQueueJobType(type: QueueJobType) {
  if (type === QueueJobType.PUBLICATION_UPDATE) {
    return PublicationStatus.UPDATE_QUEUED;
  }

  if (type === QueueJobType.PUBLICATION_ARCHIVE) {
    return PublicationStatus.UNPUBLISH_QUEUED;
  }

  return PublicationStatus.QUEUED;
}

function computePublicationFingerprint(vehicle: PublicationVehicleRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        condition: vehicle.condition,
        description: vehicle.description,
        detailPageUrl: vehicle.detailPageUrl,
        images: vehicle.images.map((image) => image.cachedAssetUrl || image.url),
        lifecycleStatus: vehicle.lifecycleStatus,
        mileage: vehicle.mileage,
        price: vehicle.price,
        sourceName: vehicle.source.name,
        title: buildMarketplaceTitle(vehicle) || vehicle.title,
        vin: vehicle.vin,
      }),
    )
    .digest("hex");
}

function buildPublicationPayload(input: {
  channel: PublicationChannel;
  connection: {
    pageId: string | null;
    pageName: string | null;
    pageUsername: string | null;
  } | null;
  metaAuthAccount: {
    displayName: string | null;
    facebookUserId: string;
  };
  vehicle: PublicationVehicleRecord;
}) {
  const title = buildMarketplaceTitle(input.vehicle) || input.vehicle.title || "Vehicle listing";
  const link = input.vehicle.detailPageUrl || input.vehicle.sourceUrl;
  const description = buildMarketplaceDescription(input.vehicle);
  const summary = [
    title,
    `Price: ${formatCurrency(input.vehicle.price)}`,
    input.vehicle.mileage ? `Mileage: ${formatNumber(input.vehicle.mileage)} miles` : null,
    `Source: ${input.vehicle.source.name}`,
    link,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    channel: input.channel,
    destination: {
      facebookUserId: input.metaAuthAccount.facebookUserId,
      ownerName: input.metaAuthAccount.displayName,
      pageId: input.connection?.pageId ?? null,
      pageName: input.connection?.pageName ?? null,
      pageUsername: input.connection?.pageUsername ?? null,
    },
    reviewNotes:
      input.channel === PublicationChannel.FACEBOOK_MARKETPLACE_REVIEW
        ? "Prepared for a manual Marketplace-compatible review workflow."
        : "Prepared for a Facebook Page review workflow.",
    vehicle: {
      bodyStyle: input.vehicle.bodyStyle,
      condition: input.vehicle.condition,
      description,
      detailPageUrl: link,
      drivetrain: input.vehicle.drivetrain,
      engine: input.vehicle.engine,
      exteriorColor: input.vehicle.exteriorColor,
      fuelType: input.vehicle.fuelType,
      images: input.vehicle.images.map((image) => image.cachedAssetUrl || image.url),
      interiorColor: input.vehicle.interiorColor,
      mileage: input.vehicle.mileage,
      price: input.vehicle.price,
      sourceName: input.vehicle.source.name,
      stockNumber: input.vehicle.stockNumber,
      summary,
      title,
      transmission: input.vehicle.transmission,
      trim: input.vehicle.trim,
      vin: input.vehicle.vin,
      year: input.vehicle.year,
    },
  };
}

export async function getTenantPublicationDestinations(tenantId: string) {
  const connections = await prisma.messagingConnection.findMany({
    where: {
      channel: MessagingChannel.FACEBOOK_PAGE_MESSENGER,
      metaAuthAccountId: {
        not: null,
      },
      postingEnabled: true,
      status: MessagingConnectionStatus.ACTIVE,
      tenantId,
    },
    include: {
      metaAuthAccount: {
        select: {
          displayName: true,
          facebookUserId: true,
          id: true,
          status: true,
        },
      },
    },
    orderBy: [
      {
        pageName: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  });

  return connections.map((connection) => ({
    facebookUserId: connection.metaAuthAccount?.facebookUserId ?? null,
    id: connection.id,
    metaAuthAccountId: connection.metaAuthAccountId,
    ownerName: connection.metaAuthAccount?.displayName ?? null,
    pageId: connection.pageId,
    pageName: connection.pageName,
    pageUsername: connection.pageUsername,
    status: connection.status,
  }));
}

async function queuePublicationJob(input: {
  createdById?: string | null;
  fingerprintKey?: string | null;
  publicationId: string;
  queueJobType: QueueJobType;
  tenantId: string;
}) {
  const scope =
    input.queueJobType === QueueJobType.PUBLICATION_ARCHIVE
      ? "publication-archive"
      : input.queueJobType === QueueJobType.PUBLICATION_UPDATE
        ? "publication-update"
        : "publication-create";

  const reservation = await reserveIdempotencyKey({
    expiresInSeconds: 30 * 60,
    key: buildIdempotencyKey([input.publicationId, scope, input.fingerprintKey]),
    payload: {
      fingerprintKey: input.fingerprintKey,
      publicationId: input.publicationId,
      type: input.queueJobType,
    },
    scope,
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

    throw new Error("A publication job for this destination is already queued.");
  }

  try {
    const backgroundJob = await enqueueBackgroundJob({
      createdById: input.createdById ?? undefined,
      idempotencyKeyId: reservation.record.id,
      payload: asJson({
        publicationId: input.publicationId,
      }),
      priority: JobPriority.NORMAL,
      queueName:
        input.queueJobType === QueueJobType.PUBLICATION_ARCHIVE
          ? QUEUE_NAMES.publicationArchive
          : input.queueJobType === QueueJobType.PUBLICATION_UPDATE
            ? QUEUE_NAMES.publicationUpdate
            : QUEUE_NAMES.publicationCreate,
      tenantId: input.tenantId,
      type: input.queueJobType,
    });

    await completeIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      resourceId: backgroundJob.id,
      resourceType: "BackgroundJob",
    });

    return backgroundJob;
  } catch (error) {
    await failIdempotencyKey({
      idempotencyKeyId: reservation.record.id,
      responsePayload: {
        error: error instanceof Error ? error.message : "Unable to queue publication job.",
      },
    });

    throw error;
  }
}

export async function queueVehiclePublications(input: {
  channel?: PublicationChannel;
  createdById?: string | null;
  messagingConnectionId: string;
  tenantId: string;
  vehicleIds: string[];
}) {
  const connection = await prisma.messagingConnection.findFirst({
    where: {
      id: input.messagingConnectionId,
      metaAuthAccountId: {
        not: null,
      },
      postingEnabled: true,
      tenantId: input.tenantId,
    },
    include: {
      metaAuthAccount: true,
    },
  });

  if (!connection?.metaAuthAccount) {
    throw new Error("That Facebook destination is not available for posting.");
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      id: {
        in: input.vehicleIds,
      },
      tenantId: input.tenantId,
    },
    include: publicationVehicleInclude,
  });

  const channel = input.channel ?? PublicationChannel.FACEBOOK_PAGE_POST;
  let queued = 0;
  let alreadyTracked = 0;

  for (const vehicle of vehicles) {
    const fingerprint = computePublicationFingerprint(vehicle);
    const existingPublication = vehicle.publications.find(
      (publication) =>
        publication.metaAuthAccountId === connection.metaAuthAccountId && publication.channel === channel,
    );

    const shouldQueueCreate = !existingPublication;
    const shouldQueueUpdate = existingPublication
      ? existingPublication.sourceFingerprint !== fingerprint ||
        existingPublication.messagingConnectionId !== connection.id ||
        existingPublication.status === PublicationStatus.FAILED ||
        existingPublication.status === PublicationStatus.UNPUBLISHED
      : false;

    if (!shouldQueueCreate && !shouldQueueUpdate) {
      alreadyTracked += 1;
      continue;
    }

    const publication = existingPublication
      ? await prisma.vehiclePublication.update({
          where: {
            id: existingPublication.id,
          },
          data: {
            createdById: input.createdById ?? undefined,
            errorText: null,
            lastErrorAt: null,
            messagingConnectionId: connection.id,
            postedMileage: vehicle.mileage,
            postedPrice: vehicle.price,
            sourceFingerprint: fingerprint,
            status: publicationStatusFromQueueJobType(
              shouldQueueUpdate ? QueueJobType.PUBLICATION_UPDATE : QueueJobType.PUBLICATION_CREATE,
            ),
            syncReason:
              existingPublication.status === PublicationStatus.UNPUBLISHED
                ? PublicationSyncReason.MANUAL_REFRESH
                : PublicationSyncReason.INITIAL_PUBLISH,
          },
        })
      : await prisma.vehiclePublication.create({
          data: {
            channel,
            createdById: input.createdById ?? undefined,
            messagingConnectionId: connection.id,
            metaAuthAccountId: connection.metaAuthAccountId!,
            postedMileage: vehicle.mileage,
            postedPrice: vehicle.price,
            sourceFingerprint: fingerprint,
            status: PublicationStatus.QUEUED,
            syncReason: PublicationSyncReason.INITIAL_PUBLISH,
            tenantId: input.tenantId,
            vehicleId: vehicle.id,
          },
        });

    await queuePublicationJob({
      createdById: input.createdById,
      fingerprintKey: publication.sourceFingerprint,
      publicationId: publication.id,
      queueJobType: shouldQueueUpdate ? QueueJobType.PUBLICATION_UPDATE : QueueJobType.PUBLICATION_CREATE,
      tenantId: input.tenantId,
    });

    queued += 1;
  }

  await createAuditLog({
    action: "publication.queue.bulk",
    actorId: input.createdById ?? undefined,
    entityId: connection.id,
    entityType: "MessagingConnection",
    metadata: asJson({
      alreadyTracked,
      channel,
      queued,
      vehicleIds: vehicles.map((vehicle) => vehicle.id),
    }),
    summary: `Queued ${queued} publication job(s) for ${connection.pageName || "the selected Facebook destination"}.`,
    tenantId: input.tenantId,
  });

  return {
    alreadyTracked,
    queued,
  };
}

export async function queuePublicationUpdatesForVehicles(input: {
  createdById?: string | null;
  syncReason?: PublicationSyncReason;
  tenantId: string;
  vehicleIds: string[];
}) {
  if (!input.vehicleIds.length) {
    return {
      queued: 0,
    };
  }

  const vehicles = await prisma.vehicle.findMany({
    where: {
      id: {
        in: input.vehicleIds,
      },
      tenantId: input.tenantId,
    },
    include: publicationVehicleInclude,
  });

  let queued = 0;

  for (const vehicle of vehicles) {
    const fingerprint = computePublicationFingerprint(vehicle);

    for (const publication of vehicle.publications) {
      if (
        publication.status === PublicationStatus.NOT_PUBLISHED ||
        publication.status === PublicationStatus.UNPUBLISHED
      ) {
        continue;
      }

      if (publication.sourceFingerprint === fingerprint) {
        continue;
      }

      const updatedPublication = await prisma.vehiclePublication.update({
        where: {
          id: publication.id,
        },
        data: {
          errorText: null,
          lastErrorAt: null,
          postedMileage: vehicle.mileage,
          postedPrice: vehicle.price,
          sourceFingerprint: fingerprint,
          status: PublicationStatus.UPDATE_QUEUED,
          syncReason: input.syncReason ?? PublicationSyncReason.INVENTORY_CHANGED,
        },
      });

      await queuePublicationJob({
        createdById: input.createdById,
        fingerprintKey: updatedPublication.sourceFingerprint,
        publicationId: updatedPublication.id,
        queueJobType: QueueJobType.PUBLICATION_UPDATE,
        tenantId: input.tenantId,
      });

      queued += 1;
    }
  }

  return {
    queued,
  };
}

export async function queuePublicationArchivesForVehicles(input: {
  createdById?: string | null;
  syncReason?: PublicationSyncReason;
  tenantId: string;
  vehicleIds: string[];
}) {
  if (!input.vehicleIds.length) {
    return {
      queued: 0,
    };
  }

  const publications = await prisma.vehiclePublication.findMany({
    where: {
      status: {
        in: [
          PublicationStatus.POSTED,
          PublicationStatus.UPDATED,
          PublicationStatus.NEEDS_REVIEW,
          PublicationStatus.QUEUED,
          PublicationStatus.UPDATE_QUEUED,
        ],
      },
      tenantId: input.tenantId,
      vehicleId: {
        in: input.vehicleIds,
      },
    },
  });

  let queued = 0;

  for (const publication of publications) {
    const updatedPublication = await prisma.vehiclePublication.update({
      where: {
        id: publication.id,
      },
      data: {
        status: PublicationStatus.UNPUBLISH_QUEUED,
        syncReason: input.syncReason ?? PublicationSyncReason.SOLD_OR_REMOVED,
      },
    });

    await queuePublicationJob({
      createdById: input.createdById,
      fingerprintKey: updatedPublication.sourceFingerprint ?? publication.id,
      publicationId: updatedPublication.id,
      queueJobType: QueueJobType.PUBLICATION_ARCHIVE,
      tenantId: input.tenantId,
    });

    queued += 1;
  }

  return {
    queued,
  };
}

export async function executePublicationJob(
  backgroundJobId: string,
  publicationId: string,
  queueJobType: QueueJobType,
) {
  const publication = await prisma.vehiclePublication.findUnique({
    where: {
      id: publicationId,
    },
    include: {
      messagingConnection: {
        select: {
          id: true,
          pageId: true,
          pageName: true,
          pageUsername: true,
        },
      },
      metaAuthAccount: {
        select: {
          displayName: true,
          facebookUserId: true,
          id: true,
        },
      },
      vehicle: {
        include: publicationVehicleInclude,
      },
    },
  });

  if (!publication?.vehicle) {
    throw new Error(`Publication not found: ${publicationId}`);
  }

  const fingerprint = computePublicationFingerprint(publication.vehicle);

  if (queueJobType === QueueJobType.PUBLICATION_ARCHIVE) {
    const archivePayload = {
      action: "archive-review",
      destination: {
        pageId: publication.messagingConnection?.pageId ?? null,
        pageName: publication.messagingConnection?.pageName ?? null,
      },
      vehicle: {
        stockNumber: publication.vehicle.stockNumber,
        title: buildMarketplaceTitle(publication.vehicle) || publication.vehicle.title,
        vin: publication.vehicle.vin,
      },
    };

    const updatedPublication = await prisma.vehiclePublication.update({
      where: {
        id: publication.id,
      },
      data: {
        errorText: null,
        externalListingId: publication.externalListingId ?? undefined,
        lastErrorAt: null,
        lastSyncedAt: new Date(),
        postedPayload: asJson(archivePayload),
        status:
          publication.externalListingId || publication.externalListingUrl
            ? PublicationStatus.UNPUBLISHED
            : PublicationStatus.NEEDS_REVIEW,
      },
    });

    await createAuditLog({
      action: "publication.archive.prepared",
      entityId: publication.id,
      entityType: "VehiclePublication",
      metadata: asJson({
        backgroundJobId,
      }),
      summary: `Prepared an archive/unpublish review payload for ${publication.vehicle.title || publication.vehicle.id}.`,
      tenantId: publication.tenantId,
    });

    return {
      publicationId: updatedPublication.id,
      status: updatedPublication.status,
    };
  }

  const payload = buildPublicationPayload({
    channel: publication.channel,
    connection: publication.messagingConnection,
    metaAuthAccount: publication.metaAuthAccount,
    vehicle: publication.vehicle,
  });

  const updatedPublication = await prisma.vehiclePublication.update({
    where: {
      id: publication.id,
    },
    data: {
      errorText: null,
      lastErrorAt: null,
      lastSyncedAt: new Date(),
      postedMileage: publication.vehicle.mileage,
      postedPayload: asJson(payload),
      postedPrice: publication.vehicle.price,
      sourceFingerprint: fingerprint,
      status:
        queueJobType === QueueJobType.PUBLICATION_UPDATE &&
        (publication.externalListingId || publication.externalListingUrl)
          ? PublicationStatus.UPDATED
          : PublicationStatus.NEEDS_REVIEW,
    },
  });

  if (publication.messagingConnectionId) {
    await prisma.messagingConnection.update({
      where: {
        id: publication.messagingConnectionId,
      },
      data: {
        lastPublishedAt: new Date(),
      },
    });
  }

  await prisma.vehicle.update({
    where: {
      id: publication.vehicleId,
    },
    data: {
      lastPublishFingerprint: fingerprint,
    },
  });

  await createAuditLog({
    action:
      queueJobType === QueueJobType.PUBLICATION_UPDATE
        ? "publication.update.prepared"
        : "publication.create.prepared",
    entityId: publication.id,
    entityType: "VehiclePublication",
    metadata: asJson({
      backgroundJobId,
      destinationPageId: publication.messagingConnection?.pageId ?? null,
    }),
    summary: `Prepared a ${queueJobType === QueueJobType.PUBLICATION_UPDATE ? "publication update" : "publication"} payload for ${publication.vehicle.title || publication.vehicle.id}.`,
    tenantId: publication.tenantId,
  });

  return {
    publicationId: updatedPublication.id,
    status: updatedPublication.status,
  };
}
