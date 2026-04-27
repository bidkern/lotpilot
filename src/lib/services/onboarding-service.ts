import {
  FieldTransform,
  InventorySourceStatus,
  SourceDetectionStatus,
  SourceProfileStatus,
  type ExtractionRuleType,
  type Prisma,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { detectSourceProfileFromUrl, type SourceProfileDraft } from "@/lib/services/detection-service";
import { createInventorySource, queueSourceSync } from "@/lib/services/inventory-service";
import { ensureSourceSyncSchedule } from "@/lib/services/source-scheduler";
import { getSourceAdapter } from "@/lib/source-adapters";

type PersistedDetectionDraft = {
  adapterKey: string;
  detectedVehicleCount: number;
  extractionRules: Array<{
    attribute?: string | null;
    isRequired?: boolean;
    label: string;
    regex?: string | null;
    ruleType: ExtractionRuleType;
    selector: string;
    sortOrder: number;
  }>;
  fieldMappings: Array<{
    fallbackValue?: string | null;
    isRequired?: boolean;
    sourcePath: string;
    targetField: string;
    transform: FieldTransform;
  }>;
  inventoryPath: string | null;
  notes: string | null;
  previewVehicles: SourceProfileDraft["previewVehicles"];
  requiresReview: boolean;
  summary: string;
};

function serializePreviewVehicles(previewVehicles: SourceProfileDraft["previewVehicles"]) {
  return previewVehicles.map((vehicle) => ({
    bodyStyle: vehicle.bodyStyle,
    condition: vehicle.condition,
    description: vehicle.description,
    drivetrain: vehicle.drivetrain,
    engine: vehicle.engine,
    exteriorColor: vehicle.exteriorColor,
    fuelType: vehicle.fuelType,
    imageUrls: vehicle.imageUrls,
    inventoryListedAt: vehicle.inventoryListedAt,
    interiorColor: vehicle.interiorColor,
    listingPosition: vehicle.listingPosition,
    make: vehicle.make,
    mileage: vehicle.mileage,
    model: vehicle.model,
    price: vehicle.price,
    rawPayload: {},
    sourceUrl: vehicle.sourceUrl,
    sourceVehicleKey: vehicle.sourceVehicleKey,
    stockNumber: vehicle.stockNumber,
    title: vehicle.title,
    transmission: vehicle.transmission,
    trim: vehicle.trim,
    vin: vehicle.vin,
    year: vehicle.year,
  }));
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function normalizeBaseUrl(input: string) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.search = "";
  url.pathname = "/";
  return url.toString().replace(/\/$/, "");
}

function defaultSourceName(websiteUrl: string) {
  const hostname = new URL(normalizeBaseUrl(websiteUrl)).hostname.replace(/^www\./, "");
  return hostname
    .split(".")
    .slice(0, -1)
    .join(" ")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDetectionDraft(previewPayload: Prisma.JsonValue | null) {
  if (!previewPayload || typeof previewPayload !== "object" || Array.isArray(previewPayload)) {
    throw new Error("Detection preview payload is missing.");
  }

  const payload = previewPayload as Record<string, unknown>;
  const draft = payload.draft;

  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new Error("Detection draft is missing.");
  }

  return draft as PersistedDetectionDraft;
}

function resolveInventoryUrl(baseUrl: string, inventoryPath: string | null) {
  if (!inventoryPath) {
    return null;
  }

  try {
    return new URL(inventoryPath, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

function supportsAutomatedSync(adapterKey: string) {
  try {
    getSourceAdapter(adapterKey);
    return true;
  } catch {
    return false;
  }
}

export async function detectInventorySource(input: {
  createdById?: string | null;
  sourceName?: string | null;
  tenantId: string;
  websiteUrl: string;
}) {
  const baseUrl = normalizeBaseUrl(input.websiteUrl);
  const sourceName = input.sourceName?.trim() || defaultSourceName(input.websiteUrl) || "Inventory Source";

  const existingSource = await prisma.inventorySource.findFirst({
    where: {
      baseUrl,
      tenantId: input.tenantId,
    },
  });

  const source =
    existingSource ??
    (await createInventorySource({
      baseUrl,
      name: sourceName,
      status: "DETECTING",
      tenantId: input.tenantId,
      websiteUrl: input.websiteUrl,
    }));

  if (existingSource) {
    await prisma.inventorySource.update({
      where: {
        id: existingSource.id,
      },
      data: {
        name: sourceName,
        status: InventorySourceStatus.DETECTING,
        websiteUrl: input.websiteUrl,
      },
    });
  }

  try {
    const detection = await detectSourceProfileFromUrl(input.websiteUrl);
    const previewVehicles = serializePreviewVehicles(detection.previewVehicles);
    const inventoryUrl = resolveInventoryUrl(baseUrl, detection.inventoryPath);
    const detectionRun = await prisma.sourceDetectionRun.create({
      data: {
        confidence: detection.confidence,
        createdById: input.createdById ?? undefined,
        inventorySourceId: source.id,
        normalizedUrl: baseUrl,
        previewPayload: asJson({
          draft: {
            adapterKey: detection.adapterKey,
            detectedVehicleCount: detection.detectedVehicleCount,
            extractionRules: detection.extractionRules,
            fieldMappings: detection.fieldMappings,
            inventoryPath: detection.inventoryPath,
            notes: detection.notes,
            previewVehicles,
            requiresReview: detection.requiresReview,
            summary: detection.summary,
          },
          previewVehicles,
        }),
        primaryStrategy: detection.detectionStrategy,
        requiresReview: detection.requiresReview,
        status: detection.requiresReview
          ? SourceDetectionStatus.REVIEW_REQUIRED
          : SourceDetectionStatus.COMPLETED,
        strategiesTried: asJson([detection.detectionStrategy]),
        submittedUrl: detection.submittedUrl,
        summary: detection.summary,
        tenantId: input.tenantId,
      },
    });

    await prisma.inventorySource.update({
      where: {
        id: source.id,
      },
      data: {
        adapterKey: detection.adapterKey,
        baseUrl,
        inventoryUrl: inventoryUrl ?? undefined,
        name: sourceName,
        requiresReview: detection.requiresReview,
        status: InventorySourceStatus.DRAFT,
        websiteUrl: input.websiteUrl,
      },
    });

    await createAuditLog({
      action: "source.detection.completed",
      actorId: input.createdById ?? undefined,
      entityId: detectionRun.id,
      entityType: "SourceDetectionRun",
      metadata: asJson({ inventorySourceId: source.id, strategy: detection.detectionStrategy }),
      summary: `Source detection completed for ${sourceName}.`,
      tenantId: input.tenantId,
    });

    return {
      detectionRunId: detectionRun.id,
      inventorySourceId: source.id,
      result: detection,
    };
  } catch (error) {
    await prisma.sourceDetectionRun.create({
      data: {
        createdById: input.createdById ?? undefined,
        inventorySourceId: source.id,
        normalizedUrl: baseUrl,
        requiresReview: true,
        status: SourceDetectionStatus.FAILED,
        submittedUrl: input.websiteUrl,
        summary: error instanceof Error ? error.message : "Detection failed.",
        tenantId: input.tenantId,
      },
    });

    await prisma.inventorySource.update({
      where: {
        id: source.id,
      },
      data: {
        requiresReview: true,
        status: InventorySourceStatus.FAILED,
      },
    });

    throw error;
  }
}

export async function approveInventorySource(input: {
  createdById?: string | null;
  detectionRunId: string;
  tenantId: string;
}) {
  const detectionRun = await prisma.sourceDetectionRun.findFirst({
    where: {
      id: input.detectionRunId,
      tenantId: input.tenantId,
    },
    include: {
      inventorySource: true,
    },
  });

  if (!detectionRun) {
    throw new Error("Detection run not found.");
  }

  if (detectionRun.inventorySource.sourceProfileId) {
    if (
      detectionRun.inventorySource.status === InventorySourceStatus.ACTIVE &&
      detectionRun.inventorySource.syncCron
    ) {
      await ensureSourceSyncSchedule({
        cron: detectionRun.inventorySource.syncCron,
        sourceId: detectionRun.inventorySource.id,
      });
    }

    return {
      initialSyncRunId: null,
      inventorySourceId: detectionRun.inventorySourceId,
      requiresReview: detectionRun.inventorySource.requiresReview,
      sourceProfileId: detectionRun.inventorySource.sourceProfileId,
      status: detectionRun.inventorySource.status,
    };
  }

  const draft = parseDetectionDraft(detectionRun.previewPayload);
  const automatedSyncSupported = supportsAutomatedSync(draft.adapterKey);
  const shouldActivate = automatedSyncSupported && !draft.requiresReview;
  const inventoryUrl =
    resolveInventoryUrl(detectionRun.normalizedUrl, draft.inventoryPath) ??
    detectionRun.inventorySource.inventoryUrl;

  const sourceProfile = await prisma.sourceProfile.create({
    data: {
      adapterKey: draft.adapterKey,
      approvedAt: new Date(),
      approvedById: input.createdById ?? undefined,
      confidence: detectionRun.confidence,
      detectionStrategy: detectionRun.primaryStrategy ?? "MANUAL_FALLBACK",
      inventoryPath: draft.inventoryPath ?? undefined,
      notes: draft.notes ?? detectionRun.summary,
      previewPayload: detectionRun.previewPayload ?? undefined,
      status: shouldActivate ? SourceProfileStatus.ACTIVE : SourceProfileStatus.REVIEW_REQUIRED,
      tenantId: input.tenantId,
    },
  });

  if (draft.extractionRules.length) {
    await prisma.extractionRule.createMany({
      data: draft.extractionRules.map((rule) => ({
        attribute: rule.attribute ?? undefined,
        isRequired: rule.isRequired ?? false,
        label: rule.label,
        regex: rule.regex ?? undefined,
        ruleType: rule.ruleType,
        selector: rule.selector,
        sortOrder: rule.sortOrder,
        sourceProfileId: sourceProfile.id,
        tenantId: input.tenantId,
      })),
    });
  }

  if (draft.fieldMappings.length) {
    await prisma.fieldMapping.createMany({
      data: draft.fieldMappings.map((fieldMapping) => ({
        fallbackValue: fieldMapping.fallbackValue ?? undefined,
        isRequired: fieldMapping.isRequired ?? false,
        sourcePath: fieldMapping.sourcePath,
        sourceProfileId: sourceProfile.id,
        targetField: fieldMapping.targetField,
        tenantId: input.tenantId,
        transform: fieldMapping.transform,
      })),
    });
  }

  const source = await prisma.inventorySource.update({
    where: {
      id: detectionRun.inventorySourceId,
    },
    data: {
      adapterKey: draft.adapterKey,
      inventoryUrl: inventoryUrl ?? undefined,
      isAutoApproved: shouldActivate,
      requiresReview: draft.requiresReview || !automatedSyncSupported,
      sourceProfileId: sourceProfile.id,
      status: shouldActivate ? InventorySourceStatus.ACTIVE : InventorySourceStatus.REQUIRES_REVIEW,
      syncCron: shouldActivate ? env.DEFAULT_SYNC_CRON : undefined,
    },
  });

  await prisma.sourceDetectionRun.update({
    where: {
      id: detectionRun.id,
    },
    data: {
      completedAt: new Date(),
      sourceProfileId: sourceProfile.id,
      status: shouldActivate ? SourceDetectionStatus.COMPLETED : SourceDetectionStatus.REVIEW_REQUIRED,
    },
  });

  await createAuditLog({
    action: shouldActivate ? "source.approved_and_activated" : "source.saved_for_review",
    actorId: input.createdById ?? undefined,
    entityId: source.id,
    entityType: "InventorySource",
    metadata: asJson({
      automatedSyncSupported,
      detectionRunId: detectionRun.id,
      sourceProfileId: sourceProfile.id,
    }),
    summary: shouldActivate
      ? `Activated source ${source.name}.`
      : `Saved source ${source.name} for manual review.`,
    tenantId: input.tenantId,
  });

  const initialSyncRun = shouldActivate
    ? await (async () => {
        if (source.syncCron) {
          await ensureSourceSyncSchedule({
            cron: source.syncCron,
            sourceId: source.id,
          });
        }

        return queueSourceSync({
          createdById: input.createdById ?? undefined,
          sourceId: source.id,
          tenantId: input.tenantId,
        });
      })()
    : null;

  return {
    initialSyncRunId: initialSyncRun?.id ?? null,
    inventorySourceId: source.id,
    requiresReview: !shouldActivate,
    sourceProfileId: sourceProfile.id,
    status: source.status,
  };
}
