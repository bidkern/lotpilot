import { UserRole, VehicleExportStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import { getInventoryTableData, type DashboardVehicleStatus } from "@/lib/services/inventory-service";

const workflowStatusSchema = z.enum([
  "ALL",
  "ACTIVE",
  "STALE",
  "ARCHIVED",
  "NEEDS_REVIEW",
  "EXPORT_READY",
  "EXPORTED",
  "EXPORT_FAILED",
]);

const exportStatusSchema = z.enum([
  "ALL",
  VehicleExportStatus.NOT_EXPORTED,
  VehicleExportStatus.QUEUED,
  VehicleExportStatus.PROCESSING,
  VehicleExportStatus.COMPLETED,
  VehicleExportStatus.FAILED,
]);

export async function GET(request: Request) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = z
      .object({
        exportStatus: exportStatusSchema.optional(),
        make: z.string().optional(),
        maxPrice: z.coerce.number().int().optional(),
        minPrice: z.coerce.number().int().optional(),
        model: z.string().optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().optional(),
        sourceId: z.string().optional(),
        workflowStatus: workflowStatusSchema.optional(),
        year: z.coerce.number().int().optional(),
      })
      .parse({
        exportStatus: searchParams.get("exportStatus") ?? undefined,
        make: searchParams.get("make") ?? undefined,
        maxPrice: searchParams.get("maxPrice") ?? undefined,
        minPrice: searchParams.get("minPrice") ?? undefined,
        model: searchParams.get("model") ?? undefined,
        page: searchParams.get("page") ?? undefined,
        pageSize: searchParams.get("pageSize") ?? undefined,
        search: searchParams.get("search") ?? undefined,
        sourceId: searchParams.get("sourceId") ?? undefined,
        workflowStatus: searchParams.get("workflowStatus") ?? undefined,
        year: searchParams.get("year") ?? undefined,
      });

    const inventory = await getInventoryTableData(authResult.user!.tenantId!, {
      exportStatus: query.exportStatus,
      make: query.make,
      maxPrice: query.maxPrice,
      minPrice: query.minPrice,
      model: query.model,
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      sourceId: query.sourceId,
      workflowStatus: query.workflowStatus as DashboardVehicleStatus | "ALL" | undefined,
      year: query.year,
    });

    return NextResponse.json(inventory);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load inventory.",
      },
      { status: 400 },
    );
  }
}
