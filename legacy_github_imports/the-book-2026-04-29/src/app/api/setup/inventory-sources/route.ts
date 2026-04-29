import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { createStarterInventorySource } from "@/lib/starter-persistence";
import { setupInventorySourceSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupInventorySourceSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest(
      "Invalid inventory source payload.",
      parsedPayload.error.flatten(),
    );
  }

  try {
    const workspace = await createStarterInventorySource(parsedPayload.data);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to create inventory source.",
    );
  }
}
