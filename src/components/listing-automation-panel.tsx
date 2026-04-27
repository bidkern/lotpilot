"use client";

import type { getDashboardData } from "@/lib/services/inventory-service";
import { ArrowRightLeft, LoaderCircle, Save, Shuffle, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { buildUserMessagesPath } from "@/lib/workspace-routes";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type ListingAutomationData = DashboardData["listingAutomation"];
type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";

type ListingAutomationPanelProps = {
  listingAutomation: ListingAutomationData;
  role: UserRole;
  tenantName: string;
};

type RosterDraft = {
  id: string;
  listingEnabled: boolean;
  listingOrder: number;
  role: "OWNER" | "ADMIN" | "MANAGER" | "AGENT";
};

const roleRank: Record<UserRole, number> = {
  ADMIN: 3,
  AGENT: 1,
  MANAGER: 2,
  OWNER: 4,
};

function hasRole(role: UserRole, minimumRole: UserRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

function badgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
    case "READY_TO_POST":
    case "POSTED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "NEEDS_UPDATE":
    case "SOLD_ACTION_REQUIRED":
    case "MANAGER":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "ADMIN":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
}

function initialFormState(orderSeed: number) {
  return {
    email: "",
    listingEnabled: true,
    listingOrder: orderSeed,
    name: "",
    password: "",
    role: "AGENT" as const,
  };
}

export function ListingAutomationPanel({
  listingAutomation,
  role,
  tenantName,
}: ListingAutomationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rosterDraft, setRosterDraft] = useState<RosterDraft[]>([]);
  const [form, setForm] = useState(initialFormState(listingAutomation.roster.length + 1));
  const canManage = hasRole(role, "MANAGER");

  useEffect(() => {
    setRosterDraft(
      listingAutomation.roster.map((member) => ({
        id: member.id,
        listingEnabled: member.listingEnabled,
        listingOrder: member.listingOrder,
        role: member.role,
      })),
    );
    setForm(initialFormState(listingAutomation.roster.length + 1));
  }, [listingAutomation]);

  const orderedRoster = useMemo(
    () =>
      [...listingAutomation.roster].sort((left, right) =>
        left.listingOrder === right.listingOrder
          ? (left.name || left.email || "").localeCompare(right.name || right.email || "")
          : left.listingOrder - right.listingOrder,
      ),
    [listingAutomation.roster],
  );

  function updateDraft(
    membershipId: string,
    nextValue: Partial<Pick<RosterDraft, "listingEnabled" | "listingOrder" | "role">>,
  ) {
    setRosterDraft((current) =>
      current.map((member) =>
        member.id === membershipId
          ? {
              ...member,
              ...nextValue,
            }
          : member,
      ),
    );
  }

  function refreshWorkspace(nextMessage: string) {
    setMessage(nextMessage);
    startTransition(() => {
      router.refresh();
    });
  }

  async function saveRosterSettings() {
    setBusyKey("roster:save");
    setMessage("Saving employee order...");

    try {
      const response = await fetch("/api/admin/employees", {
        body: JSON.stringify({
          updates: rosterDraft.map((member) => ({
            listingEnabled: member.listingEnabled,
            listingOrder: member.listingOrder,
            membershipId: member.id,
            ...(member.role === "OWNER" ? {} : { role: member.role }),
          })),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PATCH",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to save employee settings.");
      }

      refreshWorkspace(`Saved ${payload.updatedCount ?? rosterDraft.length} employee setting update(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save employee settings.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createEmployee() {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      setMessage("Name, email, and a password are required.");
      return;
    }

    setBusyKey("employee:create");
    setMessage("Adding employee to the listing roster...");

    try {
      const response = await fetch("/api/admin/employees", {
        body: JSON.stringify({
          email: form.email.trim(),
          listingEnabled: form.listingEnabled,
          listingOrder: form.listingOrder,
          name: form.name.trim(),
          password: form.password,
          role: form.role,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to add employee.");
      }

      refreshWorkspace(`Added ${payload.employee?.name || payload.employee?.email || "employee"} to the roster.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add employee.");
    } finally {
      setBusyKey(null);
    }
  }

  async function distributeInventory() {
    setBusyKey("rotation:assign");
    setMessage("Distributing unassigned inventory across the employee order...");

    try {
      const response = await fetch("/api/admin/inventory/bulk", {
        body: JSON.stringify({
          action: "assignListings",
          selection: {
            mode: "all",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to distribute inventory.");
      }

      refreshWorkspace(
        `Assigned ${payload.assigned ?? 0} vehicle(s) to the employee rotation. Skipped ${payload.skipped ?? 0}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to distribute inventory.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Employee Listing Rotation
          </p>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Marketplace-ready manual ops flow
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            The Book assigns vehicles in round-robin order, creates manual posting tasks, and keeps
            each employee in their own secure bucket and inbox.
          </p>
        </div>

        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line)] bg-white/82 text-[var(--foreground)]">
          <Users className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Unassigned</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {listingAutomation.stats.unassigned}
          </p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Ready to post</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {listingAutomation.stats.readyToPost}
          </p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Needs update</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {listingAutomation.stats.needsUpdate}
          </p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Open tasks</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">
            {listingAutomation.stats.openTasks}
          </p>
        </article>
      </div>

      {message ? (
        <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-white/82 px-4 py-3 text-sm text-[var(--foreground)]">
          {message}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canManage || busyKey === "rotation:assign" || !listingAutomation.roster.some((member) => member.listingEnabled)}
          onClick={distributeInventory}
          type="button"
        >
          {busyKey === "rotation:assign" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Shuffle className="h-4 w-4" />
          )}
          Distribute unassigned inventory
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canManage || busyKey === "roster:save"}
          onClick={saveRosterSettings}
          type="button"
        >
          {busyKey === "roster:save" ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save order
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {orderedRoster.length ? (
          orderedRoster.map((member) => {
            const draft = rosterDraft.find((entry) => entry.id === member.id) ?? {
              id: member.id,
              listingEnabled: member.listingEnabled,
              listingOrder: member.listingOrder,
              role: member.role,
            };
            const inboxHref = buildUserMessagesPath({
              tenantName,
              userEmail: member.email,
              userId: member.userId,
              userName: member.name,
            });

            return (
              <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4" key={member.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-[var(--foreground)]">
                        {member.name || member.email}
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(member.role)}`}>
                        {member.role}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(member.status)}`}>
                        {member.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{member.email}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-[var(--muted)]">
                      <span>{member.assignedCount} assigned</span>
                      <span>{member.readyToPostCount} ready</span>
                      <span>{member.postedCount} posted</span>
                      <span>{member.needsUpdateCount} updates</span>
                      <span>{member.soldActionCount} sold actions</span>
                      <span>{member.openTaskCount} open tasks</span>
                    </div>
                  </div>

                  <Link
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                    href={inboxHref}
                  >
                    View bucket
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span className="block text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Order</span>
                    <input
                      className="mt-2 w-full bg-transparent outline-none"
                      disabled={!canManage}
                      inputMode="numeric"
                      onChange={(event) =>
                        updateDraft(member.id, {
                          listingOrder: Number(event.target.value) || 0,
                        })
                      }
                      value={draft.listingOrder}
                    />
                  </label>
                  <label className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <span className="block text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Role</span>
                    <select
                      className="mt-2 w-full bg-transparent outline-none"
                      disabled={!canManage || draft.role === "OWNER"}
                      onChange={(event) =>
                        updateDraft(member.id, {
                          role: event.target.value as RosterDraft["role"],
                        })
                      }
                      value={draft.role}
                    >
                      <option value="OWNER">Owner</option>
                      <option value="ADMIN">Admin</option>
                      <option value="MANAGER">Manager</option>
                      <option value="AGENT">Agent</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] px-4 py-3 text-sm text-[var(--foreground)]">
                    <div>
                      <span className="block text-xs uppercase tracking-[0.16em] text-[var(--muted)]">In rotation</span>
                      <span className="mt-2 block font-semibold">
                        {draft.listingEnabled ? "Enabled" : "Paused"}
                      </span>
                    </div>
                    <input
                      checked={draft.listingEnabled}
                      disabled={!canManage}
                      onChange={(event) =>
                        updateDraft(member.id, {
                          listingEnabled: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[22px] border border-[var(--line)] bg-white/82 px-4 py-5 text-sm text-[var(--muted)]">
            No employee roster yet. Add the dealership employees who should rotate manual listing tasks.
          </div>
        )}
      </div>

      {canManage ? (
        <div className="mt-5 rounded-[24px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Add employee
          </p>
          <div className="mt-3 grid gap-3">
            <input
              className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Employee name"
              value={form.name}
            />
            <input
              className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="employee@dealership.com"
              type="email"
              value={form.email}
            />
            <input
              className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Temporary password"
              type="password"
              value={form.password}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value as typeof current.role,
                  }))
                }
                value={form.role}
              >
                <option value="AGENT">Agent</option>
                <option value="MANAGER">Manager</option>
                <option value="ADMIN">Admin</option>
              </select>
              <input
                className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                inputMode="numeric"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    listingOrder: Number(event.target.value) || 0,
                  }))
                }
                placeholder="Rotation order"
                value={form.listingOrder}
              />
              <label className="flex items-center justify-between rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)]">
                <span>Enable in rotation</span>
                <input
                  checked={form.listingEnabled}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      listingEnabled: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
              </label>
            </div>
          </div>

          <button
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyKey === "employee:create" || isPending}
            onClick={createEmployee}
            type="button"
          >
            {busyKey === "employee:create" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Add employee
          </button>
        </div>
      ) : null}
    </section>
  );
}
