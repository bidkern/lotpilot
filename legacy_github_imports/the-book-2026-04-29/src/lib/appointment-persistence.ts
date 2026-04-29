import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getSalesFloorState } from "@/lib/sales-floor-persistence";
import type { SalesAppointmentRecord, SalesDealRecord } from "@/lib/types";

const DATA_DIRECTORY = path.join(process.cwd(), "runtime-data");
const DATA_FILE = path.join(DATA_DIRECTORY, "appointments.json");
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

interface AppointmentDocument {
  version: 1;
  appointments: SalesAppointmentRecord[];
  updatedAt: string;
}

function createDefaultDocument(): AppointmentDocument {
  return {
    version: 1,
    appointments: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document: Partial<AppointmentDocument> | null) {
  const baseDocument = createDefaultDocument();

  if (!document || typeof document !== "object") {
    return baseDocument;
  }

  return {
    version: 1 as const,
    appointments: Array.isArray(document.appointments)
      ? document.appointments
      : [],
    updatedAt: document.updatedAt ?? baseDocument.updatedAt,
  };
}

async function ensureDocumentFile() {
  await mkdir(DATA_DIRECTORY, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf8");
  } catch {
    await writeFile(DATA_FILE, JSON.stringify(createDefaultDocument(), null, 2), "utf8");
  }
}

async function readDocument() {
  await ensureDocumentFile();

  try {
    const rawDocument = await readFile(DATA_FILE, "utf8");
    return normalizeDocument(
      JSON.parse(rawDocument) as Partial<AppointmentDocument>,
    );
  } catch {
    const fallbackDocument = createDefaultDocument();
    await writeDocument(fallbackDocument);
    return fallbackDocument;
  }
}

async function writeDocument(document: AppointmentDocument) {
  const normalizedDocument = normalizeDocument({
    ...document,
    updatedAt: new Date().toISOString(),
  });

  await ensureDocumentFile();
  await writeFile(DATA_FILE, JSON.stringify(normalizedDocument, null, 2), "utf8");

  return normalizedDocument;
}

let documentQueue = Promise.resolve();

async function withDocumentLock<T>(
  callback: (document: AppointmentDocument) => Promise<T> | T,
) {
  const run = documentQueue.then(async () => {
    const document = await readDocument();
    return callback(document);
  });

  documentQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

function parseTimeSegment(input: string) {
  const matchedTime = input.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);

  if (!matchedTime) {
    return { hours: 10, minutes: 0 };
  }

  const hours12 = Number.parseInt(matchedTime[1] || "10", 10);
  const minutes = Number.parseInt(matchedTime[2] || "0", 10);
  const meridian = (matchedTime[3] || "AM").toUpperCase();
  const hours =
    meridian === "PM" && hours12 !== 12
      ? hours12 + 12
      : meridian === "AM" && hours12 === 12
        ? 0
        : hours12;

  return { hours, minutes };
}

function nextWeekdayDate(baseDate: Date, weekdayIndex: number) {
  const targetDate = new Date(baseDate);
  const currentWeekday = targetDate.getDay();
  let delta = weekdayIndex - currentWeekday;

  if (delta <= 0) {
    delta += 7;
  }

  targetDate.setDate(targetDate.getDate() + delta);
  return targetDate;
}

export function resolveAppointmentWindowLabel(
  windowLabel: string | undefined,
  baseDate = new Date(),
) {
  const normalizedLabel =
    windowLabel?.split(" or ")[0]?.trim() || "Tomorrow at 10:00 AM";
  const lowerLabel = normalizedLabel.toLowerCase();
  const { hours, minutes } = parseTimeSegment(normalizedLabel);
  let scheduledDate = new Date(baseDate);

  if (lowerLabel.startsWith("tomorrow")) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  } else {
    const weekdayMatch = Object.entries(WEEKDAY_INDEX).find(([label]) =>
      lowerLabel.startsWith(label),
    );

    if (weekdayMatch) {
      scheduledDate = nextWeekdayDate(scheduledDate, weekdayMatch[1]);
    } else if (lowerLabel.startsWith("today")) {
      if (
        hours < scheduledDate.getHours() ||
        (hours === scheduledDate.getHours() && minutes <= scheduledDate.getMinutes())
      ) {
        scheduledDate.setDate(scheduledDate.getDate() + 1);
      }
    } else {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    }
  }

  scheduledDate.setHours(hours, minutes, 0, 0);

  return {
    windowLabel: normalizedLabel,
    scheduledAt: scheduledDate.toISOString(),
    endsAt: new Date(scheduledDate.getTime() + 75 * 60 * 1000).toISOString(),
  };
}

