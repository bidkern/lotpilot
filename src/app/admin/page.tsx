import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { InventoryDashboard } from "@/components/inventory-dashboard";
import { requireRole } from "@/lib/authz";
import { getDashboardData } from "@/lib/services/inventory-service";
import { getTenantWorkspaceState } from "@/lib/services/tenant-service";

export const metadata: Metadata = {
  title: "The Book Workspace",
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = requireRole(await auth(), [UserRole.AGENT]);
  const tenantId = session.user.tenantId;

  if (!tenantId) {
    redirect("/register");
  }

  const workspace = await getTenantWorkspaceState(tenantId);
  if (!workspace.latestSource) {
    redirect("/onboarding");
  }

  const dashboard = await getDashboardData(tenantId, undefined, {
    role: session.user.role,
    userId: session.user.id,
  });

  return (
    <InventoryDashboard
      currentUser={{
        email: session.user.email,
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
        tenantName: session.user.tenantName,
      }}
      dashboard={dashboard}
    />
  );
}
