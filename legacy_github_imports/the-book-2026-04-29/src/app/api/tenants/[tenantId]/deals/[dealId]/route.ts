import { NextResponse } from "next/server";

import {
  cancelAppointmentForDeal,
  markAppointmentCompleted,
  upsertAppointmentForDeal,
} from "@/lib/appointment-persistence";
import { jsonBadRequest, parseTenantParams } from "@/lib/api/http";
import { applySalesDealActionForTenant } from "@/lib/sales-floor-persistence";
import { salesDealActionSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ tenantId: string; dealId: string }>;
  },
) {
  const params = await context.params;
  const parsedParams = await parseTenantParams(
    Promise.resolve({ tenantId: params.tenantId }),
  );

  if (!parsedParams.success || !params.dealId?.trim()) {
    return jsonBadRequest("Invalid deal route.", parsedParams.error?.flatten());
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsedBody = salesDealActionSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonBadRequest("Invalid deal action.", parsedBody.error.flatten());
  }

  try {
    const salesFloor = await applySalesDealActionForTenant(
      parsedParams.data.tenantId,
      params.dealId,
      parsedBody.data,
    );
    const updatedDeal = salesFloor.deals.find((deal) => deal.id === params.dealId);

    if (updatedDeal) {
      switch (parsedBody.data.action) {
        case "BOOK_APPOINTMENT":
          await upsertAppointmentForDeal({
            tenantId: parsedParams.data.tenantId,
            deal: updatedDeal,
            customerName: updatedDeal.customerName,
            vehicleLabel: updatedDeal.vehicleLabel,
            windowLabel: updatedDeal.appointmentWindow,
          });
          break;
        case "COMPLETE_APPOINTMENT":
        case "MARK_SOLD":
          await markAppointmentCompleted(parsedParams.data.tenantId, params.dealId);
          break;
        case "MARK_LOST":
          await cancelAppointmentForDeal(parsedParams.data.tenantId, params.dealId);
          break;
      }
    }

    return NextResponse.json({
      ok: true,
      tenantId: parsedParams.data.tenantId,
      salesFloor,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update the deal record.";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: message === "Deal record not found." ? 404 : 400,
      },
    );
  }
}
