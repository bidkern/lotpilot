import { NextResponse } from "next/server";

import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { employees, queueItems, vehicles } from "@/lib/demo-data";
import { selectNextAssignment } from "@/lib/rotation-engine";
import { assignmentRequestSchema } from "@/lib/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const body = await request.json();
  const parsedBody = assignmentRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonBadRequest("Invalid assignment request.", parsedBody.error.flatten());
  }

  const vehicle = vehicles.find((item) => item.id === parsedBody.data.vehicleId);

  if (!vehicle) {
    return jsonBadRequest("Vehicle not found for assignment.");
  }

  const decision = selectNextAssignment({
    employees,
    vehicle,
    queueItems,
    activeVehicleListingIds: vehicles
      .filter((item) => item.listingStatus === "POSTED")
      .map((item) => item.id),
    overrideMembershipId: parsedBody.data.overrideMembershipId,
    cooldownMinutes: 60,
    maxPendingAssignmentsPerEmployee: 3,
    now: new Date().toISOString(),
  });

  return NextResponse.json({
    ok: true,
    mode: "demo",
    tenantId: parsedParams.data.tenantId,
    trigger: parsedBody.data.trigger,
    vehicle,
    decision,
    setupRequired: false,
  });
}
