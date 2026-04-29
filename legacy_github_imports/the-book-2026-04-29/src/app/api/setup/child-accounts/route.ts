import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import { createStarterChildAccount } from "@/lib/starter-persistence";
import { setupChildAccountSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupChildAccountSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest("Invalid child account payload.", parsedPayload.error.flatten());
  }

  try {
    const workspace = await createStarterChildAccount(parsedPayload.data);

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to create child account.",
    );
  }
}
