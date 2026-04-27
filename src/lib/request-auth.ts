import { type UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hasRequiredRole } from "@/lib/authz";

export async function requireApiRole(requiredRoles: UserRole[]) {
  const session = await auth();

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  if (!session.user.tenantId) {
    return {
      error: NextResponse.json({ error: "Tenant workspace not found." }, { status: 409 }),
      user: null,
    };
  }

  if (!hasRequiredRole(session.user.role, requiredRoles)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      user: null,
    };
  }

  return {
    error: null,
    user: session.user,
  };
}
