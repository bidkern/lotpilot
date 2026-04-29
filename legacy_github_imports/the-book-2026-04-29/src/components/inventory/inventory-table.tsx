"use client";

import { useDeferredValue, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime, formatMileage } from "@/lib/format";
import type { EmployeeRecord, VehicleRecord } from "@/lib/types";

const sortOptions = [
  { value: "daysOnLot", label: "Age" },
  { value: "priceCents", label: "Price" },
  { value: "mileage", label: "Miles" },
  { value: "make", label: "Make" },
  { value: "model", label: "Model" },
] as const;

export function InventoryTable({
  vehicles,
  employees,
}: {
  vehicles: VehicleRecord[];
  employees: EmployeeRecord[];
}) {
  const [search, setSearch] = useState("");
  const [listedFilter, setListedFilter] = useState<"all" | "listed" | "unlisted">(
    "all",
  );
  const [sortKey, setSortKey] =
    useState<(typeof sortOptions)[number]["value"]>("daysOnLot");

  const deferredSearch = useDeferredValue(search);
  const employeeNameById = Object.fromEntries(
    employees.map((employee) => [employee.id, employee.displayName]),
  );

  const visibleVehicles = [...vehicles]
    .filter((vehicle) => {
      if (listedFilter === "listed" && vehicle.listingStatus !== "POSTED") {
        return false;
      }

      if (listedFilter === "unlisted" && vehicle.listingStatus === "POSTED") {
        return false;
      }

      if (!deferredSearch.trim()) {
        return true;
      }

      const query = deferredSearch.toLowerCase();
      return [
        vehicle.stockNumber,
        vehicle.make,
        vehicle.model,
        vehicle.trim,
        vehicle.year.toString(),
      ].some((value) => value.toLowerCase().includes(query));
    })
    .sort((left, right) => {
      if (sortKey === "make" || sortKey === "model") {
        return left[sortKey].localeCompare(right[sortKey]);
      }

      return right[sortKey] - left[sortKey];
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            { value: "all", label: "All inventory" },
            { value: "listed", label: "Listed on Facebook" },
            { value: "unlisted", label: "Needs listing" },
          ].map((option) => (
            <button
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                listedFilter === option.value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
              key={option.value}
              onClick={() =>
                setListedFilter(option.value as "all" | "listed" | "unlisted")
              }
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex min-w-[260px] items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
            <Search size={16} />
            <input
              className="w-full bg-transparent text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search make, model, stock..."
              value={search}
            />
          </label>

          <select
            className="rounded-2xl border border-[var(--border)] bg-[var(--card-soft)] px-4 py-3 text-sm text-[var(--foreground)] outline-none"
            onChange={(event) =>
              setSortKey(
                event.target.value as (typeof sortOptions)[number]["value"],
              )
            }
            value={sortKey}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                Sort by {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-[var(--border)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-left text-sm">
            <thead className="bg-[var(--card-soft)] text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Vehicle</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Miles</th>
                <th className="px-4 py-3 font-medium">Time on lot</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Listed by</th>
                <th className="px-4 py-3 font-medium">Synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--card)]">
              {visibleVehicles.map((vehicle) => (
                <tr
                  className="transition hover:bg-[color:color-mix(in_srgb,var(--foreground)_2%,transparent)]"
                  key={vehicle.id}
                >
                  <td className="px-4 py-4 font-mono text-xs text-[var(--muted-foreground)]">
                    {vehicle.stockNumber}
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <p className="font-semibold text-[var(--foreground)]">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {vehicle.trim} · {vehicle.exteriorColor} · {vehicle.imageCount}{" "}
                        photos
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4">{formatCurrency(vehicle.priceCents)}</td>
                  <td className="px-4 py-4 text-[var(--muted-foreground)]">
                    {formatMileage(vehicle.mileage)}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={vehicle.daysOnLot >= 30 ? "tan" : "forest"}>
                      {vehicle.daysOnLot} days
                    </Badge>
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      tone={
                        vehicle.listingStatus === "POSTED"
                          ? "forest"
                          : vehicle.listingStatus === "NEEDS_REVIEW"
                            ? "tan"
                            : "navy"
                      }
                    >
                      {vehicle.listingStatus.replaceAll("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 text-[var(--muted-foreground)]">
                    {vehicle.listedByMembershipId
                      ? employeeNameById[vehicle.listedByMembershipId]
                      : "Unassigned"}
                  </td>
                  <td className="px-4 py-4 text-[var(--muted-foreground)]">
                    {formatDateTime(vehicle.updatedAt)}
                  </td>
                </tr>
              ))}
              {visibleVehicles.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-[var(--muted-foreground)]"
                    colSpan={8}
                  >
                    No vehicles match your current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
