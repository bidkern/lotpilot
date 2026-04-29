import { NextResponse } from "next/server";

import { JOB_NAMES } from "@/lib/job-names";
import { inventoryWebhookSchema } from "@/lib/validation";
import { jsonBadRequest } from "@/lib/api/http";

export async function POST(request: Request) {
  const body = await request.json();
  const parsedBody = inventoryWebhookSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonBadRequest("Invalid inventory webhook payload.", parsedBody.error.flatten());
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    queuedJob: JOB_NAMES.inventoryNormalizeBatch,
    deliveryId: parsedBody.data.deliveryId,
    vehicleCount: parsedBody.data.vehicles.length,
  });
}
