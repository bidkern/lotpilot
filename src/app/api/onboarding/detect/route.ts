import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import { assertRateLimit, getRequestRateLimitKey } from "@/lib/rate-limit";
import { detectInventorySource } from "@/lib/services/onboarding-service";

const payloadSchema = z.object({
  sourceName: z.string().min(1).optional(),
  websiteUrl: z.string().min(1),
});

function serializePreviewVehicles(
  previewVehicles: Awaited<ReturnType<typeof detectInventorySource>>["result"]["previewVehicles"],
) {
  return previewVehicles.map((vehicle) => ({
    bodyStyle: vehicle.bodyStyle,
    condition: vehicle.condition,
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
    sourceUrl: vehicle.sourceUrl,
    stockNumber: vehicle.stockNumber,
    title: vehicle.title,
    transmission: vehicle.transmission,
    trim: vehicle.trim,
    vin: vehicle.vin,
    year: vehicle.year,
  }));
}

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    assertRateLimit({
      key: `onboarding-detect:${authResult.user!.tenantId}:${getRequestRateLimitKey(request)}`,
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });

    const payload = payloadSchema.parse(await request.json());
    const result = await detectInventorySource({
      createdById: authResult.user!.id,
      sourceName: payload.sourceName,
      tenantId: authResult.user!.tenantId!,
      websiteUrl: payload.websiteUrl,
    });

    return NextResponse.json({
      confidence: result.result.confidence,
      detectedVehicleCount: result.result.detectedVehicleCount,
      detectionRunId: result.detectionRunId,
      detectionStrategy: result.result.detectionStrategy,
      inventorySourceId: result.inventorySourceId,
      notes: result.result.notes,
      previewVehicles: serializePreviewVehicles(result.result.previewVehicles),
      requiresReview: result.result.requiresReview,
      summary: result.result.summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to inspect that dealership URL.",
      },
      { status: 400 },
    );
  }
}
