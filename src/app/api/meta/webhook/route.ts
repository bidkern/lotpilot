import { NextResponse } from "next/server";

import { ingestMetaWebhookPayload } from "@/lib/services/conversation-service";
import {
  resolveWebhookVerification,
  verifyMetaWebhookSignature,
} from "@/lib/services/meta-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const challenge = await resolveWebhookVerification(new URL(request.url));
    return new Response(challenge, {
      headers: {
        "content-type": "text/plain",
      },
      status: 200,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Meta webhook verification failed.",
      },
      { status: 403 },
    );
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return NextResponse.json(
      {
        error: "Meta webhook signature validation failed.",
      },
      { status: 401 },
    );
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const result = await ingestMetaWebhookPayload(payload as never, signature);

    return NextResponse.json({
      ok: true,
      processedEvents: result.processedEvents,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Meta webhook processing failed.",
      },
      { status: 400 },
    );
  }
}
