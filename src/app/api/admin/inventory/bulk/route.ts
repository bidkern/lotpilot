import { PublicationChannel, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { hasRequiredRole } from "@/lib/authz";
import { requireApiRole } from "@/lib/request-auth";
import { queueExportJob } from "@/lib/services/export-service";
import {
  archiveVehicles,
  getVehicleIdsForQuery,
  markVehiclesExported,
  queueVehicleRefresh,
} from "@/lib/services/inventory-service";
import { assignVehiclesRoundRobin } from "@/lib/services/listing-assignment-service";
import { queueVehiclePublications } from "@/lib/services/publication-service";

const filtersSchema = z.object({
  exportStatus: z
    .enum(["ALL", "NOT_EXPORTED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED"])
    .optional(),
  make: z.string().optional(),
  maxPrice: z.number().int().optional(),
  minPrice: z.number().int().optional(),
  model: z.string().optional(),
  search: z.string().optional(),
  sourceId: z.string().optional(),
  workflowStatus: z
    .enum([
      "ALL",
      "ACTIVE",
      "STALE",
      "ARCHIVED",
      "NEEDS_REVIEW",
      "EXPORT_READY",
      "EXPORTED",
      "EXPORT_FAILED",
    ])
    .optional(),
  year: z.number().int().optional(),
});

const selectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("manual"),
    vehicleIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    filters: filtersSchema.optional(),
    mode: z.literal("filtered"),
  }),
  z.object({
    mode: z.literal("all"),
  }),
]);

const payloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("archive"),
    selection: selectionSchema,
  }),
  z.object({
    action: z.literal("refresh"),
    selection: selectionSchema,
  }),
  z.object({
    action: z.literal("markExported"),
    selection: selectionSchema,
  }),
  z.object({
    action: z.literal("export"),
    format: z.enum(["CSV", "JSON"]),
    selection: selectionSchema,
  }),
  z.object({
    action: z.literal("publish"),
    channel: z.nativeEnum(PublicationChannel).optional(),
    messagingConnectionId: z.string().min(1),
    selection: selectionSchema,
  }),
  z.object({
    action: z.literal("assignListings"),
    selection: selectionSchema,
  }),
]);

async function resolveSelectionVehicleIds(
  tenantId: string,
  selection: z.infer<typeof selectionSchema>,
) {
  if (selection.mode === "manual") {
    return selection.vehicleIds;
  }

  if (selection.mode === "filtered") {
    return getVehicleIdsForQuery(tenantId, selection.filters);
  }

  return getVehicleIdsForQuery(tenantId);
}

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = payloadSchema.parse(await request.json());
    const tenantId = authResult.user!.tenantId!;
    const vehicleIds = await resolveSelectionVehicleIds(tenantId, payload.selection);

    if (payload.action === "archive") {
      const result = await archiveVehicles({
        actor: {
          id: authResult.user!.id,
          role: authResult.user!.role,
        },
        tenantId,
        vehicleIds,
      });

      return NextResponse.json(result);
    }

    if (payload.action === "refresh") {
      const jobs = await queueVehicleRefresh({
        createdById: authResult.user!.id,
        tenantId,
        vehicleIds,
      });

      return NextResponse.json({
        queued: jobs.length,
      });
    }

    if (payload.action === "markExported") {
      const result = await markVehiclesExported({
        actor: {
          id: authResult.user!.id,
          role: authResult.user!.role,
        },
        tenantId,
        vehicleIds,
      });

      return NextResponse.json(result);
    }

    if (payload.action === "publish") {
      const result = await queueVehiclePublications({
        channel: payload.channel,
        createdById: authResult.user!.id,
        messagingConnectionId: payload.messagingConnectionId,
        tenantId,
        vehicleIds,
      });

      return NextResponse.json(result);
    }

    if (payload.action === "assignListings") {
      if (!hasRequiredRole(authResult.user!.role, [UserRole.MANAGER])) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const result = await assignVehiclesRoundRobin({
        createdById: authResult.user!.id,
        tenantId,
        vehicleIds,
      });

      return NextResponse.json(result);
    }

    const exportJob = await queueExportJob({
      createdById: authResult.user!.id,
      format: payload.format,
      tenantId,
      vehicleIds,
    });

    return NextResponse.json({
      exportJobId: exportJob.id,
      status: exportJob.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Bulk action failed.",
      },
      { status: 400 },
    );
  }
}
