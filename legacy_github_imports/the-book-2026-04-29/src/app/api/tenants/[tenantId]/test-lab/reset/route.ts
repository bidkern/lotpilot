import { NextResponse } from "next/server";

import { resetAgentTasksTenant } from "@/lib/agent-task-persistence";
import { resetAppointmentsTenant } from "@/lib/appointment-persistence";
import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { resetOutboundMessagesTenant } from "@/lib/outbound-message-service";
import {
  getSalesFloorState,
  resetSalesFloorTenant,
} from "@/lib/sales-floor-persistence";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ tenantId: string }> },
) {
  const parsedParams = await parseTenantParams(context.params);
  if (!parsedParams.success) {
    return jsonBadRequest("Invalid tenant id.", parsedParams.error.flatten());
  }

  const tenantId = parsedParams.data.tenantId;

  await Promise.all([
    resetSalesFloorTenant(tenantId),
    resetAgentTasksTenant(tenantId),
    resetAppointmentsTenant(tenantId),
    resetOutboundMessagesTenant(tenantId),
  ]);

  const salesFloor = await getSalesFloorState(tenantId);

  return NextResponse.json({
    ok: true,
    tenantId,
    salesFloor,
  });
}
