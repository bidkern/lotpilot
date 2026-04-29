import { NextResponse } from "next/server";

import {
  getStarterWorkspaceState,
  resetStarterWorkspaceState,
} from "@/lib/starter-persistence";

export async function GET() {
  const workspace = await getStarterWorkspaceState();

  return NextResponse.json({
    ok: true,
    workspace,
  });
}

export async function DELETE() {
  const workspace = await resetStarterWorkspaceState();

  return NextResponse.json({
    ok: true,
    workspace,
  });
}
