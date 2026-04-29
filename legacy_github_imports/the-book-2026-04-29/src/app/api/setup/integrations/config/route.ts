import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { saveLocalIntegrationConfig } from "@/lib/integration-config";
import { integrationConfigSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = integrationConfigSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest(
      "Invalid integration configuration payload.",
      parsedPayload.error.flatten(),
    );
  }

  saveLocalIntegrationConfig(parsedPayload.data);

  return NextResponse.json({
    ok: true,
  });
}
