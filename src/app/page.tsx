import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getTenantWorkspaceState } from "@/lib/services/tenant-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  if (!session.user.tenantId) {
    redirect("/register");
  }

  const workspace = await getTenantWorkspaceState(session.user.tenantId);

  if (workspace.requiresOnboarding) {
    redirect("/onboarding");
  }

  redirect("/admin");
}
