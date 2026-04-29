"use client";
/* eslint-disable @next/next/no-img-element */

import type { getDashboardData } from "@/lib/services/inventory-service";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Filter,
  LoaderCircle,
  PackageSearch,
  RefreshCcw,
  Search,
  ShieldAlert,
  SquareCheckBig,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  buildMarketplaceDescription,
  buildMarketplaceTitle,
  formatCurrency,
  formatDateLabel,
  formatNumber,
} from "@/lib/marketplace";
import { sanitizeHttpUrl } from "@/lib/url";
import { buildUserMessagesPath } from "@/lib/workspace-routes";
import { ListingAutomationPanel } from "@/components/listing-automation-panel";
import { MessagingWorkspacePanel } from "@/components/messaging-workspace-panel";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type InventoryData = DashboardData["inventory"];
type InventoryQuery = InventoryData["query"];
type UserRole = "OWNER" | "ADMIN" | "MANAGER" | "AGENT";
type ExportFormat = "CSV" | "JSON";
type BulkAction = "archive" | "assignListings" | "export" | "markExported" | "refresh";
type SelectionMode = "all" | "filtered" | "manual";

type InventoryDashboardProps = {
  currentUser: {
    email?: string | null;
    id: string;
    name?: string | null;
    role: UserRole;
    tenantName?: string | null;
  };
  dashboard: DashboardData;
};

const roleRank: Record<UserRole, number> = {
  ADMIN: 3,
  AGENT: 1,
  MANAGER: 2,
  OWNER: 4,
};

const workflowStatusOptions = [
  "ALL",
  "ACTIVE",
  "STALE",
  "ARCHIVED",
  "NEEDS_REVIEW",
  "EXPORT_READY",
  "EXPORTED",
  "EXPORT_FAILED",
] as const;

