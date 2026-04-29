import { NextRequest, NextResponse } from "next/server";

import { jsonBadRequest } from "@/lib/api/http";
import {
  createStarterParentAccount,
  updateStarterRegistrationEmailStatus,
} from "@/lib/starter-persistence";
import { sendRegistrationCompleteEmail } from "@/lib/email";
import { setupParentAccountSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = setupParentAccountSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return jsonBadRequest("Invalid parent account payload.", parsedPayload.error.flatten());
  }

  try {
    let workspace = await createStarterParentAccount(parsedPayload.data);

    try {
      const delivery = await sendRegistrationCompleteEmail({
        parentAccountName: parsedPayload.data.name,
        billingEmail: parsedPayload.data.billingEmail,
      });

      workspace = await updateStarterRegistrationEmailStatus({
        status: "SENT",
        deliveryMode: delivery.mode,
        sentAt: delivery.sentAt,
      });
    } catch (emailError) {
      workspace = await updateStarterRegistrationEmailStatus({
        status: "FAILED",
        lastError:
          emailError instanceof Error
            ? emailError.message
            : "Registration email could not be delivered.",
      });
    }

    return NextResponse.json({
      ok: true,
      workspace,
    });
  } catch (error) {
    return jsonBadRequest(
      error instanceof Error ? error.message : "Unable to create parent account.",
    );
  }
}