export async function upsertAppointmentForDeal(input: {
  tenantId: string;
  deal: SalesDealRecord;
  customerName: string;
  vehicleLabel: string;
  windowLabel?: string;
  confirmed?: boolean;
}) {
  return withDocumentLock(async (document) => {
    const resolvedWindow = resolveAppointmentWindowLabel(
      input.windowLabel || input.deal.appointmentWindow,
    );
    const now = new Date().toISOString();
    const existingAppointment = document.appointments.find(
      (appointment) =>
        appointment.tenantId === input.tenantId &&
        appointment.dealId === input.deal.id &&
        !["COMPLETED", "NO_SHOW", "CANCELED"].includes(appointment.status),
    );

    const status = input.confirmed ? "CONFIRMED" : "BOOKED";
    const nextAppointment: SalesAppointmentRecord = existingAppointment
      ? {
          ...existingAppointment,
          customerName: input.customerName,
          vehicleLabel: input.vehicleLabel,
          windowLabel: resolvedWindow.windowLabel,
          scheduledAt: resolvedWindow.scheduledAt,
          endsAt: resolvedWindow.endsAt,
          status,
          confirmedAt: input.confirmed ? now : existingAppointment.confirmedAt,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          tenantId: input.tenantId,
          dealId: input.deal.id,
          conversationId: input.deal.conversationId,
          customerName: input.customerName,
          vehicleLabel: input.vehicleLabel,
          windowLabel: resolvedWindow.windowLabel,
          scheduledAt: resolvedWindow.scheduledAt,
          endsAt: resolvedWindow.endsAt,
          status,
          confirmedAt: input.confirmed ? now : undefined,
          createdAt: now,
          updatedAt: now,
        };

    document.appointments = [
      ...document.appointments.filter(
        (appointment) => appointment.id !== existingAppointment?.id,
      ),
      nextAppointment,
    ];

    await writeDocument(document);
    return nextAppointment;
  });
}

export async function markAppointmentConfirmationSent(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.appointments = document.appointments.map((appointment) => {
      if (appointment.tenantId !== tenantId || appointment.dealId !== dealId) {
        return appointment;
      }

      return {
        ...appointment,
        confirmationSentAt: now,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

export async function markAppointmentConfirmed(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.appointments = document.appointments.map((appointment) => {
      if (appointment.tenantId !== tenantId || appointment.dealId !== dealId) {
        return appointment;
      }

      return {
        ...appointment,
        status: "CONFIRMED" as const,
        confirmedAt: now,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

export async function markAppointmentCompleted(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.appointments = document.appointments.map((appointment) => {
      if (appointment.tenantId !== tenantId || appointment.dealId !== dealId) {
        return appointment;
      }

      return {
        ...appointment,
        status: "COMPLETED" as const,
        completedAt: now,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

export async function markAppointmentNoShow(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.appointments = document.appointments.map((appointment) => {
      if (appointment.tenantId !== tenantId || appointment.dealId !== dealId) {
        return appointment;
      }

      return {
        ...appointment,
        status: "NO_SHOW" as const,
        noShowRecordedAt: now,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

export async function cancelAppointmentForDeal(
  tenantId: string,
  dealId: string,
) {
  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();

    document.appointments = document.appointments.map((appointment) => {
      if (appointment.tenantId !== tenantId || appointment.dealId !== dealId) {
        return appointment;
      }

      return {
        ...appointment,
        status: "CANCELED" as const,
        updatedAt: now,
      };
    });

    await writeDocument(document);
  });
}

async function backfillBookedAppointmentsForTenant(tenantId: string) {
  const salesFloor = await getSalesFloorState(tenantId);

  return withDocumentLock(async (document) => {
    const now = new Date().toISOString();
    let changed = false;

    for (const deal of salesFloor.deals) {
      if (deal.appointmentStatus !== "BOOKED") {
        continue;
      }

      const existingAppointment = document.appointments.find(
        (appointment) =>
          appointment.tenantId === tenantId &&
          appointment.dealId === deal.id &&
          !["COMPLETED", "NO_SHOW", "CANCELED"].includes(appointment.status),
      );

      if (existingAppointment) {
        continue;
      }

      const resolvedWindow = resolveAppointmentWindowLabel(deal.appointmentWindow);
      document.appointments = [
        ...document.appointments,
        {
          id: randomUUID(),
          tenantId,
          dealId: deal.id,
          conversationId: deal.conversationId,
          customerName: deal.customerName,
          vehicleLabel: deal.vehicleLabel,
          windowLabel: resolvedWindow.windowLabel,
          scheduledAt: resolvedWindow.scheduledAt,
          endsAt: resolvedWindow.endsAt,
          status: "BOOKED",
          createdAt: now,
          updatedAt: now,
        },
      ];
      changed = true;
    }

    if (changed) {
      await writeDocument(document);
    }
  });
}

export async function getAppointmentSnapshot(tenantId: string) {
  await backfillBookedAppointmentsForTenant(tenantId);

  return withDocumentLock(async (document) => {
    return document.appointments
      .filter((appointment) => appointment.tenantId === tenantId)
      .sort(
        (left, right) =>
          Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt),
      );
  });
}

export async function getActiveAppointmentForDeal(
  tenantId: string,
  dealId: string,
) {
  const appointments = await getAppointmentSnapshot(tenantId);

  return appointments.find(
    (appointment) =>
      appointment.dealId === dealId &&
      !["COMPLETED", "NO_SHOW", "CANCELED"].includes(appointment.status),
  );
}

export async function resetAppointmentsTenant(tenantId: string) {
  return withDocumentLock(async (document) => {
    document.appointments = document.appointments.filter(
      (appointment) => appointment.tenantId !== tenantId,
    );

    await writeDocument(document);
  });
}
