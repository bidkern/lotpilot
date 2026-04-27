import { type UserRole } from "@prisma/client";
import { type Session } from "next-auth";
import { redirect } from "next/navigation";

export const ROLE_ORDER: Record<UserRole, number> = {
  ADMIN: 3,
  AGENT: 1,
  MANAGER: 2,
  OWNER: 4,
};

export function hasRequiredRole(role: UserRole, required: UserRole[]) {
  return required.some((requiredRole) => ROLE_ORDER[role] >= ROLE_ORDER[requiredRole]);
}

export function requireSession(session: Session | null) {
  if (!session?.user) {
    redirect("/login");
  }

  return session;
}

export function requireTenantSession(session: Session | null) {
  const safeSession = requireSession(session);

  if (!safeSession.user.tenantId) {
    redirect("/register");
  }

  return safeSession;
}

export function requireRole(session: Session | null, required: UserRole[]) {
  const safeSession = requireTenantSession(session);

  if (!hasRequiredRole(safeSession.user.role, required)) {
    redirect("/login?error=unauthorized");
  }

  return safeSession;
}
