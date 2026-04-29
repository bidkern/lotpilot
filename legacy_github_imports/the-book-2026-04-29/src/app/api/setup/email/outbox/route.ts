import { NextResponse } from "next/server";

import { getRecentOutboxMessages } from "@/lib/email";

export async function GET() {
  return NextResponse.json({
    ok: true,
    messages: getRecentOutboxMessages(),
  });
}
