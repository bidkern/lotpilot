import {
  JobPriority,
  QueueJobStatus,
  QueueJobType,
  SyncHealthStatus,
  UserRole,
  VehicleChangeType,
  VehicleExportStatus,
  VehicleLifecycleStatus,
  type PrismaClient,
  type Prisma,
  type Vehicle,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { QUEUE_NAMES } from "@/lib/queue";
import { getSourceAdapter } from "@/lib/source-adapters";
import type { ScrapedVehicleRecord } from "@/lib/source-adapters/types";
import { getMessagingWorkspaceData } from "@/lib/services/conversation-service";
import {
  assignVehiclesRoundRobin,
  getTenantListingAutomationData,
  queueListingSoldTasksForVehicles,
  queueListingUpdatesForVehicles,
} from "@/lib/services/listing-assignment-service";
import { cacheVehicleImagesForVehicle } from "@/lib/services/media-service";
import {
  buildIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashSelectionFingerprint,
  reserveIdempotencyKey,
} from "@/lib/services/idempotency-service";
import { enqueueBackgroundJob } from "@/lib/services/job-service";
import {
  getTenantPublicationDestinations,
  queuePublicationArchivesForVehicles,
  queuePublicationUpdatesForVehicles,
} from "@/lib/services/publication-service";
import { getTenantSubscriptionSummary } from "@/lib/services/subscription-service";
import { normalizeVehiclePrice } from "@/lib/vehicle-price";

const trackedVehicleFields = [
  "title",
  "price",
  "mileage",
  "stockNumber",
  "bodyStyle",
  "drivetrain",
  "engine",
  "transmission",
  "fuelType",
  "exteriorColor",
  "interiorColor",
  "description",
  "primaryImageUrl",
  "detailPageUrl",
  "lifecycleStatus",
  "exportStatus",
] as const;

export type DashboardVehicleStatus =
  | "ACTIVE"
  | "STALE"
  | "ARCHIVED"
  | "NEEDS_REVIEW"
  | "EXPORT_READY"
  | "EXPORTED"
  | "EXPORT_FAILED";

type ActorContext = {
  id: string;
  role: UserRole;
};

type DbClient = Prisma.TransactionClient | PrismaClient;

export type InventoryTableQuery = {
  exportStatus?: VehicleExportStatus | "ALL";
  make?: string | null;
  maxPrice?: number | null;
  minPrice?: number | null;
  model?: string | null;
  page?: number;
  pageSize?: number;
  search?: string | null;
  sourceId?: string | null;
  workflowStatus?: DashboardVehicleStatus | "ALL";
  year?: number | null;
};

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildVehicleTitle(scraped: ScrapedVehicleRecord) {
  return (
    scraped.title ||
    [scraped.year, scraped.make, scraped.model, scraped.trim].filter(Boolean).join(" ").trim() ||
    "Untitled Vehicle"
  );
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number";
}

function isVehicleExportReady(input: {
  description?: string | null;
  price?: number | null;
  primaryImageUrl?: string | null;
  title?: string | null;
}) {
  return Boolean(input.title && input.price && input.primaryImageUrl && input.description);
}

function deriveDashboardStatus(
  vehicle: Pick<
    Vehicle,
    "description" | "exportStatus" | "isArchived" | "lifecycleStatus" | "price" | "primaryImageUrl" | "title"
  >,
): DashboardVehicleStatus {
  if (vehicle.isArchived || vehicle.lifecycleStatus === VehicleLifecycleStatus.ARCHIVED) {
    return "ARCHIVED";
  }

  if (
    vehicle.lifecycleStatus === VehicleLifecycleStatus.STALE ||
    vehicle.lifecycleStatus === VehicleLifecycleStatus.REMOVED
  ) {
    return "STALE";
  }

  if (vehicle.exportStatus === VehicleExportStatus.FAILED) {
    return "EXPORT_FAILED";
  }

  if (vehicle.exportStatus === VehicleExportStatus.COMPLETED) {
    return "EXPORTED";
  }

  if (
    vehicle.exportStatus === VehicleExportStatus.QUEUED ||
    vehicle.exportStatus === VehicleExportStatus.PROCESSING
  ) {
    return "ACTIVE";
  }

  return isVehicleExportReady(vehicle) ? "EXPORT_READY" : "NEEDS_REVIEW";
}

function normalizeInventoryTableQuery(query?: InventoryTableQuery) {
  return {
    exportStatus: query?.exportStatus ?? "ALL",
    make: query?.make?.trim() || null,
    maxPrice:
      typeof query?.maxPrice === "number" && Number.isFinite(query.maxPrice) ? query.maxPrice : null,
    minPrice:
      typeof query?.minPrice === "number" && Number.isFinite(query.minPrice) ? query.minPrice : null,
    model: query?.model?.trim() || null,
    page: clampNumber(query?.page ?? 1, 1, 10_000),
    pageSize: clampNumber(query?.pageSize ?? 25, 1, 100),
    search: query?.search?.trim() || null,
    sourceId: query?.sourceId?.trim() || null,
    workflowStatus: query?.workflowStatus ?? "ALL",
    year: typeof query?.year === "number" && Number.isFinite(query.year) ? query.year : null,
  } satisfies Required<InventoryTableQuery>;
}

function buildWorkflowStatusWhere(status: DashboardVehicleStatus): Prisma.VehicleWhereInput {
  switch (status) {
    case "ARCHIVED":
      return {
        OR: [
          {
            isArchived: true,
          },
          {
            lifecycleStatus: VehicleLifecycleStatus.ARCHIVED,
          },
        ],
      };
    case "STALE":
      return {
        isArchived: false,
        lifecycleStatus: {
          in: [VehicleLifecycleStatus.REMOVED, VehicleLifecycleStatus.STALE],
        },
      };
    case "EXPORT_FAILED":
      return {
        exportStatus: VehicleExportStatus.FAILED,
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
      };
    case "EXPORTED":
      return {
        exportStatus: VehicleExportStatus.COMPLETED,
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
      };
    case "ACTIVE":
      return {
        exportStatus: {
          in: [VehicleExportStatus.PROCESSING, VehicleExportStatus.QUEUED],
        },
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
      };
    case "EXPORT_READY":
      return {
        description: {
          not: null,
        },
        exportStatus: VehicleExportStatus.NOT_EXPORTED,
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
        price: {
          not: null,
        },
        primaryImageUrl: {
          not: null,
        },
        title: {
          not: null,
        },
      };
    case "NEEDS_REVIEW":
      return {
        exportStatus: VehicleExportStatus.NOT_EXPORTED,
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
        OR: [
          {
            description: null,
          },
          {
            price: null,
          },
          {
            primaryImageUrl: null,
          },
          {
            title: null,
          },
        ],
      };
  }
}

export function buildVehicleWhereInput(
  tenantId: string,
  query?: InventoryTableQuery,
): Prisma.VehicleWhereInput {
  const normalized = normalizeInventoryTableQuery(query);
  const andConditions: Prisma.VehicleWhereInput[] = [
    {
      tenantId,
    },
  ];

  if (normalized.sourceId) {
    andConditions.push({
      sourceId: normalized.sourceId,
    });
  }

  if (normalized.make) {
    andConditions.push({
      make: normalized.make,
    });
  }

  if (normalized.model) {
    andConditions.push({
      model: normalized.model,
    });
  }

  if (normalized.year) {
    andConditions.push({
      year: normalized.year,
    });
  }

  if (normalized.exportStatus !== "ALL") {
    andConditions.push({
      exportStatus: normalized.exportStatus,
    });
  }

  if (normalized.workflowStatus !== "ALL") {
    andConditions.push(buildWorkflowStatusWhere(normalized.workflowStatus));
  }

  if (normalized.minPrice !== null) {
    andConditions.push({
      price: {
        gte: normalized.minPrice,
      },
    });
  }

  if (normalized.maxPrice !== null) {
    andConditions.push({
      price: {
        lte: normalized.maxPrice,
      },
    });
  }

  if (normalized.search) {
    const search = normalized.search;
    const searchTerms = search.split(/\s+/).filter(Boolean);
    andConditions.push({
      OR: [
        {
          vin: {
            startsWith: search,
            mode: "insensitive",
          },
        },
        {
          stockNumber: {
            startsWith: search,
            mode: "insensitive",
          },
        },
        {
          make: {
            startsWith: search,
            mode: "insensitive",
          },
        },
        {
          model: {
            startsWith: search,
            mode: "insensitive",
          },
        },
        {
          title: {
            contains: search,
            mode: "insensitive",
          },
        },
        ...(searchTerms.length > 1
          ? [
              {
                AND: searchTerms.map((term) => ({
                  OR: [
                    {
                      make: {
                        contains: term,
                        mode: "insensitive",
                      },
                    },
                    {
                      model: {
                        contains: term,
                        mode: "insensitive",
                      },
                    },
                    {
                      title: {
                        contains: term,
                        mode: "insensitive",
                      },
                    },
                  ],
                })),
              } satisfies Prisma.VehicleWhereInput,
            ]
          : []),
      ],
    });
  }

  return {
    AND: andConditions,
  };
}

function stringifyComparableValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

async function runListingAutomationSafely(
  tenantId: string,
  operationName: string,
  operation: () => Promise<unknown>,
) {
  try {
    await operation();
  } catch (error) {
    logger.warn("Listing automation operation failed", {
      error: error instanceof Error ? error.message : String(error),
      operationName,
      tenantId,
    });
  }
}

const vehicleDashboardInclude = {
  changeEvents: {
    orderBy: {
      createdAt: "desc",
    },
    take: 5,
  },
  images: {
    orderBy: {
      sortOrder: "asc",
    },
  },
  snapshots: {
    orderBy: {
      capturedAt: "desc",
    },
    take: 5,
  },
  source: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  listingAssignment: {
    include: {
      assigneeMembership: {
        include: {
          user: {
            select: {
              email: true,
              id: true,
              name: true,
            },
          },
        },
      },
      tasks: {
        orderBy: [
          {
            status: "asc",
          },
          {
            createdAt: "desc",
          },
        ],
        take: 2,
      },
    },
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
} satisfies Prisma.VehicleInclude;

type DashboardVehicleRecord = Prisma.VehicleGetPayload<{
  include: typeof vehicleDashboardInclude;
}>;

function serializeDashboardVehicle(vehicle: DashboardVehicleRecord) {
  const workflowStatus = deriveDashboardStatus(vehicle);
  const exportReady = isVehicleExportReady(vehicle);

  return {
    bodyStyle: vehicle.bodyStyle,
    changeEvents: vehicle.changeEvents.map((event) => ({
      changeType: event.changeType,
      createdAt: event.createdAt.toISOString(),
      fieldName: event.fieldName,
      id: event.id,
      nextValue: event.nextValue,
      previousValue: event.previousValue,
      summary: event.summary,
    })),
    condition: vehicle.condition,
    description: vehicle.description,
    detailPageUrl: vehicle.detailPageUrl,
    drivetrain: vehicle.drivetrain,
    engine: vehicle.engine,
    exportAttemptCount: vehicle.exportAttemptCount,
    exportReady,
    exportStatus: vehicle.exportStatus,
    exteriorColor: vehicle.exteriorColor,
    firstSeenAt: vehicle.firstSeenAt.toISOString(),
    fuelType: vehicle.fuelType,
    id: vehicle.id,
    images: vehicle.images.map((image) => ({
      cachedAssetUrl: image.cachedAssetUrl,
      id: image.id,
      sortOrder: image.sortOrder,
      url: image.url,
    })),
    interiorColor: vehicle.interiorColor,
    isArchived: vehicle.isArchived,
    lastExportedAt: vehicle.lastExportedAt?.toISOString() ?? null,
    lastSeenAt: vehicle.lastSeenAt.toISOString(),
    lastUpdatedAt: vehicle.lastUpdatedAt.toISOString(),
    lifecycleStatus: vehicle.lifecycleStatus,
    make: vehicle.make,
    mileage: vehicle.mileage,
    model: vehicle.model,
    price: vehicle.price,
    primaryImageUrl: vehicle.primaryImageUrl,
    listingAssignment: vehicle.listingAssignment
      ? {
          assignee: {
            email: vehicle.listingAssignment.assigneeMembership.user.email,
            id: vehicle.listingAssignment.assigneeMembership.user.id,
            membershipId: vehicle.listingAssignment.assigneeMembership.id,
            name: vehicle.listingAssignment.assigneeMembership.user.name,
          },
          id: vehicle.listingAssignment.id,
          lastStatusAt: vehicle.listingAssignment.lastStatusAt?.toISOString() ?? null,
          listingOrder: vehicle.listingAssignment.assigneeMembership.listingOrder,
          listingUrl: vehicle.listingAssignment.listingUrl,
          postedAt: vehicle.listingAssignment.postedAt?.toISOString() ?? null,
          status: vehicle.listingAssignment.status,
          tasks: vehicle.listingAssignment.tasks.map((task) => ({
            id: task.id,
            status: task.status,
            taskType: task.taskType,
            title: task.title,
            updatedAt: task.updatedAt.toISOString(),
          })),
        }
      : null,
    publications: vehicle.publications.map((publication) => ({
      channel: publication.channel,
      externalListingId: publication.externalListingId,
      externalListingUrl: publication.externalListingUrl,
      id: publication.id,
      lastSyncedAt: publication.lastSyncedAt?.toISOString() ?? null,
      messagingConnection: publication.messagingConnection
        ? {
            id: publication.messagingConnection.id,
            pageId: publication.messagingConnection.pageId,
            pageName: publication.messagingConnection.pageName,
            pageUsername: publication.messagingConnection.pageUsername,
          }
        : null,
      metaAuthAccount: {
        displayName: publication.metaAuthAccount.displayName,
        facebookUserId: publication.metaAuthAccount.facebookUserId,
        id: publication.metaAuthAccount.id,
      },
      status: publication.status,
      syncReason: publication.syncReason,
      updatedAt: publication.updatedAt.toISOString(),
    })),
    snapshots: vehicle.snapshots.map((snapshot) => ({
      capturedAt: snapshot.capturedAt.toISOString(),
      exportStatus: snapshot.exportStatus,
      id: snapshot.id,
      lifecycleStatus: snapshot.lifecycleStatus,
      mileage: snapshot.mileage,
      price: snapshot.price,
      primaryImageUrl: snapshot.primaryImageUrl,
      title: snapshot.title,
    })),
    source: vehicle.source,
    sourceUrl: vehicle.sourceUrl,
    stockNumber: vehicle.stockNumber,
    title: vehicle.title,
    transmission: vehicle.transmission,
    trim: vehicle.trim,
    vin: vehicle.vin,
    workflowStatus,
    year: vehicle.year,
  };
}

function buildSourceSlug(name: string, websiteUrl: string) {
  const hostname = new URL(websiteUrl).hostname.replace(/^www\./, "");
  const seed = `${name}-${hostname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return seed.slice(0, 60) || hostname.replace(/[^a-z0-9]+/g, "-");
}

async function uniqueSourceSlug(tenantId: string, name: string, websiteUrl: string) {
  const base = buildSourceSlug(name, websiteUrl);

  for (let index = 0; index < 100; index += 1) {
    const slug = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.inventorySource.findUnique({
      where: {
        tenantId_slug: {
          slug,
          tenantId,
        },
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return slug;
    }
  }

  throw new Error("Unable to allocate a unique inventory source slug.");
}

async function recordVehicleChangeEvents(input: {
  db: DbClient;
  nextVehicle: Pick<
    Vehicle,
    | "bodyStyle"
    | "description"
    | "detailPageUrl"
    | "drivetrain"
    | "engine"
    | "exportStatus"
    | "exteriorColor"
    | "fuelType"
    | "interiorColor"
    | "lifecycleStatus"
    | "mileage"
    | "price"
    | "primaryImageUrl"
    | "stockNumber"
    | "title"
    | "transmission"
  >;
  previousVehicle:
    | Pick<
        Vehicle,
        | "bodyStyle"
        | "description"
        | "detailPageUrl"
        | "drivetrain"
        | "engine"
        | "exportStatus"
        | "exteriorColor"
        | "fuelType"
        | "interiorColor"
        | "lifecycleStatus"
        | "mileage"
        | "price"
        | "primaryImageUrl"
        | "stockNumber"
        | "title"
        | "transmission"
      >
    | null;
  syncRunId?: string | null;
  tenantId: string;
  vehicleId: string;
}) {
  if (!input.previousVehicle) {
    await input.db.vehicleChangeEvent.create({
      data: {
        changeType: VehicleChangeType.CREATED,
        summary: "Vehicle was created during sync.",
        syncRunId: input.syncRunId ?? undefined,
        tenantId: input.tenantId,
        vehicleId: input.vehicleId,
      },
    });

    return { changed: true, created: true };
  }

  const changeEvents: Prisma.VehicleChangeEventCreateManyInput[] = [];

  for (const field of trackedVehicleFields) {
    const previousValue = stringifyComparableValue(input.previousVehicle[field]);
    const nextValue = stringifyComparableValue(input.nextVehicle[field]);

    if (previousValue === nextValue) {
      continue;
    }

    changeEvents.push({
      changeType:
        field === "price"
          ? VehicleChangeType.PRICE_CHANGED
          : field === "lifecycleStatus" || field === "exportStatus"
            ? VehicleChangeType.STATUS_CHANGED
            : VehicleChangeType.UPDATED,
      fieldName: field,
      nextValue,
      previousValue,
      summary: `${field} changed from "${previousValue || "empty"}" to "${nextValue || "empty"}".`,
      syncRunId: input.syncRunId ?? undefined,
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
    });
  }

  if (changeEvents.length) {
    await input.db.vehicleChangeEvent.createMany({
      data: changeEvents,
    });
  }

  return { changed: changeEvents.length > 0, created: false };
}

async function recordVehicleSnapshot(input: {
  db: DbClient;
  payload: Prisma.InputJsonValue;
  syncRunId?: string | null;
  tenantId: string;
  vehicle: Pick<
    Vehicle,
    "exportStatus" | "id" | "lifecycleStatus" | "mileage" | "price" | "primaryImageUrl" | "title"
  >;
}) {
  await input.db.vehicleSnapshot.create({
    data: {
      capturedAt: new Date(),
      exportStatus: input.vehicle.exportStatus,
      lifecycleStatus: input.vehicle.lifecycleStatus,
      mileage: input.vehicle.mileage,
      payload: input.payload,
      price: input.vehicle.price,
      primaryImageUrl: input.vehicle.primaryImageUrl,
      syncRunId: input.syncRunId ?? undefined,
      tenantId: input.tenantId,
      title: input.vehicle.title,
      vehicleId: input.vehicle.id,
    },
  });
}

async function upsertVehicleFromScrape(input: {
  scraped: ScrapedVehicleRecord;
  source: {
    id: string;
    sourceProfileId: string | null;
    tenantId: string;
  };
  syncRunId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const primaryImageUrl = input.scraped.imageUrls[0] ?? null;
    const title = buildVehicleTitle(input.scraped);
    const normalizedPrice = normalizeVehiclePrice(input.scraped.price, {
      allowCentNormalization: false,
    });
    const matchers: Prisma.VehicleWhereInput[] = [
      {
        sourceId: input.source.id,
        sourceVehicleKey: input.scraped.sourceVehicleKey,
      },
    ];

    if (input.scraped.vin) {
      matchers.unshift({ vin: input.scraped.vin });
    }

    const existing = await tx.vehicle.findFirst({
      where: {
        OR: matchers,
        tenantId: input.source.tenantId,
      },
    });

    const nextLifecycleStatus =
      existing?.isArchived || existing?.lifecycleStatus === VehicleLifecycleStatus.ARCHIVED
        ? VehicleLifecycleStatus.ARCHIVED
        : VehicleLifecycleStatus.ACTIVE;

    const nextExportStatus = existing?.exportStatus ?? VehicleExportStatus.NOT_EXPORTED;
    const rawPayload = asJson({
      ...input.scraped.rawPayload,
      normalizedPrice,
      scrapedPrice: input.scraped.price,
      sourceUrl: input.scraped.sourceUrl,
      syncedAt: now.toISOString(),
    });

    if (input.scraped.price !== null && normalizedPrice === null) {
      logger.warn("Discarded suspicious vehicle price during sync", {
        scrapedPrice: input.scraped.price,
        sourceId: input.source.id,
        tenantId: input.source.tenantId,
        url: input.scraped.sourceUrl,
        vin: input.scraped.vin,
      });
    }

    const vehicle = existing
      ? await tx.vehicle.update({
          where: {
            id: existing.id,
          },
          data: {
            bodyStyle: input.scraped.bodyStyle,
            condition: input.scraped.condition,
            description: input.scraped.description,
            detailPageUrl: input.scraped.sourceUrl,
            drivetrain: input.scraped.drivetrain,
            engine: input.scraped.engine,
            exportStatus: nextExportStatus,
            exteriorColor: input.scraped.exteriorColor,
            fuelType: input.scraped.fuelType,
            images: {
              create: input.scraped.imageUrls.map((url, index) => ({
                sortOrder: index,
                sourceLabel: "source",
                tenantId: input.source.tenantId,
                url,
              })),
              deleteMany: {},
            },
            interiorColor: input.scraped.interiorColor,
            lastSeenAt: now,
            lastUpdatedAt: now,
            lifecycleStatus: nextLifecycleStatus,
            make: input.scraped.make,
            mileage: input.scraped.mileage,
            model: input.scraped.model,
            price: normalizedPrice,
            primaryImageUrl: primaryImageUrl ?? existing.primaryImageUrl,
            rawPayload,
            removedAt:
              nextLifecycleStatus === VehicleLifecycleStatus.ARCHIVED ? existing.removedAt : null,
            sourceId: input.source.id,
            sourceProfileId: input.source.sourceProfileId,
            sourceUrl: input.scraped.sourceUrl,
            sourceVehicleKey: input.scraped.sourceVehicleKey,
            stockNumber: input.scraped.stockNumber,
            title,
            transmission: input.scraped.transmission,
            trim: input.scraped.trim,
            vin: input.scraped.vin,
            year: input.scraped.year,
          },
        })
      : await tx.vehicle.create({
          data: {
            bodyStyle: input.scraped.bodyStyle,
            condition: input.scraped.condition,
            description: input.scraped.description,
            detailPageUrl: input.scraped.sourceUrl,
            drivetrain: input.scraped.drivetrain,
            engine: input.scraped.engine,
            exportStatus: VehicleExportStatus.NOT_EXPORTED,
            exteriorColor: input.scraped.exteriorColor,
            firstSeenAt: now,
            fuelType: input.scraped.fuelType,
            images: {
              create: input.scraped.imageUrls.map((url, index) => ({
                sortOrder: index,
                sourceLabel: "source",
                tenantId: input.source.tenantId,
                url,
              })),
            },
            interiorColor: input.scraped.interiorColor,
            lastSeenAt: now,
            lastUpdatedAt: now,
            lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
            make: input.scraped.make,
            mileage: input.scraped.mileage,
            model: input.scraped.model,
            price: normalizedPrice,
            primaryImageUrl,
            rawPayload,
            sourceId: input.source.id,
            sourceProfileId: input.source.sourceProfileId,
            sourceUrl: input.scraped.sourceUrl,
            sourceVehicleKey: input.scraped.sourceVehicleKey,
            stockNumber: input.scraped.stockNumber,
            tenantId: input.source.tenantId,
            title,
            transmission: input.scraped.transmission,
            trim: input.scraped.trim,
            vin: input.scraped.vin,
            year: input.scraped.year,
          },
        });

    await recordVehicleSnapshot({
      db: tx,
      payload: rawPayload,
      syncRunId: input.syncRunId,
      tenantId: input.source.tenantId,
      vehicle,
    });

    const changeResult = await recordVehicleChangeEvents({
      db: tx,
      nextVehicle: vehicle,
      previousVehicle: existing,
      syncRunId: input.syncRunId,
      tenantId: input.source.tenantId,
      vehicleId: vehicle.id,
    });

    return {
      changeResult,
      vehicle,
    };
  });
}

async function markVehiclesStale(input: {
  seenVehicleIds: string[];
  sourceId: string;
  syncRunId: string;
  tenantId: string;
}) {
  const staleCandidates = await prisma.vehicle.findMany({
    where: {
      id: {
        notIn: input.seenVehicleIds.length ? input.seenVehicleIds : ["__none__"],
      },
      isArchived: false,
      sourceId: input.sourceId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      lifecycleStatus: true,
    },
  });

  const now = new Date();

  await prisma.vehicle.updateMany({
    where: {
      id: {
        in: staleCandidates.map((vehicle) => vehicle.id),
      },
    },
    data: {
      lifecycleStatus: VehicleLifecycleStatus.STALE,
      removedAt: now,
    },
  });

  const transitioned = staleCandidates.filter(
    (vehicle) => vehicle.lifecycleStatus !== VehicleLifecycleStatus.STALE,
  );

  if (transitioned.length) {
    await prisma.vehicleChangeEvent.createMany({
      data: transitioned.map((vehicle) => ({
        changeType: VehicleChangeType.STATUS_CHANGED,
        fieldName: "lifecycleStatus",
        nextValue: VehicleLifecycleStatus.STALE,
        previousValue: vehicle.lifecycleStatus,
        summary: "Vehicle was not seen during the latest sync and is now stale.",
        syncRunId: input.syncRunId,
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
      })),
    });
  }

  return {
    count: staleCandidates.length,
    vehicleIds: staleCandidates.map((vehicle) => vehicle.id),
  };
}

function dedupeScrapedVehicles(vehicles: ScrapedVehicleRecord[]) {
  return Array.from(
    new Map(
      vehicles.map((vehicle) => [vehicle.vin ?? vehicle.sourceVehicleKey, vehicle]),
    ).values(),
  );
}

function buildSourceHealthAlerts(input: {
  metric: {
    failedCount: number;
    missingPriceCount: number;
    missingVinCount: number;
    staleVehicleCount: number;
    successRate: number | null;
    vehicleCount: number;
  };
  previousMetric?: {
    vehicleCount: number;
  } | null;
}) {
  const alerts: Array<{
    code: string;
    message: string;
    severity: SyncHealthStatus;
    title: string;
  }> = [];
  const vehicleFloor = Math.max(1, input.metric.vehicleCount);

  if (input.metric.failedCount > 0) {
    alerts.push({
      code: "sync-failures",
      message: `${input.metric.failedCount} listing(s) failed to persist during the latest sync run.`,
      severity:
        input.metric.failedCount >= Math.max(5, Math.ceil(vehicleFloor * 0.1))
          ? SyncHealthStatus.CRITICAL
          : SyncHealthStatus.WARNING,
      title: "Sync failures detected",
    });
  }

  if (input.metric.missingVinCount >= Math.max(3, Math.ceil(vehicleFloor * 0.12))) {
    alerts.push({
      code: "missing-vin",
      message: `${input.metric.missingVinCount} vehicle(s) are missing VINs, which can break dedupe and export workflows.`,
      severity: SyncHealthStatus.WARNING,
      title: "VIN coverage dropped",
    });
  }

  if (input.metric.missingPriceCount >= Math.max(3, Math.ceil(vehicleFloor * 0.12))) {
    alerts.push({
      code: "missing-price",
      message: `${input.metric.missingPriceCount} vehicle(s) are missing prices, which can block export-ready status.`,
      severity: SyncHealthStatus.WARNING,
      title: "Pricing coverage dropped",
    });
  }

  if (input.metric.staleVehicleCount >= Math.max(5, Math.ceil(vehicleFloor * 0.3))) {
    alerts.push({
      code: "stale-inventory",
      message: `${input.metric.staleVehicleCount} vehicle(s) are currently stale and may need review.`,
      severity: SyncHealthStatus.WARNING,
      title: "Stale inventory increased",
    });
  }

  if (
    input.previousMetric?.vehicleCount &&
    input.previousMetric.vehicleCount >= 10 &&
    input.metric.vehicleCount < Math.floor(input.previousMetric.vehicleCount * 0.65)
  ) {
    alerts.push({
      code: "inventory-drop",
      message: `Inventory count fell from ${input.previousMetric.vehicleCount} to ${input.metric.vehicleCount} between syncs.`,
      severity: SyncHealthStatus.CRITICAL,
      title: "Inventory count dropped sharply",
    });
  }

  if (input.metric.successRate !== null && input.metric.successRate < 0.8) {
    alerts.push({
      code: "low-success-rate",
      message: `Sync success rate dropped to ${Math.round(input.metric.successRate * 100)}%.`,
      severity: SyncHealthStatus.WARNING,
      title: "Sync success rate is low",
    });
  }

  return alerts;
}

async function reconcileSourceHealthAlerts(input: {
  alerts: ReturnType<typeof buildSourceHealthAlerts>;
  sourceId: string;
  syncRunId: string;
  tenantId: string;
}) {
  const activeAlerts = await prisma.sourceHealthAlert.findMany({
    where: {
      isResolved: false,
      sourceId: input.sourceId,
      tenantId: input.tenantId,
    },
  });

  const activeAlertByCode = new Map(activeAlerts.map((alert) => [alert.code, alert]));
  const nextCodes = new Set(input.alerts.map((alert) => alert.code));

  await Promise.all(
    input.alerts.map((alert) => {
      const existing = activeAlertByCode.get(alert.code);

      if (existing) {
        return prisma.sourceHealthAlert.update({
          where: {
            id: existing.id,
          },
          data: {
            isResolved: false,
            message: alert.message,
            metadata: asJson({ syncRunId: input.syncRunId }),
            resolvedAt: null,
            severity: alert.severity,
            title: alert.title,
          },
        });
      }

      return prisma.sourceHealthAlert.create({
        data: {
          code: alert.code,
          message: alert.message,
          metadata: asJson({ syncRunId: input.syncRunId }),
          severity: alert.severity,
          sourceId: input.sourceId,
          syncRunId: input.syncRunId,
          tenantId: input.tenantId,
          title: alert.title,
        },
      });
    }),
  );

  const resolvedAlertIds = activeAlerts
    .filter((alert) => !nextCodes.has(alert.code))
    .map((alert) => alert.id);

  if (resolvedAlertIds.length) {
    await prisma.sourceHealthAlert.updateMany({
      where: {
        id: {
          in: resolvedAlertIds,
        },
      },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
      },
    });
  }
}

async function createSyncHealthMetric(input: {
  failedCount: number;
  sourceId: string;
  syncRunId: string;
  tenantId: string;
  totalFound: number;
}) {
  const previousMetric = await prisma.syncHealthMetric.findFirst({
    where: {
      sourceId: input.sourceId,
      tenantId: input.tenantId,
    },
    orderBy: {
      observedAt: "desc",
    },
  });

  const vehicles = await prisma.vehicle.findMany({
    where: {
      sourceId: input.sourceId,
      tenantId: input.tenantId,
    },
    select: {
      lifecycleStatus: true,
      price: true,
      vin: true,
    },
  });

  const vehicleCount = vehicles.length;
  const staleVehicleCount = vehicles.filter(
    (vehicle) => vehicle.lifecycleStatus === VehicleLifecycleStatus.STALE,
  ).length;
  const missingVinCount = vehicles.filter((vehicle) => !vehicle.vin).length;
  const missingPriceCount = vehicles.filter((vehicle) => !vehicle.price).length;
  const successRate =
    input.totalFound > 0 ? Math.max(0, (input.totalFound - input.failedCount) / input.totalFound) : null;

  const status =
    input.failedCount > 0 || (successRate !== null && successRate < 0.8)
      ? SyncHealthStatus.WARNING
      : missingVinCount > 0 || missingPriceCount > 0
        ? SyncHealthStatus.WARNING
        : SyncHealthStatus.HEALTHY;

  const metric = await prisma.syncHealthMetric.create({
    data: {
      failedCount: input.failedCount,
      missingPriceCount,
      missingVinCount,
      notes:
        missingVinCount || missingPriceCount
          ? "Some vehicles are missing fields required for complete export workflows."
          : "Inventory sync completed successfully.",
      observedAt: new Date(),
      sourceId: input.sourceId,
      staleVehicleCount,
      status,
      successRate,
      tenantId: input.tenantId,
      vehicleCount,
    },
  });

  const alerts = buildSourceHealthAlerts({
    metric: {
      failedCount: input.failedCount,
      missingPriceCount,
      missingVinCount,
      staleVehicleCount,
      successRate,
      vehicleCount,
    },
    previousMetric: previousMetric
      ? {
          vehicleCount: previousMetric.vehicleCount,
        }
      : null,
  });

  await reconcileSourceHealthAlerts({
    alerts,
    sourceId: input.sourceId,
    syncRunId: input.syncRunId,
    tenantId: input.tenantId,
  });

  return metric;
}

export async function createInventorySource(input: {
  adapterKey?: string | null;
  baseUrl: string;
  inventoryUrl?: string | null;
  name: string;
  status: "DETECTING" | "DRAFT" | "REQUIRES_REVIEW" | "ACTIVE";
  tenantId: string;
  websiteUrl: string;
}) {
  const slug = await uniqueSourceSlug(input.tenantId, input.name, input.websiteUrl);

  return prisma.inventorySource.create({
    data: {
      adapterKey: input.adapterKey ?? undefined,
      baseUrl: input.baseUrl,
      inventoryUrl: input.inventoryUrl ?? undefined,
      name: input.name,
      slug,
      status: input.status,
      tenantId: input.tenantId,
      websiteUrl: input.websiteUrl,
    },
  });
}

export async function getInventoryTableData(tenantId: string, query?: InventoryTableQuery) {
  const normalizedQuery = normalizeInventoryTableQuery(query);
  const where = buildVehicleWhereInput(tenantId, normalizedQuery);
  const inventoryScopeWhere: Prisma.VehicleWhereInput = {
    tenantId,
    ...(normalizedQuery.sourceId
      ? {
          sourceId: normalizedQuery.sourceId,
        }
      : {}),
  };

  const [totalFiltered, totalInventory, filterMakeRows, filterModelRows, filterYearRows, statRows] =
    await Promise.all([
      prisma.vehicle.count({
        where,
      }),
      prisma.vehicle.count({
        where: inventoryScopeWhere,
      }),
      prisma.vehicle.findMany({
        distinct: ["make"],
        orderBy: {
          make: "asc",
        },
        select: {
          make: true,
        },
        where: inventoryScopeWhere,
      }),
      prisma.vehicle.findMany({
        distinct: ["model"],
        orderBy: {
          model: "asc",
        },
        select: {
          model: true,
        },
        where: inventoryScopeWhere,
      }),
      prisma.vehicle.findMany({
        distinct: ["year"],
        orderBy: {
          year: "desc",
        },
        select: {
          year: true,
        },
        where: inventoryScopeWhere,
      }),
      prisma.vehicle.findMany({
        select: {
          description: true,
          exportStatus: true,
          isArchived: true,
          lifecycleStatus: true,
          price: true,
          primaryImageUrl: true,
          title: true,
        },
        where: inventoryScopeWhere,
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / normalizedQuery.pageSize));
  const safePage = Math.min(normalizedQuery.page, totalPages);
  const vehicles = await prisma.vehicle.findMany({
    where,
    include: vehicleDashboardInclude,
    orderBy: {
      updatedAt: "desc",
    },
    skip: (safePage - 1) * normalizedQuery.pageSize,
    take: normalizedQuery.pageSize,
  });

  const stats = statRows.reduce(
    (accumulator, vehicle) => {
      const status = deriveDashboardStatus(vehicle);
      accumulator.total += 1;

      if (status === "ACTIVE") {
        accumulator.active += 1;
      } else if (status === "ARCHIVED") {
        accumulator.archived += 1;
      } else if (status === "EXPORT_READY") {
        accumulator.exportReady += 1;
      } else if (status === "EXPORTED") {
        accumulator.exported += 1;
      } else if (status === "NEEDS_REVIEW") {
        accumulator.needsReview += 1;
      } else if (status === "STALE") {
        accumulator.stale += 1;
      }

      return accumulator;
    },
    {
      active: 0,
      archived: 0,
      exportReady: 0,
      exported: 0,
      needsReview: 0,
      stale: 0,
      total: 0,
    },
  );

  return {
    filters: {
      makes: filterMakeRows.map((row) => row.make).filter(isNonEmptyString),
      models: filterModelRows.map((row) => row.model).filter(isNonEmptyString),
      years: filterYearRows.map((row) => row.year).filter(isNumber),
    },
    pagination: {
      page: safePage,
      pageSize: normalizedQuery.pageSize,
      totalFiltered,
      totalInventory,
      totalPages,
    },
    query: normalizedQuery,
    stats,
    vehicles: vehicles.map(serializeDashboardVehicle),
  };
}

export async function getVehicleIdsForQuery(tenantId: string, query?: InventoryTableQuery) {
  const rows = await prisma.vehicle.findMany({
    select: {
      id: true,
    },
    where: buildVehicleWhereInput(tenantId, query),
  });

  return rows.map((row) => row.id);
}

export async function getDashboardData(
  tenantId: string,
  query?: InventoryTableQuery,
  viewer?: {
    role: import("@prisma/client").UserRole;
    userId: string;
  },
) {
  const [
    tenant,
    inventory,
    sources,
    recentSyncRuns,
    exportJobs,
      recentAlerts,
      subscription,
      messaging,
      listingAutomation,
      providerConnections,
      publicationDestinations,
    ] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: {
          id: tenantId,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      }),
      getInventoryTableData(tenantId, query),
      prisma.inventorySource.findMany({
        where: {
          tenantId,
        },
        include: {
          detectionRuns: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
          inventoryProviderConnection: {
            select: {
              id: true,
              name: true,
              providerType: true,
              status: true,
            },
          },
          sourceHealthAlerts: {
            orderBy: {
              createdAt: "desc",
            },
            take: 3,
            where: {
              isResolved: false,
            },
          },
          sourceProfile: true,
          syncHealthMetrics: {
            orderBy: {
              observedAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
      prisma.syncRun.findMany({
        where: {
          tenantId,
        },
        include: {
          source: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
      }),
      prisma.exportJob.findMany({
        where: {
          tenantId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
      }),
      prisma.sourceHealthAlert.findMany({
        include: {
          source: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
        where: {
          isResolved: false,
          tenantId,
        },
      }),
      getTenantSubscriptionSummary(tenantId),
      getMessagingWorkspaceData(tenantId, viewer),
      getTenantListingAutomationData(tenantId),
      prisma.inventoryProviderConnection.findMany({
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
      }),
      getTenantPublicationDestinations(tenantId),
    ]);

  return {
    exportJobs: exportJobs.map((job) => ({
      completedAt: job.completedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      errorText: job.errorText,
      fileName: job.fileName,
      format: job.format,
      id: job.id,
      itemCount: job.itemCount,
      status: job.status,
      storageKey: job.storageKey,
      storagePath: job.storagePath,
      storageProvider: job.storageProvider,
      successCount: job.successCount,
    })),
    inventory,
    messaging: {
      accounts: messaging.accounts,
      connections: messaging.connections,
      openHandoffs: messaging.openHandoffs,
      primaryConnection: messaging.primaryConnection,
      publicationDestinations,
      recentConversations: messaging.recentConversations,
      subscription,
    },
    listingAutomation,
    providerConnections: providerConnections.map((connection) => ({
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
    })),
    recentAlerts: recentAlerts.map((alert) => ({
      code: alert.code,
      createdAt: alert.createdAt.toISOString(),
      id: alert.id,
      message: alert.message,
      severity: alert.severity,
      sourceName: alert.source.name,
      title: alert.title,
    })),
    recentSyncRuns: recentSyncRuns.map((run) => ({
      archivedCount: run.archivedCount,
      createdAt: run.createdAt.toISOString(),
      createdCount: run.createdCount,
      failedCount: run.failedCount,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      id: run.id,
      notes: run.notes,
      sourceName: run.source.name,
      startedAt: run.startedAt?.toISOString() ?? null,
      status: run.status,
      totalFound: run.totalFound,
      unchangedCount: run.unchangedCount,
      updatedCount: run.updatedCount,
    })),
    sources: sources.map((source) => ({
      adapterKey: source.adapterKey,
      baseUrl: source.baseUrl,
      id: source.id,
      inventoryUrl: source.inventoryUrl,
      inventoryProviderConnection: source.inventoryProviderConnection
        ? {
            id: source.inventoryProviderConnection.id,
            name: source.inventoryProviderConnection.name,
            providerType: source.inventoryProviderConnection.providerType,
            status: source.inventoryProviderConnection.status,
          }
        : null,
      lastDetectionRun: source.detectionRuns[0]
        ? {
            confidence: source.detectionRuns[0].confidence,
            createdAt: source.detectionRuns[0].createdAt.toISOString(),
            id: source.detectionRuns[0].id,
            requiresReview: source.detectionRuns[0].requiresReview,
            status: source.detectionRuns[0].status,
            strategy: source.detectionRuns[0].primaryStrategy,
            summary: source.detectionRuns[0].summary,
          }
        : null,
      lastHealthMetric: source.syncHealthMetrics[0]
        ? {
            failedCount: source.syncHealthMetrics[0].failedCount,
            missingPriceCount: source.syncHealthMetrics[0].missingPriceCount,
            missingVinCount: source.syncHealthMetrics[0].missingVinCount,
            observedAt: source.syncHealthMetrics[0].observedAt.toISOString(),
            staleVehicleCount: source.syncHealthMetrics[0].staleVehicleCount,
            status: source.syncHealthMetrics[0].status,
            successRate: source.syncHealthMetrics[0].successRate,
            vehicleCount: source.syncHealthMetrics[0].vehicleCount,
          }
        : null,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      name: source.name,
      openAlerts: source.sourceHealthAlerts.map((alert) => ({
        code: alert.code,
        createdAt: alert.createdAt.toISOString(),
        id: alert.id,
        message: alert.message,
        severity: alert.severity,
        title: alert.title,
      })),
      requiresReview: source.requiresReview,
      sourceProfileStatus: source.sourceProfile?.status ?? null,
      status: source.status,
      syncCron: source.syncCron,
      websiteUrl: source.websiteUrl,
    })),
    stats: inventory.stats,
    tenant,
  };
}

export async function queueSourceSync(input: {
  createdById?: string | null;
  sourceId: string;
  tenantId: string;
}) {
  const source = await prisma.inventorySource.findFirst({
    where: {
      id: input.sourceId,
      tenantId: input.tenantId,
    },
    include: {
      sourceProfile: true,
    },
  });

  if (!source) {
    throw new Error("Inventory source not found.");
  }

  if (!source.adapterKey) {
    throw new Error("This inventory source does not have an automated source adapter yet.");
  }

  const existingSyncRun = await prisma.syncRun.findFirst({
    where: {
      sourceId: input.sourceId,
      status: {
        in: [QueueJobStatus.PROCESSING, QueueJobStatus.QUEUED, QueueJobStatus.RETRYING],
      },
      tenantId: input.tenantId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingSyncRun) {
    return existingSyncRun;
  }

  const idempotencyReservation = await reserveIdempotencyKey({
    expiresInSeconds: 60 * 60,
    key: buildIdempotencyKey([input.sourceId]),
    payload: {
      sourceId: input.sourceId,
    },
    scope: "inventory-sync",
    tenantId: input.tenantId,
  });

  if (!idempotencyReservation.isNew) {
    if (idempotencyReservation.record.resourceId) {
      const existingRunById = await prisma.syncRun.findUnique({
        where: {
          id: idempotencyReservation.record.resourceId,
        },
      });

      if (existingRunById) {
        return existingRunById;
      }
    }

    const existingJob = await prisma.backgroundJob.findFirst({
      where: {
        idempotencyKeyId: idempotencyReservation.record.id,
        tenantId: input.tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (existingJob) {
      const linkedSyncRun = await prisma.syncRun.findFirst({
        where: {
          backgroundJobId: existingJob.id,
        },
      });

      if (linkedSyncRun) {
        return linkedSyncRun;
      }
    }

    throw new Error("A sync request for this source is already being prepared.");
  }

  try {
    const syncRun = await prisma.syncRun.create({
      data: {
        detectionStrategy: source.sourceProfile?.detectionStrategy ?? undefined,
        sourceId: source.id,
        status: QueueJobStatus.QUEUED,
        tenantId: input.tenantId,
        triggeredById: input.createdById ?? undefined,
      },
    });

    const backgroundJob = await enqueueBackgroundJob({
      createdById: input.createdById ?? undefined,
      idempotencyKeyId: idempotencyReservation.record.id,
      payload: asJson({ syncRunId: syncRun.id }),
      priority: JobPriority.NORMAL,
      queueName: QUEUE_NAMES.inventorySync,
      sourceId: source.id,
      tenantId: input.tenantId,
      type: QueueJobType.SOURCE_SYNC,
    });

    const updatedSyncRun = await prisma.syncRun.update({
      where: {
        id: syncRun.id,
      },
      data: {
        backgroundJobId: backgroundJob.id,
      },
    });

    await completeIdempotencyKey({
      idempotencyKeyId: idempotencyReservation.record.id,
      resourceId: updatedSyncRun.id,
      resourceType: "SyncRun",
      responsePayload: {
        syncRunId: updatedSyncRun.id,
      },
    });

    await createAuditLog({
      action: "inventory.sync.queued",
      actorId: input.createdById ?? undefined,
      entityId: updatedSyncRun.id,
      entityType: "SyncRun",
      metadata: asJson({ sourceId: source.id }),
      summary: `Queued an inventory sync for ${source.name}.`,
      tenantId: input.tenantId,
    });

    return updatedSyncRun;
  } catch (error) {
    await failIdempotencyKey({
      idempotencyKeyId: idempotencyReservation.record.id,
      responsePayload: {
        error: error instanceof Error ? error.message : "Unable to queue source sync.",
      },
    });
    throw error;
  }
}

export async function queueVehicleRefresh(input: {
  createdById?: string | null;
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
      sourceId: true,
    },
  });

  if (!vehicles.length) {
    throw new Error("No tenant-scoped vehicles were found for refresh.");
  }

  const grouped = new Map<string, string[]>();
  for (const vehicle of vehicles) {
    const current = grouped.get(vehicle.sourceId) ?? [];
    current.push(vehicle.id);
    grouped.set(vehicle.sourceId, current);
  }

  const jobs = await Promise.all(
    Array.from(grouped.entries()).map(async ([sourceId, groupedVehicleIds]) => {
      const idempotencyReservation = await reserveIdempotencyKey({
        expiresInSeconds: 30 * 60,
        key: buildIdempotencyKey([
          sourceId,
          hashSelectionFingerprint([...groupedVehicleIds].sort()),
        ]),
        payload: {
          sourceId,
          vehicleIds: [...groupedVehicleIds].sort(),
        },
        scope: "vehicle-refresh",
        tenantId: input.tenantId,
      });

      if (!idempotencyReservation.isNew) {
        const existingJob = await prisma.backgroundJob.findFirst({
          where: {
            idempotencyKeyId: idempotencyReservation.record.id,
            tenantId: input.tenantId,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        if (existingJob) {
          return existingJob;
        }

        throw new Error("A refresh request for this selection is already being prepared.");
      }

      try {
        const backgroundJob = await enqueueBackgroundJob({
          createdById: input.createdById ?? undefined,
          idempotencyKeyId: idempotencyReservation.record.id,
          payload: asJson({ vehicleIds: groupedVehicleIds }),
          priority: JobPriority.NORMAL,
          queueName: QUEUE_NAMES.vehicleRefresh,
          sourceId,
          tenantId: input.tenantId,
          type: QueueJobType.VEHICLE_REFRESH,
        });

        await completeIdempotencyKey({
          idempotencyKeyId: idempotencyReservation.record.id,
          resourceId: backgroundJob.id,
          resourceType: "BackgroundJob",
        });

        return backgroundJob;
      } catch (error) {
        await failIdempotencyKey({
          idempotencyKeyId: idempotencyReservation.record.id,
          responsePayload: {
            error: error instanceof Error ? error.message : "Unable to queue vehicle refresh.",
          },
        });
        throw error;
      }
    }),
  );

  await createAuditLog({
    action: "inventory.refresh.queued",
    actorId: input.createdById ?? undefined,
    entityId: jobs[0]?.id ?? "vehicle-refresh",
    entityType: "BackgroundJob",
    metadata: asJson({ vehicleIds: input.vehicleIds }),
    summary: `Queued ${jobs.length} refresh job(s).`,
    tenantId: input.tenantId,
  });

  return jobs;
}

export async function archiveVehicles(input: {
  actor?: ActorContext | null;
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
      lifecycleStatus: true,
    },
  });

  const now = new Date();

  await prisma.vehicle.updateMany({
    where: {
      id: {
        in: vehicles.map((vehicle) => vehicle.id),
      },
    },
    data: {
      archivedAt: now,
      isArchived: true,
      lifecycleStatus: VehicleLifecycleStatus.ARCHIVED,
      removedAt: now,
    },
  });

  if (vehicles.length) {
    await prisma.vehicleChangeEvent.createMany({
      data: vehicles.map((vehicle) => ({
        changeType: VehicleChangeType.ARCHIVED,
        fieldName: "lifecycleStatus",
        nextValue: VehicleLifecycleStatus.ARCHIVED,
        previousValue: vehicle.lifecycleStatus,
        summary: "Vehicle was archived from the tenant dashboard.",
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
      })),
    });
  }

  await createAuditLog({
    action: "vehicle.archive.bulk",
    actorId: input.actor?.id,
    entityId: vehicles.map((vehicle) => vehicle.id).join(","),
    entityType: "Vehicle",
    metadata: asJson({ vehicleIds: vehicles.map((vehicle) => vehicle.id) }),
    summary: `Archived ${vehicles.length} vehicle(s).`,
    tenantId: input.tenantId,
  });

  await queuePublicationArchivesForVehicles({
    createdById: input.actor?.id,
    tenantId: input.tenantId,
    vehicleIds: vehicles.map((vehicle) => vehicle.id),
  });

  await runListingAutomationSafely(input.tenantId, "archiveVehicles.queueListingSoldTasks", () =>
    queueListingSoldTasksForVehicles({
      createdById: input.actor?.id,
      tenantId: input.tenantId,
      vehicleIds: vehicles.map((vehicle) => vehicle.id),
    }),
  );

  return {
    archivedCount: vehicles.length,
  };
}

export async function markVehiclesExported(input: {
  actor?: ActorContext | null;
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

  const now = new Date();

  await prisma.vehicle.updateMany({
    where: {
      id: {
        in: vehicles.map((vehicle) => vehicle.id),
      },
    },
    data: {
      exportStatus: VehicleExportStatus.COMPLETED,
      lastExportedAt: now,
    },
  });

  if (vehicles.length) {
    await prisma.vehicleChangeEvent.createMany({
      data: vehicles.map((vehicle) => ({
        changeType: VehicleChangeType.EXPORT_MARKED,
        fieldName: "exportStatus",
        nextValue: VehicleExportStatus.COMPLETED,
        previousValue: vehicle.exportStatus,
        summary: "Vehicle was marked as exported by a tenant user.",
        tenantId: input.tenantId,
        vehicleId: vehicle.id,
      })),
    });
  }

  await createAuditLog({
    action: "vehicle.export.marked",
    actorId: input.actor?.id,
    entityId: vehicles.map((vehicle) => vehicle.id).join(","),
    entityType: "Vehicle",
    metadata: asJson({ vehicleIds: vehicles.map((vehicle) => vehicle.id) }),
    summary: `Marked ${vehicles.length} vehicle(s) as exported.`,
    tenantId: input.tenantId,
  });

  return {
    markedCount: vehicles.length,
  };
}

export async function executeSourceSync(syncRunId: string) {
  const syncRun = await prisma.syncRun.findUnique({
    where: {
      id: syncRunId,
    },
    include: {
      source: {
        include: {
          sourceProfile: true,
        },
      },
    },
  });

  if (!syncRun) {
    throw new Error(`Sync run not found: ${syncRunId}`);
  }

  if (!syncRun.source.adapterKey) {
    throw new Error("This source has no automated adapter configured.");
  }

  const adapter = getSourceAdapter(syncRun.source.adapterKey);

  await prisma.syncRun.update({
    where: {
      id: syncRun.id,
    },
    data: {
      startedAt: new Date(),
      status: QueueJobStatus.PROCESSING,
    },
  });

  const scrapeResult = await adapter.scrapeInventory({
    baseUrl: syncRun.source.baseUrl,
    inventoryUrl: syncRun.source.inventoryUrl,
    slug: syncRun.source.slug,
  });
  const dedupedVehicles = dedupeScrapedVehicles(scrapeResult.vehicles);

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  const seenVehicleIds: string[] = [];
  const touchedVehicleIds = new Set<string>();
  const newVehicleIds = new Set<string>();

  for (let index = 0; index < dedupedVehicles.length; index += env.INVENTORY_PERSIST_BATCH_SIZE) {
    const batch = dedupedVehicles.slice(index, index + env.INVENTORY_PERSIST_BATCH_SIZE);
    const settledBatch = await Promise.allSettled(
      batch.map((scrapedVehicle) =>
        upsertVehicleFromScrape({
          scraped: scrapedVehicle,
          source: {
            id: syncRun.source.id,
            sourceProfileId: syncRun.source.sourceProfileId,
            tenantId: syncRun.tenantId,
          },
          syncRunId: syncRun.id,
        }),
      ),
    );

    const cacheTasks: Promise<unknown>[] = [];

    settledBatch.forEach((result, batchIndex) => {
      const scrapedVehicle = batch[batchIndex];

      if (result.status === "rejected") {
        failedCount += 1;
        logger.warn("Failed to persist scraped vehicle", {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          sourceId: syncRun.source.id,
          tenantId: syncRun.tenantId,
          vin: scrapedVehicle.vin,
        });
        return;
      }

      seenVehicleIds.push(result.value.vehicle.id);

      if (result.value.changeResult.created) {
        createdCount += 1;
        touchedVehicleIds.add(result.value.vehicle.id);
        newVehicleIds.add(result.value.vehicle.id);
      } else if (result.value.changeResult.changed) {
        updatedCount += 1;
        touchedVehicleIds.add(result.value.vehicle.id);
      } else {
        unchangedCount += 1;
      }

      cacheTasks.push(cacheVehicleImagesForVehicle(result.value.vehicle.id));
    });

    if (cacheTasks.length) {
      await Promise.allSettled(cacheTasks);
    }
  }

  const staleResult = await markVehiclesStale({
    seenVehicleIds,
    sourceId: syncRun.source.id,
    syncRunId: syncRun.id,
    tenantId: syncRun.tenantId,
  });

  await queuePublicationUpdatesForVehicles({
    syncReason: "INVENTORY_CHANGED",
    tenantId: syncRun.tenantId,
    vehicleIds: Array.from(touchedVehicleIds),
  });

  await queuePublicationArchivesForVehicles({
    syncReason: "SOLD_OR_REMOVED",
    tenantId: syncRun.tenantId,
    vehicleIds: staleResult.vehicleIds,
  });

  if (newVehicleIds.size) {
    await runListingAutomationSafely(syncRun.tenantId, "executeSourceSync.assignVehiclesRoundRobin", () =>
      assignVehiclesRoundRobin({
        createdById: syncRun.triggeredById,
        tenantId: syncRun.tenantId,
        vehicleIds: Array.from(newVehicleIds),
      }),
    );
  }

  if (touchedVehicleIds.size) {
    await runListingAutomationSafely(syncRun.tenantId, "executeSourceSync.queueListingUpdatesForVehicles", () =>
      queueListingUpdatesForVehicles({
        createdById: syncRun.triggeredById,
        tenantId: syncRun.tenantId,
        vehicleIds: Array.from(touchedVehicleIds),
      }),
    );
  }

  if (staleResult.vehicleIds.length) {
    await runListingAutomationSafely(syncRun.tenantId, "executeSourceSync.queueListingSoldTasksForVehicles", () =>
      queueListingSoldTasksForVehicles({
        createdById: syncRun.triggeredById,
        tenantId: syncRun.tenantId,
        vehicleIds: staleResult.vehicleIds,
      }),
    );
  }

  await createSyncHealthMetric({
    failedCount,
    sourceId: syncRun.source.id,
    syncRunId: syncRun.id,
    tenantId: syncRun.tenantId,
    totalFound: scrapeResult.totalFound,
  });

  const completedRun = await prisma.syncRun.update({
    where: {
      id: syncRun.id,
    },
    data: {
      archivedCount: staleResult.count,
      createdCount,
      failedCount,
      finishedAt: new Date(),
      notes: `Processed ${dedupedVehicles.length} unique listing(s) from ${syncRun.source.name}.`,
      status: failedCount > 0 ? QueueJobStatus.FAILED : QueueJobStatus.COMPLETED,
      totalFound: scrapeResult.totalFound,
      unchangedCount,
      updatedCount,
    },
  });

  await prisma.inventorySource.update({
    where: {
      id: syncRun.source.id,
    },
    data: {
      lastSyncedAt: new Date(),
      status: failedCount > 0 ? "FAILED" : "ACTIVE",
    },
  });

  await createAuditLog({
    action: failedCount > 0 ? "inventory.sync.completed_with_failures" : "inventory.sync.completed",
    actorId: syncRun.triggeredById ?? undefined,
    entityId: completedRun.id,
    entityType: "SyncRun",
      metadata: asJson({
      createdCount,
      failedCount,
      staleCount: staleResult.count,
      unchangedCount,
      updatedCount,
    }),
    summary: `Inventory sync finished for ${syncRun.source.name}.`,
    tenantId: syncRun.tenantId,
  });

  return completedRun;
}

export async function executeVehicleRefresh(backgroundJobId: string, vehicleIds: string[]) {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      id: {
        in: vehicleIds,
      },
    },
    include: {
      source: true,
    },
  });

  const vehiclesBySource = new Map<string, typeof vehicles>();

  for (const vehicle of vehicles) {
    const current = vehiclesBySource.get(vehicle.sourceId) ?? [];
    current.push(vehicle);
    vehiclesBySource.set(vehicle.sourceId, current);
  }

  let refreshedCount = 0;
  const touchedVehicleIds = new Set<string>();

  for (const sourceVehicles of vehiclesBySource.values()) {
    const source = sourceVehicles[0]?.source;
    if (!source?.adapterKey) {
      continue;
    }

    const adapter = getSourceAdapter(source.adapterKey);
    if (!adapter.refreshVehicles) {
      continue;
    }

    const refreshedVehicles = await adapter.refreshVehicles(
      {
        baseUrl: source.baseUrl,
        inventoryUrl: source.inventoryUrl,
        slug: source.slug,
      },
      sourceVehicles.map((vehicle) => vehicle.detailPageUrl),
    );

    for (const refreshedVehicle of refreshedVehicles) {
      const result = await upsertVehicleFromScrape({
        scraped: refreshedVehicle,
        source: {
          id: source.id,
          sourceProfileId: source.sourceProfileId,
          tenantId: source.tenantId,
        },
      });
      await cacheVehicleImagesForVehicle(result.vehicle.id);
      if (result.changeResult.created || result.changeResult.changed) {
        touchedVehicleIds.add(result.vehicle.id);
      }
      refreshedCount += result.changeResult.created || result.changeResult.changed ? 1 : 0;
    }
  }

  if (vehicles[0]?.tenantId && touchedVehicleIds.size) {
    await queuePublicationUpdatesForVehicles({
      tenantId: vehicles[0].tenantId,
      vehicleIds: Array.from(touchedVehicleIds),
    });

    await runListingAutomationSafely(
      vehicles[0].tenantId,
      "executeVehicleRefresh.queueListingUpdatesForVehicles",
      () =>
        queueListingUpdatesForVehicles({
          tenantId: vehicles[0].tenantId,
          vehicleIds: Array.from(touchedVehicleIds),
        }),
    );
  }

  await createAuditLog({
    action: "inventory.refresh.completed",
    entityId: backgroundJobId,
    entityType: "BackgroundJob",
    metadata: asJson({ refreshedCount, vehicleIds }),
    summary: `Vehicle refresh completed for ${refreshedCount} listing(s).`,
    tenantId: vehicles[0]?.tenantId,
  });

  return {
    refreshedCount,
  };
}
