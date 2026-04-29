import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: "starter",
    session: {
      user: null,
      tenant: null,
    },
    message:
      "Starter mode is active. Create local workspace records in the UI, then wire Auth.js and persisted tenant data when you are ready.",
  });
}
