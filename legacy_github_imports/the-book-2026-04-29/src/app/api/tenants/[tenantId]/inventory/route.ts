import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { employees, vehicles } from "@/lib/demo-data";
import { inventoryQuerySchema } from "@/lib/validation";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const parsedQuery = inventoryQuerySchema.safeParse({
    listed: request.nextUrl.searchParams.get("listed") ?? undefined,
    sort: request.nextUrl.searchParams.get("sort") ?? undefined,
    employeeId: request.nextUrl.searchParams.get("employeeId") ?? undefined,
  });

  if (!parsedQuery.success) {
    return jsonBadRequest("Invalid inventory query.", parsedQuery.error.flatten());
  }

  const inventory = [...vehicles]
    .filter((vehicle) => {
      if (parsedQuery.data.listed === "listed") {
        return vehicle.listingStatus === "POSTED";
      }

      if (parsedQuery.data.listed === "unlisted") {
        return vehicle.listingStatus !== "POSTED";
      }

      return true;
    })
    .filter((vehicle) => {
      if (!parsedQuery.data.employeeId) {
        return true;
      }

      return vehicle.listedByMembershipId === parsedQuery.data.employeeId;
    })
    .sort((left, right) => {
      switch (parsedQuery.data.sort) {
        case "price":
          return right.priceCents - left.priceCents;
        case "make":
          return left.make.localeCompare(right.make);
        case "model":
          return left.model.localeCompare(right.model);
        case "mileage":
          return right.mileage - left.mileage;
        case "daysOnLot":
        default:
          return right.daysOnLot - left.daysOnLot;
      }
    });

  return NextResponse.json({
    ok: true,
    mode: "demo",
    tenantId: parsedParams.data.tenantId,
    filters: parsedQuery.data,
    inventory,
    employees,
    setupRequired: false,
  });
}
