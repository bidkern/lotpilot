"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { SetupRequired } from "@/components/setup/setup-required";
import {
  getChildDisplayName,
  getDealershipNameById,
  getFacebookConnectionByChildId,
  getFacebookStatusTone,
} from "@/lib/workspace-derived";
import { useWorkspace } from "@/lib/workspace-store";

export default function EmployeesPage() {
  const workspace = useWorkspace();
  const dealershipNameById = getDealershipNameById(workspace);
  const leadershipCount = workspace.childAccounts.filter((account) =>
    ["OWNER", "ADMIN", "MANAGER"].includes(account.role),
  ).length;
  const billingCount = workspace.childAccounts.filter(
    (account) => account.role === "BILLING",
  ).length;

  if (!workspace.parentAccount) {
    return (
      <div className="space-y-6">
        <PageHeader
          description="Employees belong to the parent account. Start by creating your own setup records instead of working from guessed dealership data."
          eyebrow="Employees"
          title="Team and access"
        />
        <SetupRequired
          description="Create the parent account and at least one child account before using the team workspace."
          title="No employee workspace yet"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Link
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            href="/setup"
          >
            Back to setup
          </Link>
        }
        description="Employees belong to the parent account, and each record can optionally point at a dealership plus a Facebook attachment. This page reflects only the accounts you create."
        eyebrow="Employees"
        title="Team and account access"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="Child accounts">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {workspace.childAccounts.length}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Accounts created under {workspace.parentAccount.name}.
          </p>
        </Panel>
        <Panel title="Leadership seats">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {leadershipCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Owners, admins, and managers currently configured.
          </p>
        </Panel>
        <Panel title="Billing contacts">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {billingCount}
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Billing-scoped child accounts.
          </p>
        </Panel>
        <Panel title="Facebook attached">
          <p className="font-[family:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
            {
              workspace.facebookConnections.filter(
                (connection) => connection.status === "CONNECTED",
              ).length
            }
          </p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Connected Facebook records across child accounts.
          </p>
        </Panel>
      </div>

      <Panel title="Roster details">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
            <thead className="bg-[var(--card-soft)] text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Dealership</th>
                <th className="px-4 py-3 font-medium">Facebook</th>
                <th className="px-4 py-3 font-medium">Connection</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {workspace.childAccounts.map((account) => {
                const facebookConnection = getFacebookConnectionByChildId(
                  workspace,
                  account.id,
                );

                return (
                  <tr key={account.id}>
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">
                          {getChildDisplayName(account)}
                        </p>
                        <p className="text-sm text-[var(--muted-foreground)]">
                          {account.email}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[var(--muted-foreground)]">
                      {account.role}
                    </td>
                    <td className="px-4 py-4 text-[var(--muted-foreground)]">
                      {account.dealershipId
                        ? dealershipNameById[account.dealershipId] || "Dealership"
                        : "Parent-level"}
                    </td>
                    <td className="px-4 py-4">
                      <Badge tone={getFacebookStatusTone(facebookConnection)}>
                        {facebookConnection ? facebookConnection.status : "Not attached"}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-[var(--muted-foreground)]">
                      {facebookConnection ? (
                        <div>
                          <p>{facebookConnection.accountLabel}</p>
                          <p className="text-xs">
                            {facebookConnection.connectionMode === "OAUTH"
                              ? facebookConnection.selectedPageName
                                ? `Verified · ${facebookConnection.selectedPageName}`
                                : "Verified auth · Page selection pending"
                              : "Manual placeholder"}
                          </p>
                        </div>
                      ) : (
                        "No Facebook record yet"
                      )}
                    </td>
                    <td className="px-4 py-4 text-[var(--muted-foreground)]">
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }).format(new Date(account.createdAt))}
                    </td>
                  </tr>
                );
              })}
              {workspace.childAccounts.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-[var(--muted-foreground)]"
                    colSpan={6}
                  >
                    No child accounts yet. Create them from the setup workspace.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
