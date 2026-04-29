"use client";
/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  LoaderCircle,
  Radar,
  ShieldAlert,
  WandSparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { formatCurrency } from "@/lib/marketplace";
import { sanitizeHttpUrl } from "@/lib/url";

type ExistingSource = {
  id: string;
  lastDetectionSummary: string | null;
  lastDetectionStatus: string | null;
  name: string;
  requiresReview: boolean;
  status: string;
  websiteUrl: string;
};

type DetectionPreviewVehicle = {
  bodyStyle: string | null;
  condition: string;
  drivetrain: string | null;
  engine: string | null;
  exteriorColor: string | null;
  fuelType: string | null;
  imageUrls: string[];
  inventoryListedAt: string | null;
  interiorColor: string | null;
  listingPosition: number | null;
  make: string | null;
  mileage: number | null;
  model: string | null;
  price: number | null;
  sourceUrl: string;
  stockNumber: string | null;
  title: string;
  transmission: string | null;
  trim: string | null;
  vin: string | null;
  year: number | null;
};

type DetectionResultState = {
  confidence: number;
  detectedVehicleCount: number;
  detectionRunId: string;
  detectionStrategy: string;
  inventorySourceId: string;
  notes: string | null;
  previewVehicles: DetectionPreviewVehicle[];
  requiresReview: boolean;
  summary: string;
};

type OnboardingWizardProps = {
  existingSources: ExistingSource[];
  tenantName: string;
};

type PreviewConditionFilter = "ALL" | "NEW" | "USED";
type PreviewSort = "WEBSITE_ORDER" | "LISTED_NEWEST" | "LISTED_OLDEST";

const ALL_RESULTS_PAGE_SIZE = -1;
const DETECTION_ETA_SECONDS = 45;

function statusClass(status: string) {
  switch (status) {
    case "ACTIVE":
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "REQUIRES_REVIEW":
    case "REVIEW_REQUIRED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "FAILED":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
  }
}

function enumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatListedDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

function getListingTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function matchesConditionFilter(
  vehicle: DetectionPreviewVehicle,
  filter: PreviewConditionFilter,
) {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "NEW") {
    return vehicle.condition === "NEW";
  }

  return vehicle.condition === "USED" || vehicle.condition === "CPO";
}