const exportStatusOptions = [
  "ALL",
  "NOT_EXPORTED",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasRole(role: UserRole, minimumRole: UserRole) {
  return roleRank[role] >= roleRank[minimumRole];
}

function badgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
    case "COMPLETED":
    case "HEALTHY":
    case "EXPORT_READY":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "QUEUED":
    case "PROCESSING":
    case "RETRYING":
    case "REQUIRES_REVIEW":
    case "NEEDS_REVIEW":
    case "WARNING":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "FAILED":
    case "DEAD_LETTERED":
    case "EXPORT_FAILED":
    case "CRITICAL":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "ARCHIVED":
    case "STALE":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function conditionClass(condition: string) {
  switch (condition) {
    case "NEW":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "CPO":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function buildInventoryQueryParams(query: InventoryQuery) {
  const searchParams = new URLSearchParams();

  if (query.search) {
    searchParams.set("search", query.search);
  }

  if (query.make) {
    searchParams.set("make", query.make);
  }

  if (query.model) {
    searchParams.set("model", query.model);
  }

  if (query.year) {
    searchParams.set("year", String(query.year));
  }

  if (query.workflowStatus && query.workflowStatus !== "ALL") {
    searchParams.set("workflowStatus", query.workflowStatus);
  }

  if (query.exportStatus && query.exportStatus !== "ALL") {
    searchParams.set("exportStatus", query.exportStatus);
  }

  if (query.minPrice !== null) {
    searchParams.set("minPrice", String(query.minPrice));
  }

  if (query.maxPrice !== null) {
    searchParams.set("maxPrice", String(query.maxPrice));
  }

  if (query.sourceId) {
    searchParams.set("sourceId", query.sourceId);
  }

  searchParams.set("page", String(query.page));
  searchParams.set("pageSize", String(query.pageSize));

  return searchParams;
}

async function requestInventory(query: InventoryQuery) {
  const response = await fetch(`/api/admin/inventory?${buildInventoryQueryParams(query)}`, {
    cache: "no-store",
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load inventory.");
  }

  return payload as InventoryData;
}

export function InventoryDashboard({ currentUser, dashboard }: InventoryDashboardProps) {
  const router = useRouter();
  const messagesHref = buildUserMessagesPath({
    tenantName: dashboard.tenant.name,
    userEmail: currentUser.email,
    userId: currentUser.id,
    userName: currentUser.name,
  });
  const [inventory, setInventory] = useState(dashboard.inventory);
  const [searchTerm, setSearchTerm] = useState(dashboard.inventory.query.search ?? "");
  const [makeFilter, setMakeFilter] = useState(dashboard.inventory.query.make ?? "ALL");
  const [modelFilter, setModelFilter] = useState(dashboard.inventory.query.model ?? "ALL");
  const [sourceFilter, setSourceFilter] = useState(dashboard.inventory.query.sourceId ?? "ALL");
  const [yearFilter, setYearFilter] = useState(
    dashboard.inventory.query.year ? String(dashboard.inventory.query.year) : "ALL",
  );
  const [workflowStatusFilter, setWorkflowStatusFilter] =
    useState<(typeof workflowStatusOptions)[number]>(dashboard.inventory.query.workflowStatus);
  const [exportStatusFilter, setExportStatusFilter] =
    useState<(typeof exportStatusOptions)[number]>(dashboard.inventory.query.exportStatus);
  const [minPrice, setMinPrice] = useState(
    dashboard.inventory.query.minPrice !== null ? String(dashboard.inventory.query.minPrice) : "",
  );
  const [maxPrice, setMaxPrice] = useState(
    dashboard.inventory.query.maxPrice !== null ? String(dashboard.inventory.query.maxPrice) : "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("manual");
  const [page, setPage] = useState(dashboard.inventory.pagination.page);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [isInventoryLoading, setIsInventoryLoading] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [providerType, setProviderType] = useState<"FEED" | "VAUTO" | "WEBSITE_SCRAPER">("VAUTO");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerExternalAccountId, setProviderExternalAccountId] = useState("");
  const [providerCredentialReference, setProviderCredentialReference] = useState("");
  const [providerSourceId, setProviderSourceId] = useState("NONE");
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(searchTerm);
  const hasMountedRef = useRef(false);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const inventoryQuery = useMemo(
    () =>
      ({
        exportStatus: exportStatusFilter,
        make: makeFilter === "ALL" ? null : makeFilter,
        maxPrice: maxPrice ? Number(maxPrice) : null,
        minPrice: minPrice ? Number(minPrice) : null,
        model: modelFilter === "ALL" ? null : modelFilter,
        page,
        pageSize: inventory.pagination.pageSize,
        search: deferredSearch.trim() || null,
        sourceId: sourceFilter === "ALL" ? null : sourceFilter,
        workflowStatus: workflowStatusFilter,
        year: yearFilter === "ALL" ? null : Number(yearFilter),
      }) satisfies InventoryQuery,
    [
      deferredSearch,
      exportStatusFilter,
      inventory.pagination.pageSize,
      makeFilter,
      maxPrice,
      minPrice,
      modelFilter,
      page,
      sourceFilter,
      workflowStatusFilter,
      yearFilter,
    ],
  );
  const pageVehicleIds = inventory.vehicles.map((vehicle) => vehicle.id);
  const selectedSource =
    sourceFilter === "ALL"
      ? null
      : dashboard.sources.find((source) => source.id === sourceFilter) ?? null;
  const selectedVehicle = inventory.vehicles.find((vehicle) => vehicle.id === activeVehicleId) ?? null;
  const publicationDestinations = dashboard.messaging.publicationDestinations;
  const selectedCount =
    selectionMode === "manual"
      ? selectedIds.length
      : selectionMode === "filtered"
        ? inventory.pagination.totalFiltered
        : inventory.pagination.totalInventory;
  const allPageSelected =
    pageVehicleIds.length > 0 &&
    pageVehicleIds.every((vehicleId) =>
      selectionMode === "manual" ? selectedIdSet.has(vehicleId) : true,
    );
  const allFilteredSelected =
    selectionMode === "filtered" && inventory.pagination.totalFiltered > 0;
  const allInventorySelected =
    selectionMode === "all" && inventory.pagination.totalInventory > 0;

  const canSyncSources = hasRole(currentUser.role, "MANAGER");
  const canManageProviders = hasRole(currentUser.role, "MANAGER");
  const canManageListingAutomation = hasRole(currentUser.role, "MANAGER");

  async function fetchInventory(nextQuery: InventoryQuery) {
    setIsInventoryLoading(true);

    try {
      const payload = await requestInventory(nextQuery);
      setInventory(payload);
      setPage(payload.pagination.page);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load inventory.");
    } finally {
      setIsInventoryLoading(false);
    }
  }

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    void fetchInventory(inventoryQuery);
  }, [inventoryQuery]);

  useEffect(() => {
    setInventory(dashboard.inventory);
  }, [dashboard.inventory]);

  function setPageWithinBounds(nextPage: number) {
    setPage(Math.max(1, Math.min(inventory.pagination.totalPages, nextPage)));
  }

  function toggleVehicle(vehicleId: string) {
    if (selectionMode !== "manual") {
      setSelectionMode("manual");
      setSelectedIds(pageVehicleIds.filter((id) => id !== vehicleId));
      return;
    }

    setSelectedIds((current) =>
      current.includes(vehicleId)
        ? current.filter((id) => id !== vehicleId)
        : [...current, vehicleId],
    );
  }

  function selectPage() {
    setSelectionMode("manual");
    setSelectedIds((current) => Array.from(new Set([...current, ...pageVehicleIds])));
  }

  function selectAllFiltered() {
    setSelectionMode("filtered");
    setSelectedIds([]);
  }

  function selectAllInventory() {
    setSelectionMode("all");
    setSelectedIds([]);
  }

  function clearSelection() {
    setSelectionMode("manual");
    setSelectedIds([]);
  }

  function buildSelectionPayload() {
    if (selectionMode === "manual") {
      return {
        mode: "manual" as const,
        vehicleIds: selectedIds,
      };
    }

    if (selectionMode === "filtered") {
      return {
        filters: {
          exportStatus: inventoryQuery.exportStatus,
          make: inventoryQuery.make ?? undefined,
          maxPrice: inventoryQuery.maxPrice ?? undefined,
          minPrice: inventoryQuery.minPrice ?? undefined,
          model: inventoryQuery.model ?? undefined,
          search: inventoryQuery.search ?? undefined,
          sourceId: inventoryQuery.sourceId ?? undefined,
          workflowStatus: inventoryQuery.workflowStatus,
          year: inventoryQuery.year ?? undefined,
        },
        mode: "filtered" as const,
      };
    }

    return {
      mode: "all" as const,
    };
  }

  async function refreshDashboard(nextMessage: string) {
    setMessage(nextMessage);
    await fetchInventory(inventoryQuery);
    startTransition(() => {
      router.refresh();
    });
  }

  async function queueSourceSync(sourceId: string) {
    setBusyKey(`sync:${sourceId}`);
    setMessage("Queueing inventory sync...");

    try {
      const response = await fetch("/api/admin/inventory/sync", {
        body: JSON.stringify({ sourceIds: [sourceId] }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to queue sync.");
      }

      await refreshDashboard(`Queued ${payload.queued} sync job(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue sync.");
    } finally {
      setBusyKey(null);
    }
  }

  async function runBulkAction(action: BulkAction, format?: ExportFormat) {
    if (!selectedCount) {
      setMessage("Select at least one vehicle first.");
      return;
    }

    setBusyKey(`bulk:${action}`);
    setMessage("Processing bulk action...");

    try {
      const response = await fetch("/api/admin/inventory/bulk", {
        body: JSON.stringify(
          action === "export"
            ? { action, format: format ?? "CSV", selection: buildSelectionPayload() }
            : { action, selection: buildSelectionPayload() },
        ),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Bulk action failed.");
      }

      clearSelection();
      await refreshDashboard(
        action === "archive"
          ? `Archived ${payload.archivedCount ?? selectedCount} vehicle(s).`
          : action === "assignListings"
            ? `Assigned ${payload.assigned ?? 0} vehicle(s) into the employee rotation.`
          : action === "refresh"
            ? `Queued ${payload.queued ?? 0} refresh job(s).`
            : action === "markExported"
              ? `Marked ${payload.markedCount ?? selectedCount} vehicle(s) as exported.`
              : `Queued export job ${payload.exportJobId}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk action failed.");
    } finally {
      setBusyKey(null);
    }
  }

  async function runPublicationQueue(messagingConnectionId: string) {
    if (!selectedCount) {
      setMessage("Select at least one vehicle first.");
      return;
    }

    setBusyKey(`publish:${messagingConnectionId}`);
    setMessage("Queueing Facebook publication prep...");

    try {
      const response = await fetch("/api/admin/inventory/bulk", {
        body: JSON.stringify({
          action: "publish",
          messagingConnectionId,
          selection: buildSelectionPayload(),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Unable to queue publication prep.");
      }

      await refreshDashboard(
        `Queued ${payload.queued ?? 0} publication job(s). ${payload.alreadyTracked ?? 0} were already current.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue publication prep.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createProviderConnection() {
    if (!providerName.trim()) {
      setMessage("Provider name is required.");
      return;
    }

    setBusyKey("provider:create");
    setMessage("Saving inventory provider connection...");

    try {
      const response = await fetch("/api/admin/providers", {
        body: JSON.stringify({
          baseUrl: providerBaseUrl.trim() || undefined,
          credentialReference: providerCredentialReference.trim() || undefined,
          externalAccountId: providerExternalAccountId.trim() || undefined,
          name: providerName.trim(),
          providerType,
          sourceId: providerSourceId !== "NONE" ? providerSourceId : undefined,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to create provider connection.");
      }

      setProviderName("");
      setProviderBaseUrl("");
      setProviderCredentialReference("");
      setProviderExternalAccountId("");
      setProviderSourceId("NONE");
      await refreshDashboard(`Saved provider connection ${payload.connection.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create provider connection.");
    } finally {
      setBusyKey(null);
    }
  }

  async function queueProviderSync(providerId: string) {
    setBusyKey(`provider:${providerId}`);
    setMessage("Queueing provider sync...");

    try {
      const response = await fetch(`/api/admin/providers/${providerId}/sync`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to queue provider sync.");
      }

      await refreshDashboard("Provider sync queued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue provider sync.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[34px] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,250,244,0.98),rgba(248,240,229,0.92),rgba(227,214,193,0.94))] p-8 shadow-[0_30px_90px_rgba(19,29,33,0.12)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.34em] text-[var(--muted)]">
              {currentUser.tenantName || dashboard.tenant.name}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
              All-in-one dealer operations with honest automation and human review.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)] sm:text-base">
              Dealers onboard inventory sources, sync vehicles, route listing work to employees,
              and manage Facebook-connected customer messaging from the same tenant-safe workspace.
            </p>
          </div>

          <div className="rounded-[28px] border border-[var(--line)] bg-white/80 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              Signed in
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
              {currentUser.name || currentUser.email || "Team member"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {enumLabel(currentUser.role)}
              {currentUser.email ? ` | ${currentUser.email}` : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                className="rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92"
                href="/onboarding"
              >
                Test another website
              </Link>
              <button
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                onClick={() => signOut({ callbackUrl: "/login" })}
                type="button"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-6">
          {[
            ["Tracked", inventory.stats.total],
            ["Active", inventory.stats.active],
            ["Export Ready", inventory.stats.exportReady],
            ["Needs Review", inventory.stats.needsReview],
            ["Exported", inventory.stats.exported],
            ["Selected", selectedCount],
          ].map(([label, value]) => (
            <article className="rounded-[22px] border border-[var(--line)] bg-white/76 p-4" key={label}>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--foreground)]">{value}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-[24px] border border-[var(--line)] bg-[rgba(17,40,46,0.92)] px-5 py-4 text-sm text-white/82">
          Supported workflow: sync inventory, prepare reviewable exports and posting payloads,
          route work to staff, and keep customer conversations in one system. Unsupported idea:
          claiming universal one-click posting across every dealer site and destination.
        </div>

        <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-white/80 px-5 py-4 text-sm text-[var(--foreground)]">
          You can test another dealership website at any time. Detection builds a preview first, and inventory does not enter this workspace until that source is approved.
        </div>
      </section>

      {message ? (
        <div className="rounded-[20px] border border-[var(--line)] bg-white/85 px-4 py-3 text-sm text-[var(--foreground)]">
          {message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr),360px]">
        <section className="space-y-6">
          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-6 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--muted)]">
                  {selectedSource ? "Car Dealership Inventory" : "Inventory Table"}
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {selectedSource
                    ? `${selectedSource.name} inventory`
                    : "Search, filter, inspect, and bulk-process inventory"}
                </h2>
                {selectedSource ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Showing inventory only for {selectedSource.name}. Clear the dealership filter to
                    return to the full tenant workspace.
                  </p>
                ) : null}
                {isInventoryLoading ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">Loading filtered inventory...</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!pageVehicleIds.length || allPageSelected}
                  onClick={selectPage}
                  type="button"
                >
                  <SquareCheckBig className="h-4 w-4" />
                  Select page
                </button>
                <button
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!inventory.pagination.totalFiltered || allFilteredSelected}
                  onClick={selectAllFiltered}
                  type="button"
                >
                  Select filtered
                </button>
                <button
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!inventory.pagination.totalInventory || allInventorySelected}
                  onClick={selectAllInventory}
                  type="button"
                >
                  Select all
                </button>
                <button
                  className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!selectedCount}
                  onClick={clearSelection}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  <Search className="h-4 w-4" />
                  Search
                </span>
                <input
                  className="w-full bg-transparent text-sm outline-none"
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setPage(1);
                  }}
                  placeholder="VIN, stock, make, model"
                  value={searchTerm}
                />
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  <PackageSearch className="h-4 w-4" />
                  Car dealership
                </span>
                <select
                  className="w-full bg-transparent text-sm outline-none"
                  onChange={(event) => {
                    setSourceFilter(event.target.value);
                    setPage(1);
                  }}
                  value={sourceFilter}
                >
                  <option value="ALL">All dealerships</option>
                  {dashboard.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  <Filter className="h-4 w-4" />
                  Make
                </span>
                <select className="w-full bg-transparent text-sm outline-none" onChange={(event) => { setMakeFilter(event.target.value); setPage(1); }} value={makeFilter}>
                  <option value="ALL">All makes</option>
                  {inventory.filters.makes.map((make) => (
                    <option key={make} value={make}>
                      {make}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Model
                </span>
                <select className="w-full bg-transparent text-sm outline-none" onChange={(event) => { setModelFilter(event.target.value); setPage(1); }} value={modelFilter}>
                  <option value="ALL">All models</option>
                  {inventory.filters.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Year
                </span>
                <select className="w-full bg-transparent text-sm outline-none" onChange={(event) => { setYearFilter(event.target.value); setPage(1); }} value={yearFilter}>
                  <option value="ALL">All years</option>
                  {inventory.filters.years.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Workflow status
                </span>
                <select className="w-full bg-transparent text-sm outline-none" onChange={(event) => { setWorkflowStatusFilter(event.target.value as (typeof workflowStatusOptions)[number]); setPage(1); }} value={workflowStatusFilter}>
                  {workflowStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status === "ALL" ? "All statuses" : enumLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Export status
                </span>
                <select className="w-full bg-transparent text-sm outline-none" onChange={(event) => { setExportStatusFilter(event.target.value as (typeof exportStatusOptions)[number]); setPage(1); }} value={exportStatusFilter}>
                  {exportStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status === "ALL" ? "All exports" : enumLabel(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Min price
                </span>
                <input className="w-full bg-transparent text-sm outline-none" inputMode="numeric" onChange={(event) => { setMinPrice(event.target.value); setPage(1); }} placeholder="0" value={minPrice} />
              </label>

              <label className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3">
                <span className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Max price
                </span>
                <input className="w-full bg-transparent text-sm outline-none" inputMode="numeric" onChange={(event) => { setMaxPrice(event.target.value); setPage(1); }} placeholder="50000" value={maxPrice} />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedCount || busyKey === "bulk:export"}
                onClick={() => runBulkAction("export", "CSV")}
                type="button"
              >
                {busyKey === "bulk:export" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Bulk export CSV
              </button>
              <button
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedCount || busyKey === "bulk:refresh"}
                onClick={() => runBulkAction("refresh")}
                type="button"
              >
                Bulk refresh
              </button>
              <button
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedCount || busyKey === "bulk:markExported"}
                onClick={() => runBulkAction("markExported")}
                type="button"
              >
                Mark exported
              </button>
              <button
                className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canManageListingAutomation || !selectedCount || busyKey === "bulk:assignListings"}
                onClick={() => runBulkAction("assignListings")}
                type="button"
              >
                Assign to rotation
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedCount || busyKey === "bulk:archive"}
                onClick={() => runBulkAction("archive")}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                Archive selected
              </button>
            </div>

            {publicationDestinations.length ? (
              <div className="mt-4 rounded-[22px] border border-[var(--line)] bg-[rgba(247,242,235,0.72)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Facebook Review Destinations
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Prepare review-ready posting payloads for one connected Facebook Page. Vehicles
                  are deduplicated per connected account so staff can work from one clean queue.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {publicationDestinations.map((destination) => (
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!selectedCount || busyKey === `publish:${destination.id}`}
                      key={destination.id}
                      onClick={() => runPublicationQueue(destination.id)}
                      type="button"
                    >
                      {busyKey === `publish:${destination.id}` ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Queue for {destination.pageName || destination.ownerName || "Facebook"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 overflow-hidden rounded-[24px] border border-[var(--line)]">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left">
                  <thead className="border-b border-[var(--line)] bg-[rgba(247,242,235,0.75)] text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3">Select</th>
                      <th className="px-4 py-3">Vehicle</th>
                      <th className="px-4 py-3">Stock / VIN</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Facebook</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.vehicles.length ? (
                      inventory.vehicles.map((vehicle) => (
                        <tr className="border-b border-[var(--line)] last:border-b-0" key={vehicle.id}>
                          <td className="px-4 py-4 align-top">
                            <input
                              checked={selectionMode === "manual" ? selectedIdSet.has(vehicle.id) : true}
                              onChange={() => toggleVehicle(vehicle.id)}
                              type="checkbox"
                            />
                          </td>
                          <td className="px-4 py-4 align-top">
                            <button className="text-left" onClick={() => setActiveVehicleId(vehicle.id)} type="button">
                              <p className="font-semibold text-[var(--foreground)]">
                                {buildMarketplaceTitle(vehicle) || vehicle.title}
                              </p>
                              <p className="mt-1 text-sm text-[var(--muted)]">
                                {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ")}
                              </p>
                              <p className="mt-2 text-xs text-[var(--muted)]">
                                {vehicle.mileage ? `${formatNumber(vehicle.mileage)} miles` : "Mileage unknown"}
                              </p>
                            </button>
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-[var(--foreground)]">
                            <p>{vehicle.stockNumber || "No stock number"}</p>
                            <p className="mt-1 text-[var(--muted)]">{vehicle.vin || "VIN missing"}</p>
                          </td>
                          <td className="px-4 py-4 align-top text-sm font-semibold text-[var(--foreground)]">
                            {formatCurrency(vehicle.price)}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex flex-wrap gap-2">
                              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(vehicle.workflowStatus)}`}>
                                {enumLabel(vehicle.workflowStatus)}
                              </span>
                              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(vehicle.exportStatus)}`}>
                                {enumLabel(vehicle.exportStatus)}
                              </span>
                              {vehicle.listingAssignment ? (
                                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(vehicle.listingAssignment.status)}`}>
                                  {enumLabel(vehicle.listingAssignment.status)}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-[var(--muted)]">
                            <div className="space-y-2">
                              {vehicle.listingAssignment ? (
                                <div className="rounded-[16px] border border-[var(--line)] bg-[rgba(247,242,235,0.72)] px-3 py-2 text-xs">
                                  <p className="font-semibold text-[var(--foreground)]">
                                    {vehicle.listingAssignment.assignee.name ||
                                      vehicle.listingAssignment.assignee.email}
                                  </p>
                                  <p className="mt-1 text-[var(--muted)]">
                                    Rotation order {vehicle.listingAssignment.listingOrder}
                                  </p>
                                </div>
                              ) : (
                                <span>Not assigned</span>
                              )}
                              {vehicle.publications.length ? (
                                <div className="flex flex-wrap gap-2">
                                {vehicle.publications.slice(0, 2).map((publication) => (
                                  <span
                                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(publication.status)}`}
                                    key={publication.id}
                                    title={publication.metaAuthAccount.displayName || publication.metaAuthAccount.facebookUserId}
                                  >
                                    {publication.messagingConnection?.pageName ||
                                      publication.metaAuthAccount.displayName ||
                                      "Facebook"}{" "}
                                    - {enumLabel(publication.status)}
                                  </span>
                                ))}
                                {vehicle.publications.length > 2 ? (
                                  <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                                    +{vehicle.publications.length - 2} more
                                  </span>
                                ) : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-[var(--muted)]">
                            {vehicle.source.name}
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-[var(--muted)]">
                            {formatDateLabel(vehicle.lastUpdatedAt)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="px-4 py-10" colSpan={8}>
                          <div className="flex flex-col items-center justify-center gap-3 text-center text-sm text-[var(--muted)]">
                            <PackageSearch className="h-8 w-8 text-[var(--accent-strong)]" />
                            No vehicles match the current filters.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-[var(--muted)]">
              <p>
                Showing {inventory.vehicles.length ? (inventory.pagination.page - 1) * inventory.pagination.pageSize + 1 : 0}-
                {Math.min(
                  inventory.pagination.page * inventory.pagination.pageSize,
                  inventory.pagination.totalFiltered,
                )}{" "}
                of {inventory.pagination.totalFiltered}
              </p>
              <div className="flex items-center gap-2">
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] disabled:cursor-not-allowed disabled:opacity-50" disabled={inventory.pagination.page <= 1 || isInventoryLoading} onClick={() => setPageWithinBounds(inventory.pagination.page - 1)} type="button">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-16 text-center">
                  {inventory.pagination.page} / {inventory.pagination.totalPages}
                </span>
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] disabled:cursor-not-allowed disabled:opacity-50" disabled={inventory.pagination.page >= inventory.pagination.totalPages || isInventoryLoading} onClick={() => setPageWithinBounds(inventory.pagination.page + 1)} type="button">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </section>
 
        <aside className="space-y-6">
          <MessagingWorkspacePanel
            connectHref="/admin/facebook"
            messaging={dashboard.messaging}
            messagesHref={messagesHref}
            role={currentUser.role}
          />

          <ListingAutomationPanel
            listingAutomation={dashboard.listingAutomation}
            role={currentUser.role}
            tenantName={dashboard.tenant.name}
          />

          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                  Inventory Providers
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Track upstream systems like vAuto or feed endpoints separately from public website scraping.
                </p>
              </div>
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                {dashboard.providerConnections.length} linked
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {dashboard.providerConnections.length ? (
                dashboard.providerConnections.map((provider) => (
                  <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4" key={provider.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--foreground)]">{provider.name}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {enumLabel(provider.providerType)} | {provider.baseUrl || provider.externalAccountId || "No endpoint saved"}
                        </p>
                      </div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(provider.status)}`}>
                        {enumLabel(provider.status)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-[var(--muted)]">
                      <p>Last sync: {formatDateLabel(provider.lastSyncedAt)}</p>
                      <p>Linked sources: {provider.linkedSources.length}</p>
                    </div>
                    {canManageProviders ? (
                      <button
                        className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={busyKey === `provider:${provider.id}`}
                        onClick={() => queueProviderSync(provider.id)}
                        type="button"
                      >
                        {busyKey === `provider:${provider.id}` ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-4 w-4" />
                        )}
                        Queue sync
                      </button>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No upstream provider connections yet. Add one when a dealer can give you vAuto or feed access.
                </p>
              )}
            </div>

            {canManageProviders ? (
              <div className="mt-4 rounded-[22px] border border-[var(--line)] bg-[rgba(247,242,235,0.72)] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Add provider connection
                </p>
                <div className="mt-3 grid gap-3">
                  <input
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) => setProviderName(event.target.value)}
                    placeholder="Provider name"
                    value={providerName}
                  />
                  <select
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) =>
                      setProviderType(event.target.value as "FEED" | "VAUTO" | "WEBSITE_SCRAPER")
                    }
                    value={providerType}
                  >
                    <option value="VAUTO">vAuto</option>
                    <option value="FEED">Feed</option>
                    <option value="WEBSITE_SCRAPER">Website scraper</option>
                  </select>
                  <input
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) => setProviderBaseUrl(event.target.value)}
                    placeholder="Base URL or feed URL"
                    value={providerBaseUrl}
                  />
                  <input
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) => setProviderExternalAccountId(event.target.value)}
                    placeholder="External account ID (optional)"
                    value={providerExternalAccountId}
                  />
                  <select
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) => setProviderSourceId(event.target.value)}
                    value={providerSourceId}
                  >
                    <option value="NONE">Link to a dealership source later</option>
                    {dashboard.sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-[16px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                    onChange={(event) => setProviderCredentialReference(event.target.value)}
                    placeholder="Credential reference / vault key"
                    value={providerCredentialReference}
                  />
                </div>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busyKey === "provider:create"}
                  onClick={createProviderConnection}
                  type="button"
                >
                  {busyKey === "provider:create" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Save provider
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Car Dealerships</p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Click a dealership name to load only that inventory.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  onClick={() => {
                    setSourceFilter("ALL");
                    setPage(1);
                  }}
                  type="button"
                >
                  All dealerships
                </button>
                <Link
                  className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                  href="/onboarding"
                >
                  Add source
                </Link>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {dashboard.sources.map((source) => (
                <article
                  className={`rounded-[22px] border bg-white/82 p-4 ${
                    sourceFilter === source.id
                      ? "border-[var(--accent-strong)] shadow-[0_12px_30px_rgba(36,76,63,0.12)]"
                      : "border-[var(--line)]"
                  }`}
                  key={source.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <button
                      className="text-left font-semibold text-[var(--foreground)] transition hover:text-[var(--accent-strong)]"
                      onClick={() => {
                        setSourceFilter(source.id);
                        setPage(1);
                      }}
                      type="button"
                    >
                      {source.name}
                    </button>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(source.status)}`}>
                      {enumLabel(source.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{source.websiteUrl}</p>
                  <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                    <p>
                      Inventory tracked:{" "}
                      {source.lastHealthMetric?.vehicleCount !== null &&
                      source.lastHealthMetric?.vehicleCount !== undefined
                        ? formatNumber(source.lastHealthMetric.vehicleCount)
                        : "Not synced yet"}
                    </p>
                    <p>Last sync: {formatDateLabel(source.lastSyncedAt)}</p>
                    <p>Adapter: {source.adapterKey || "Manual review"}</p>
                    {source.lastHealthMetric ? (
                      <p>
                        Health:{" "}
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeClass(source.lastHealthMetric.status)}`}>
                          {enumLabel(source.lastHealthMetric.status)}
                        </span>
                      </p>
                    ) : (
                      <p>Health: Not measured yet</p>
                    )}
                  </div>
                  {source.openAlerts.length ? (
                    <div className="mt-3 space-y-2">
                      {source.openAlerts.map((alert) => (
                        <div
                          className={`rounded-[18px] border px-3 py-2 text-xs ${badgeClass(alert.severity)}`}
                          key={alert.id}
                        >
                          <p className="font-semibold">{alert.title}</p>
                          <p className="mt-1">{alert.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {source.lastDetectionRun?.summary ? (
                    <div className="mt-3 rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] px-3 py-2 text-xs text-[var(--muted)]">
                      {source.lastDetectionRun.summary}
                    </div>
                  ) : null}
                  <div className="mt-4 flex gap-2">
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                      onClick={() => {
                        setSourceFilter(source.id);
                        setPage(1);
                      }}
                      type="button"
                    >
                      View inventory
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!canSyncSources || busyKey === `sync:${source.id}` || source.requiresReview}
                      onClick={() => queueSourceSync(source.id)}
                      type="button"
                    >
                      {busyKey === `sync:${source.id}` ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      Run sync
                    </button>
                  </div>
                  {source.requiresReview ? (
                    <div className="mt-3 flex items-start gap-2 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <ShieldAlert className="mt-0.5 h-4 w-4" />
                      Review is required before automated sync activation.
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Health Alerts</p>
            <div className="mt-4 space-y-3">
              {dashboard.recentAlerts.length ? (
                dashboard.recentAlerts.map((alert) => (
                  <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4" key={alert.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">{alert.title}</p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(alert.severity)}`}>
                        {enumLabel(alert.severity)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">{alert.sourceName}</p>
                    <p className="mt-3 text-sm leading-6 text-[var(--foreground)]">{alert.message}</p>
                    <p className="mt-3 text-xs text-[var(--muted)]">{formatDateLabel(alert.createdAt)}</p>
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">No open source health alerts.</p>
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Recent Sync Runs</p>
            <div className="mt-4 space-y-3">
              {dashboard.recentSyncRuns.length ? (
                dashboard.recentSyncRuns.map((run) => (
                  <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4" key={run.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">{run.sourceName}</p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(run.status)}`}>
                        {enumLabel(run.status)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                      <p>Found {formatNumber(run.totalFound)} vehicles</p>
                      <p>Created {formatNumber(run.createdCount)} / Updated {formatNumber(run.updatedCount)}</p>
                      <p>Finished {formatDateLabel(run.finishedAt || run.createdAt)}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">No sync runs yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Export Jobs</p>
            <div className="mt-4 space-y-3">
              {dashboard.exportJobs.length ? (
                dashboard.exportJobs.map((job) => (
                  <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4" key={job.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">{job.format} export</p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(job.status)}`}>
                        {enumLabel(job.status)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-[var(--muted)]">
                      <p>{formatNumber(job.itemCount)} vehicle(s)</p>
                      <p>Created {formatDateLabel(job.createdAt)}</p>
                    </div>
                    {job.fileName && job.status === "COMPLETED" ? (
                      <a
                        className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                        href={`/api/admin/exports/${job.id}/download`}
                      >
                        Download file
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="text-sm text-[var(--muted)]">No export jobs yet.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      {selectedVehicle ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(17,28,33,0.58)] p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[34px] border border-[var(--line)] bg-[rgba(255,252,247,0.98)] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${conditionClass(selectedVehicle.condition)}`}>
                    {enumLabel(selectedVehicle.condition)}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(selectedVehicle.workflowStatus)}`}>
                    {enumLabel(selectedVehicle.workflowStatus)}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(selectedVehicle.exportStatus)}`}>
                    {enumLabel(selectedVehicle.exportStatus)}
                  </span>
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                  {buildMarketplaceTitle(selectedVehicle) || selectedVehicle.title}
                </h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  VIN {selectedVehicle.vin || "missing"}{selectedVehicle.stockNumber ? ` | Stock ${selectedVehicle.stockNumber}` : ""} | {selectedVehicle.source.name}
                </p>
              </div>

              <button
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line)] text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                onClick={() => setActiveVehicleId(null)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
              <div className="space-y-6">
                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <div className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-[rgba(19,29,33,0.05)]">
                    {selectedVehicle.primaryImageUrl ? (
                      <img alt={selectedVehicle.title ?? "Vehicle"} className="h-[360px] w-full object-cover" src={sanitizeHttpUrl(selectedVehicle.primaryImageUrl) ?? ""} />
                    ) : (
                      <div className="flex h-[360px] items-center justify-center text-sm text-[var(--muted)]">No primary image</div>
                    )}
                  </div>
                  {selectedVehicle.images.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      {selectedVehicle.images.slice(0, 4).map((image) => (
                        <div className="overflow-hidden rounded-[18px] border border-[var(--line)]" key={image.id}>
                          <img alt={selectedVehicle.title ?? "Vehicle image"} className="h-24 w-full object-cover" src={sanitizeHttpUrl(image.cachedAssetUrl || image.url) ?? ""} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Vehicle details</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Price</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{formatCurrency(selectedVehicle.price)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Mileage</p>
                      <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
                        {selectedVehicle.mileage ? `${formatNumber(selectedVehicle.mileage)} miles` : "Not listed"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Specs</p>
                      <p className="mt-2 text-sm text-[var(--foreground)]">
                        {[selectedVehicle.engine, selectedVehicle.transmission, selectedVehicle.drivetrain, selectedVehicle.bodyStyle].filter(Boolean).join(" | ") || "Specs pending"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Colors</p>
                      <p className="mt-2 text-sm text-[var(--foreground)]">
                        {[selectedVehicle.exteriorColor, selectedVehicle.interiorColor].filter(Boolean).join(" | ") || "Colors pending"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Export draft</p>
                    <p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--foreground)]">
                      {buildMarketplaceDescription(selectedVehicle)}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <a className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]" href={sanitizeHttpUrl(selectedVehicle.detailPageUrl) ?? "#"} rel="noreferrer" target="_blank">
                      Open listing
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Workflow</p>
                  <div className="mt-4 space-y-3 text-sm text-[var(--foreground)]">
                    <div className="flex items-center justify-between gap-3">
                      <span>First seen</span>
                      <strong>{formatDateLabel(selectedVehicle.firstSeenAt)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Last seen</span>
                      <strong>{formatDateLabel(selectedVehicle.lastSeenAt)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Last exported</span>
                      <strong>{formatDateLabel(selectedVehicle.lastExportedAt)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Export attempts</span>
                      <strong>{formatNumber(selectedVehicle.exportAttemptCount)}</strong>
                    </div>
                  </div>
                </section>

                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Employee listing assignment</p>
                  {selectedVehicle.listingAssignment ? (
                    <div className="mt-4 space-y-3 text-sm text-[var(--foreground)]">
                      <div className="flex items-center justify-between gap-3">
                        <span>Assigned to</span>
                        <strong>
                          {selectedVehicle.listingAssignment.assignee.name ||
                            selectedVehicle.listingAssignment.assignee.email}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Rotation order</span>
                        <strong>{selectedVehicle.listingAssignment.listingOrder}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Status</span>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(selectedVehicle.listingAssignment.status)}`}>
                          {enumLabel(selectedVehicle.listingAssignment.status)}
                        </span>
                      </div>
                      {selectedVehicle.listingAssignment.tasks.length ? (
                        <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.75)] p-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Latest task</p>
                          <p className="mt-2 font-semibold text-[var(--foreground)]">
                            {selectedVehicle.listingAssignment.tasks[0].title}
                          </p>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            {enumLabel(selectedVehicle.listingAssignment.tasks[0].taskType)} | {enumLabel(selectedVehicle.listingAssignment.tasks[0].status)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      This vehicle has not been assigned into the employee posting rotation yet.
                    </p>
                  )}
                </section>

                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Facebook publication state</p>
                  <div className="mt-4 space-y-3">
                    {selectedVehicle.publications.length ? (
                      selectedVehicle.publications.map((publication) => (
                        <article className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.75)] p-4" key={publication.id}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--foreground)]">
                              {publication.messagingConnection?.pageName ||
                                publication.metaAuthAccount.displayName ||
                                publication.metaAuthAccount.facebookUserId}
                            </p>
                            <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(publication.status)}`}>
                              {enumLabel(publication.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            {enumLabel(publication.channel)} | Last sync {formatDateLabel(publication.lastSyncedAt)}
                          </p>
                          {publication.externalListingUrl ? (
                            <a
                              className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] underline-offset-4 hover:underline"
                              href={sanitizeHttpUrl(publication.externalListingUrl) ?? "#"}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open external listing
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        This vehicle has not been queued to any Facebook destination yet.
                      </p>
                    )}
                  </div>
                </section>

                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Recent changes</p>
                  <div className="mt-4 space-y-3">
                    {selectedVehicle.changeEvents.length ? selectedVehicle.changeEvents.map((event) => (
                      <article className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.75)] p-4" key={event.id}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{enumLabel(event.changeType)}</p>
                          <p className="text-xs text-[var(--muted)]">{formatDateLabel(event.createdAt)}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{event.summary}</p>
                      </article>
                    )) : <p className="text-sm text-[var(--muted)]">No change events yet.</p>}
                  </div>
                </section>

                <section className="rounded-[24px] border border-[var(--line)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">Snapshot history</p>
                  <div className="mt-4 space-y-3">
                    {selectedVehicle.snapshots.length ? selectedVehicle.snapshots.map((snapshot) => (
                      <article className="rounded-[18px] border border-[var(--line)] bg-[rgba(19,29,33,0.04)] p-4" key={snapshot.id}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{formatCurrency(snapshot.price)}</p>
                          <p className="text-xs text-[var(--muted)]">{formatDateLabel(snapshot.capturedAt)}</p>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {enumLabel(snapshot.lifecycleStatus)} | {enumLabel(snapshot.exportStatus)}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          Mileage {snapshot.mileage ? formatNumber(snapshot.mileage) : "N/A"}
                        </p>
                      </article>
                    )) : <p className="text-sm text-[var(--muted)]">No snapshots captured yet.</p>}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isPending ? (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--foreground)] shadow-[0_18px_40px_rgba(19,29,33,0.12)]">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Refreshing workspace
        </div>
      ) : null}
    </main>
  );
}
