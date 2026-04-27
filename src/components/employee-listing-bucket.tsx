"use client";
/* eslint-disable @next/next/no-img-element */

import type { getEmployeeListingBucketData } from "@/lib/services/listing-assignment-service";
import { ExternalLink, LoaderCircle, PackageCheck, Route, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatCurrency, formatDateLabel, formatNumber } from "@/lib/marketplace";
import { sanitizeHttpUrl } from "@/lib/url";

type ListingBucketData = Awaited<ReturnType<typeof getEmployeeListingBucketData>>;

type EmployeeListingBucketProps = {
  bucket: ListingBucketData;
};

function badgeClass(status: string) {
  switch (status) {
    case "READY_TO_POST":
    case "POSTED":
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "NEEDS_UPDATE":
    case "SOLD_ACTION_REQUIRED":
    case "OPEN":
    case "IN_PROGRESS":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "DISMISSED":
    case "ARCHIVED":
      return "border-zinc-200 bg-zinc-100 text-zinc-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function taskButtonLabel(taskType: string) {
  switch (taskType) {
    case "UPDATE_POST":
      return "Mark updated";
    case "MARK_SOLD":
      return "Mark sold handled";
    default:
      return "Mark posted";
  }
}

export function EmployeeListingBucket({ bucket }: EmployeeListingBucketProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function updateTask(
    taskId: string,
    taskType: string,
    action: "dismiss" | "markComplete" | "start",
  ) {
    let externalListingUrl: string | undefined;
    let listingReference: string | undefined;

    if (action === "markComplete" && taskType !== "MARK_SOLD") {
      const listingUrlInput = window.prompt(
        "Optional: paste the Marketplace listing URL for tracking.",
        "",
      );
      if (listingUrlInput) {
        externalListingUrl = listingUrlInput.trim();
      }

      const listingReferenceInput = window.prompt(
        "Optional: add a listing note or reference for this post.",
        "",
      );
      if (listingReferenceInput) {
        listingReference = listingReferenceInput.trim();
      }
    }

    setBusyTaskId(taskId);
    setMessage("Updating listing task...");

    try {
      const response = await fetch(`/api/admin/listing-tasks/${taskId}`, {
        body: JSON.stringify({
          action,
          externalListingUrl,
          listingReference,
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "PATCH",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to update listing task.");
      }

      setMessage(
        action === "start"
          ? "Task moved to in progress."
          : action === "dismiss"
            ? "Task dismissed."
            : "Listing task completed.",
      );

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update listing task.");
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <section className="rounded-[30px] border border-[var(--line)] bg-[var(--panel-strong)] p-5 shadow-[0_20px_60px_rgba(19,29,33,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
            Your listing bucket
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
            Assigned vehicle posting tasks
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Vehicles assigned to your employee order appear here with post, update, and sold-handling
            tasks. Complete the manual Marketplace workflow from this bucket, then mark the task done.
          </p>
        </div>

        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line)] bg-white/82 text-[var(--foreground)]">
          <PackageCheck className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Ready</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{bucket.stats.readyToPost}</p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Posted</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{bucket.stats.posted}</p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Updates</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{bucket.stats.needsUpdate}</p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Sold actions</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{bucket.stats.soldActionRequired}</p>
        </article>
        <article className="rounded-[22px] border border-[var(--line)] bg-white/82 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Open tasks</p>
          <p className="mt-3 text-3xl font-semibold text-[var(--foreground)]">{bucket.stats.openTasks}</p>
        </article>
      </div>

      {message ? (
        <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-white/82 px-4 py-3 text-sm text-[var(--foreground)]">
          {message}
        </div>
      ) : null}

      {!bucket.membership ? (
        <div className="mt-4 rounded-[20px] border border-[var(--line)] bg-white/82 px-4 py-3 text-sm text-[var(--muted)]">
          No employee listing membership was found for this user yet.
        </div>
      ) : null}

      {bucket.membership && !bucket.membership.listingEnabled ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your dealership profile is paused from the listing rotation. You can still view messages,
          but new vehicle assignments will wait until the manager enables your rotation slot.
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {bucket.vehicles.length ? (
          bucket.vehicles.map((assignment) => (
            <article className="rounded-[24px] border border-[var(--line)] bg-white/82 p-4" key={assignment.id}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex gap-4">
                  <div className="hidden h-28 w-36 overflow-hidden rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.82)] sm:block">
                    {assignment.vehicle.primaryImageUrl ? (
                      <img
                        alt={assignment.vehicle.title}
                        className="h-full w-full object-cover"
                        src={sanitizeHttpUrl(assignment.vehicle.primaryImageUrl) ?? ""}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">
                        No image
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold text-[var(--foreground)]">
                        {assignment.vehicle.title}
                      </p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(assignment.status)}`}>
                        {assignment.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--muted)]">
                      <span>{formatCurrency(assignment.vehicle.price)}</span>
                      <span>
                        {assignment.vehicle.mileage
                          ? `${formatNumber(assignment.vehicle.mileage)} miles`
                          : "Mileage pending"}
                      </span>
                      <span>{assignment.vehicle.stockNumber || "No stock number"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-[var(--muted)]">
                      <span>Last status: {formatDateLabel(assignment.lastStatusAt)}</span>
                      <span>Posted: {formatDateLabel(assignment.postedAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                        href={sanitizeHttpUrl(assignment.vehicle.detailPageUrl) ?? "#"}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open source listing
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {assignment.listingUrl ? (
                        <a
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)]"
                          href={sanitizeHttpUrl(assignment.listingUrl) ?? "#"}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open tracked post
                          <Route className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                {assignment.listingReference || assignment.notes ? (
                  <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.78)] px-4 py-3 text-sm text-[var(--muted)] xl:max-w-sm">
                    {assignment.listingReference ? <p>Reference: {assignment.listingReference}</p> : null}
                    {assignment.notes ? <p className="mt-1">{assignment.notes}</p> : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {assignment.tasks.length ? (
                  assignment.tasks.map((task) => {
                    const isOpen = task.status === "OPEN" || task.status === "IN_PROGRESS";

                    return (
                      <div
                        className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] px-4 py-4"
                        key={task.id}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-[var(--foreground)]">{task.title}</p>
                              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(task.status)}`}>
                                {task.status}
                              </span>
                              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${badgeClass(task.taskType)}`}>
                                {task.taskType}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                              {task.description || "No task notes were saved."}
                            </p>
                            <p className="mt-2 text-xs text-[var(--muted)]">
                              Updated {formatDateLabel(task.updatedAt)}
                            </p>
                          </div>

                          {isOpen ? (
                            <div className="flex flex-wrap gap-2">
                              {task.status === "OPEN" ? (
                                <button
                                  className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={busyTaskId === task.id || isPending}
                                  onClick={() => updateTask(task.id, task.taskType, "start")}
                                  type="button"
                                >
                                  {busyTaskId === task.id ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3.5 w-3.5" />
                                  )}
                                  Start
                                </button>
                              ) : null}
                              <button
                                className="inline-flex items-center gap-2 rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={busyTaskId === task.id || isPending}
                                onClick={() => updateTask(task.id, task.taskType, "markComplete")}
                                type="button"
                              >
                                {busyTaskId === task.id ? (
                                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <PackageCheck className="h-3.5 w-3.5" />
                                )}
                                {taskButtonLabel(task.taskType)}
                              </button>
                              <button
                                className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:border-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={busyTaskId === task.id || isPending}
                                onClick={() => updateTask(task.id, task.taskType, "dismiss")}
                                type="button"
                              >
                                Dismiss
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,242,235,0.76)] px-4 py-4 text-sm text-[var(--muted)]">
                    No tasks are currently attached to this vehicle assignment.
                  </div>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-[22px] border border-[var(--line)] bg-white/82 px-4 py-5 text-sm text-[var(--muted)]">
            No vehicles have been assigned to your employee bucket yet.
          </div>
        )}
      </div>
    </section>
  );
}