export function OnboardingWizard({
  existingSources,
  tenantName,
}: OnboardingWizardProps) {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [detection, setDetection] = useState<DetectionResultState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApproving, startApproval] = useTransition();
  const [previewConditionFilter, setPreviewConditionFilter] =
    useState<PreviewConditionFilter>("ALL");
  const [previewSort, setPreviewSort] = useState<PreviewSort>("WEBSITE_ORDER");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState(24);
  const [detectionElapsedMs, setDetectionElapsedMs] = useState(0);

  const detectedVehicleCount = detection?.detectedVehicleCount ?? 0;
  const previewVehicleCount = detection?.previewVehicles.length ?? 0;

  const filteredPreviewVehicles = useMemo(() => {
    const vehicles = detection?.previewVehicles ?? [];
    const filtered = vehicles.filter((vehicle) =>
      matchesConditionFilter(vehicle, previewConditionFilter),
    );
    const sorted = [...filtered];

    sorted.sort((left, right) => {
      if (previewSort === "WEBSITE_ORDER") {
        return (left.listingPosition ?? Number.MAX_SAFE_INTEGER) -
          (right.listingPosition ?? Number.MAX_SAFE_INTEGER);
      }

      const leftTimestamp = getListingTimestamp(left.inventoryListedAt);
      const rightTimestamp = getListingTimestamp(right.inventoryListedAt);

      if (
        leftTimestamp !== null &&
        rightTimestamp !== null &&
        leftTimestamp !== rightTimestamp
      ) {
        return previewSort === "LISTED_NEWEST"
          ? rightTimestamp - leftTimestamp
          : leftTimestamp - rightTimestamp;
      }

      return previewSort === "LISTED_NEWEST"
        ? (right.listingPosition ?? 0) - (left.listingPosition ?? 0)
        : (left.listingPosition ?? 0) - (right.listingPosition ?? 0);
    });

    return sorted;
  }, [detection, previewConditionFilter, previewSort]);

  const totalPreviewPages =
    previewPageSize === ALL_RESULTS_PAGE_SIZE
      ? 1
      : Math.max(1, Math.ceil(filteredPreviewVehicles.length / previewPageSize));
  const currentPreviewPage = Math.min(previewPage, totalPreviewPages);

  const visiblePreviewVehicles = useMemo(() => {
    if (previewPageSize === ALL_RESULTS_PAGE_SIZE) {
      return filteredPreviewVehicles;
    }

    const startIndex = (currentPreviewPage - 1) * previewPageSize;
    return filteredPreviewVehicles.slice(startIndex, startIndex + previewPageSize);
  }, [currentPreviewPage, filteredPreviewVehicles, previewPageSize]);

  useEffect(() => {
    if (!isPending) {
      setDetectionElapsedMs(0);
      return;
    }

    const startedAt = Date.now();
    setDetectionElapsedMs(0);

    const interval = window.setInterval(() => {
      setDetectionElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPending]);

  const detectionElapsedSeconds = Math.floor(detectionElapsedMs / 1000);
  const detectionEtaRemaining = Math.max(
    0,
    DETECTION_ETA_SECONDS - detectionElapsedSeconds,
  );
  const detectionProgress = Math.min(
    95,
    Math.round((detectionElapsedSeconds / DETECTION_ETA_SECONDS) * 100),
  );

  function resetPreviewControls() {
    setPreviewConditionFilter("ALL");
    setPreviewSort("WEBSITE_ORDER");
    setPreviewPage(1);
    setPreviewPageSize(24);
  }

  function handleDetect() {
    setMessage(null);
    setDetection(null);
    resetPreviewControls();

    startTransition(async () => {
      try {
        const response = await fetch("/api/onboarding/detect", {
          body: JSON.stringify({
            sourceName: sourceName.trim() || undefined,
            websiteUrl,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to inspect that dealership site.");
        }

        setDetection(payload);
        setMessage(
          payload.requiresReview
            ? "We found a likely inventory structure and saved a reviewable preview."
            : "Inventory structure detected. Review the inventory sample and activate when ready.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to inspect that dealership site.",
        );
      }
    });
  }

  function handleApprove() {
    if (!detection) {
      return;
    }

    setMessage(null);

    startApproval(async () => {
      try {
        const response = await fetch("/api/onboarding/approve", {
          body: JSON.stringify({
            detectionRunId: detection.detectionRunId,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Unable to activate that source.");
        }

        setMessage(
          payload.requiresReview
            ? "The source was saved for review. We'll keep the preview and mapping so it can be finalized quickly."
            : "Source activated. Initial sync queued and automatic sync polling enabled.",
        );

        router.push("/admin");
        router.refresh();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to activate that source.",
        );
      }
    });
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-[34px] border border-[var(--line)] bg-[linear-gradient(135deg,rgba(255,250,244,0.96),rgba(248,240,229,0.92),rgba(227,214,193,0.94))] p-8 shadow-[0_30px_90px_rgba(19,29,33,0.12)]">
        <p className="font-mono text-xs uppercase tracking-[0.34em] text-[var(--muted)]">
          LotPilot Onboarding
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
          Paste a dealer URL and let the system work through the layers.
        </h1>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--muted)] sm:text-base">
          {tenantName} gets a simple &quot;paste a URL and go&quot; experience. Under
          the hood we try feed discovery, structured data, platform templates,
          generic crawling, and finally a review fallback when confidence is
          low.
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr),minmax(320px,0.8fr)]">
        <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-6 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-[22px] border border-[var(--line)] bg-white/80 p-4">
              <Globe className="h-5 w-5 text-[var(--accent-strong)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                Submit URL
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Start with the homepage or inventory entry point.
              </p>
            </article>
            <article className="rounded-[22px] border border-[var(--line)] bg-white/80 p-4">
              <Radar className="h-5 w-5 text-[var(--accent-strong)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                Preview Detection
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                See confidence, strategy, filters, and detected inventory before
                approval.
              </p>
            </article>
            <article className="rounded-[22px] border border-[var(--line)] bg-white/80 p-4">
              <WandSparkles className="h-5 w-5 text-[var(--accent-strong)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                Approve and Activate
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Supported sites queue an initial sync and automatic ongoing
                polling. Low-confidence sites stay honest and reviewable.
              </p>
            </article>
          </div>

          <div className="mt-6 grid gap-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Dealership website
              </span>
              <input
                className="w-full rounded-[18px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="https://www.exampledealer.com"
                type="url"
                value={websiteUrl}
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                Source label
              </span>
              <input
                className="w-full rounded-[18px] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none"
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="Optional internal label"
                type="text"
                value={sourceName}
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!websiteUrl.trim() || isPending}
                onClick={handleDetect}
                type="button"
              >
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Radar className="h-4 w-4" />
                )}
                Detect inventory
              </button>

              <button
                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!detection || isApproving}
                onClick={handleApprove}
                type="button"
              >
                {isApproving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve onboarding
              </button>
            </div>

            {isPending ? (
              <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,242,235,0.62)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      Scanning the dealership inventory...
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Rough ETA:{" "}
                      {detectionEtaRemaining > 0
                        ? `${detectionEtaRemaining}s remaining`
                        : "wrapping up the preview"}
                    </p>
                  </div>
                  <div className="text-sm text-[var(--muted)]">
                    Elapsed: {detectionElapsedSeconds}s
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{ width: `${detectionProgress}%` }}
                  />
                </div>
                <p className="mt-3 text-xs leading-6 text-[var(--muted)]">
                  We first identify the inventory structure, then collect the
                  preview rows and their listing details. Larger dealer sites
                  can take longer.
                </p>
              </div>
            ) : null}

            {message ? (
              <div className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)]">
                {message}
              </div>
            ) : null}
          </div>

          {detection ? (
            <div className="mt-8 space-y-5 rounded-[28px] border border-[var(--line)] bg-white/82 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                    Detection Result
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {detection.summary}
                  </h2>
                  <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
                    {detection.notes || "Preview saved for this source profile."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Strategy
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {enumLabel(detection.detectionStrategy)}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Confidence
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {Math.round(detection.confidence * 100)}%
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-[var(--line)] bg-[rgba(247,242,235,0.8)] px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      Detected vehicles
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                      {detectedVehicleCount.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {detection.requiresReview ? (
                <div className="flex items-start gap-3 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  <ShieldAlert className="mt-0.5 h-5 w-5" />
                  <p>
                    This site did not reach high-confidence automated
                    activation. We can save the preview and mapping draft, but
                    it should stay in review before pretending sync is fully
                    automated.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col gap-4 rounded-[22px] border border-[var(--line)] bg-[rgba(247,242,235,0.62)] p-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Condition
                    </span>
                    <select
                      className="w-full rounded-[16px] border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                      onChange={(event) => {
                        setPreviewConditionFilter(
                          event.target.value as PreviewConditionFilter,
                        );
                        setPreviewPage(1);
                      }}
                      value={previewConditionFilter}
                    >
                      <option value="ALL">All inventory</option>
                      <option value="NEW">New only</option>
                      <option value="USED">Used + CPO</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Sort
                    </span>
                    <select
                      className="w-full rounded-[16px] border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                      onChange={(event) => {
                        setPreviewSort(event.target.value as PreviewSort);
                        setPreviewPage(1);
                      }}
                      value={previewSort}
                    >
                      <option value="WEBSITE_ORDER">Website order</option>
                      <option value="LISTED_NEWEST">Newest listing first</option>
                      <option value="LISTED_OLDEST">Oldest listing first</option>
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Results per page
                    </span>
                    <select
                      className="w-full rounded-[16px] border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--foreground)] outline-none"
                      onChange={(event) => {
                        setPreviewPageSize(Number(event.target.value));
                        setPreviewPage(1);
                      }}
                      value={previewPageSize}
                    >
                      <option value={24}>24</option>
                      <option value={48}>48</option>
                      <option value={96}>96</option>
                      <option value={ALL_RESULTS_PAGE_SIZE}>All</option>
                    </select>
                  </label>
                </div>

                <div className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)]">
                  Showing {visiblePreviewVehicles.length.toLocaleString()} of{" "}
                  {filteredPreviewVehicles.length.toLocaleString()} filtered
                  preview results from {detectedVehicleCount.toLocaleString()}{" "}
                  detected vehicles.
                </div>
              </div>

              {detectedVehicleCount > previewVehicleCount ? (
                <div className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
                  Preview is showing the first {previewVehicleCount.toLocaleString()} vehicles so
                  onboarding stays fast. Full inventory sync runs after approval.
                </div>
              ) : null}

              {visiblePreviewVehicles.length ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visiblePreviewVehicles.map((vehicle) => (
                    <article
                      className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[rgba(251,247,241,0.9)]"
                      key={vehicle.vin || vehicle.sourceUrl}
                    >
                      <div className="h-48 bg-[rgba(19,29,33,0.06)]">
                        {vehicle.imageUrls[0] ? (
                          <img
                            alt={vehicle.title}
                            className="h-full w-full object-cover"
                            src={sanitizeHttpUrl(vehicle.imageUrls[0]) ?? ""}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 p-4">
                        <div>
                          <p className="text-lg font-semibold text-[var(--foreground)]">
                            {vehicle.title}
                          </p>
                          <p className="mt-1 text-sm text-[var(--muted)]">
                            {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
                              .filter(Boolean)
                              .join(" ")}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                            {enumLabel(vehicle.condition)}
                          </span>
                          {vehicle.stockNumber ? (
                            <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                              Stock {vehicle.stockNumber}
                            </span>
                          ) : null}
                        </div>

                        <div className="grid gap-2 text-sm text-[var(--muted)]">
                          <p>Price: {formatCurrency(vehicle.price)}</p>
                          <p>
                            Mileage:{" "}
                            {vehicle.mileage !== null
                              ? `${vehicle.mileage.toLocaleString()} mi`
                              : "Not listed"}
                          </p>
                          <p>Listed: {formatListedDate(vehicle.inventoryListedAt)}</p>
                          <p>Body style: {vehicle.bodyStyle || "Unknown"}</p>
                          <p>Transmission: {vehicle.transmission || "Unknown"}</p>
                          <p>Engine: {vehicle.engine || "Unknown"}</p>
                          <p>Fuel: {vehicle.fuelType || "Unknown"}</p>
                          <p>Ext. color: {vehicle.exteriorColor || "Unknown"}</p>
                          <p>Int. color: {vehicle.interiorColor || "Unknown"}</p>
                          <p>VIN: {vehicle.vin || "Not detected"}</p>
                        </div>

                        <a
                          className="inline-flex items-center rounded-full border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                          href={sanitizeHttpUrl(vehicle.sourceUrl) ?? "#"}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open live listing
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/70 p-5 text-sm text-[var(--muted)]">
                  No vehicles match the current onboarding filters. Adjust the
                  condition or sort to review another slice of the detected
                  inventory.
                </div>
              )}

              {previewPageSize !== ALL_RESULTS_PAGE_SIZE && totalPreviewPages > 1 ? (
                <div className="flex flex-col gap-3 rounded-[22px] border border-[var(--line)] bg-[rgba(247,242,235,0.62)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-[var(--muted)]">
                    Page {currentPreviewPage} of {totalPreviewPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={currentPreviewPage <= 1}
                      onClick={() =>
                        setPreviewPage((page) => Math.max(1, page - 1))
                      }
                      type="button"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={currentPreviewPage >= totalPreviewPages}
                      onClick={() =>
                        setPreviewPage((page) =>
                          Math.min(totalPreviewPages, page + 1),
                        )
                      }
                      type="button"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="space-y-6">
          <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-6 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
              Existing Sources
            </p>
            <div className="mt-4 space-y-3">
              {existingSources.length ? (
                existingSources.map((source) => (
                  <article
                    className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4"
                    key={source.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">
                        {source.name}
                      </p>
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${statusClass(source.status)}`}
                      >
                        {enumLabel(source.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      {source.websiteUrl}
                    </p>
                    {source.lastDetectionSummary ? (
                      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                        {source.lastDetectionSummary}
                      </p>
                    ) : null}
                    {source.requiresReview ? (
                      <div className="mt-3 flex items-start gap-2 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4" />
                        Waiting for review before full automation.
                      </div>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/70 p-5 text-sm text-[var(--muted)]">
                  No sources connected yet. Run detection with a dealership URL
                  to create the first source profile.
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
