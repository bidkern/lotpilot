import type { EmployeeRecord, QueueItemRecord, VehicleRecord } from "@/lib/types";

export interface RotationInput {
  employees: EmployeeRecord[];
  vehicle: VehicleRecord;
  queueItems: QueueItemRecord[];
  activeVehicleListingIds: string[];
  cursorMembershipId?: string;
  overrideMembershipId?: string;
  cooldownMinutes: number;
  maxPendingAssignmentsPerEmployee: number;
  now: string;
}

export interface RotationDecision {
  status: "ASSIGNED" | "BLOCKED";
  employee?: EmployeeRecord;
  reason: string;
  nextCursorMembershipId?: string;
  skippedEmployees: Array<{ employeeId: string; reason: string }>;
  auditSteps: string[];
}

function minutesSince(lastAssignedAt: string | undefined, now: string) {
  if (!lastAssignedAt) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor(
    (new Date(now).getTime() - new Date(lastAssignedAt).getTime()) / 60000,
  );
}

function pendingAssignmentsForEmployee(
  employeeId: string,
  queueItems: QueueItemRecord[],
) {
  return queueItems.filter(
    (item) =>
      item.assignedMembershipId === employeeId &&
      ["PENDING", "READY", "RUNNING", "RETRY_SCHEDULED"].includes(item.status),
  ).length;
}

function evaluateEligibility(
  employee: EmployeeRecord,
  input: RotationInput,
): string | null {
  if (employee.status !== "ACTIVE") {
    return "membership_inactive";
  }

  if (employee.facebookStatus !== "CONNECTED") {
    return "social_connection_unavailable";
  }

  if (employee.assignmentsToday >= employee.dailyListingLimit) {
    return "daily_limit_reached";
  }

  if (
    pendingAssignmentsForEmployee(employee.id, input.queueItems) >=
    input.maxPendingAssignmentsPerEmployee
  ) {
    return "pending_assignment_cap_reached";
  }

  if (minutesSince(employee.lastAssignedAt, input.now) < input.cooldownMinutes) {
    return "cooldown_active";
  }

  return null;
}

export function selectNextAssignment(input: RotationInput): RotationDecision {
  const auditSteps: string[] = [];
  const skippedEmployees: Array<{ employeeId: string; reason: string }> = [];

  if (input.activeVehicleListingIds.includes(input.vehicle.id)) {
    return {
      status: "BLOCKED",
      reason: "vehicle_already_has_active_listing",
      skippedEmployees,
      auditSteps: [
        "Rejected assignment because the vehicle already has an active listing.",
      ],
    };
  }

  const orderedEmployees = [...input.employees].sort(
    (left, right) => left.rotationPosition - right.rotationPosition,
  );

  if (orderedEmployees.length === 0) {
    return {
      status: "BLOCKED",
      reason: "no_employees_in_rotation",
      skippedEmployees,
      auditSteps: ["Rejected assignment because the rotation list is empty."],
    };
  }

  if (input.overrideMembershipId) {
    const overrideEmployee = orderedEmployees.find(
      (employee) => employee.id === input.overrideMembershipId,
    );

    if (!overrideEmployee) {
      return {
        status: "BLOCKED",
        reason: "override_employee_not_found",
        skippedEmployees,
        auditSteps: ["Admin override requested for a missing employee."],
      };
    }

    const overrideReason = evaluateEligibility(overrideEmployee, input);
    if (overrideReason) {
      return {
        status: "BLOCKED",
        reason: overrideReason,
        skippedEmployees: [
          { employeeId: overrideEmployee.id, reason: overrideReason },
        ],
        auditSteps: [
          `Admin override failed because ${overrideEmployee.displayName} is not eligible.`,
        ],
      };
    }

    return {
      status: "ASSIGNED",
      employee: overrideEmployee,
      reason: "admin_override",
      nextCursorMembershipId: overrideEmployee.id,
      skippedEmployees,
      auditSteps: [
        `Admin override assigned ${overrideEmployee.displayName} to ${input.vehicle.stockNumber}.`,
      ],
    };
  }

  const cursorIndex = input.cursorMembershipId
    ? orderedEmployees.findIndex(
        (employee) => employee.id === input.cursorMembershipId,
      )
    : -1;

  for (let offset = 1; offset <= orderedEmployees.length; offset += 1) {
    const employee =
      orderedEmployees[
        (cursorIndex + offset + orderedEmployees.length) %
          orderedEmployees.length
      ];
    const ineligibilityReason = evaluateEligibility(employee, input);

    if (ineligibilityReason) {
      skippedEmployees.push({
        employeeId: employee.id,
        reason: ineligibilityReason,
      });
      auditSteps.push(
        `Skipped ${employee.displayName} because ${ineligibilityReason}.`,
      );
      continue;
    }

    auditSteps.push(
      `Assigned ${employee.displayName} after scanning ${offset} position(s) in the rotation.`,
    );

    return {
      status: "ASSIGNED",
      employee,
      reason: "rotation_success",
      nextCursorMembershipId: employee.id,
      skippedEmployees,
      auditSteps,
    };
  }

  auditSteps.push("No eligible employee remained after checking the full loop.");

  return {
    status: "BLOCKED",
    reason: "no_eligible_employee",
    skippedEmployees,
    auditSteps,
  };
}

export const rotationEdgeCases = [
  "No employees are active under the parent account.",
  "Every connected employee is in cooldown or has hit the daily limit.",
  "The vehicle already has an active listing that has not been archived.",
  "A disconnected employee is manually overridden by an admin.",
  "A requeue happens after a publish failure and must preserve the original assignment trail.",
];

export const rotationPseudocode = [
  "if vehicle already has active listing: block",
  "if admin override exists: validate override employee and assign",
  "order employees by rotation position",
  "start scanning from cursor + 1 and loop once through the list",
  "skip inactive memberships, disconnected accounts, cooldowns, and throttled reps",
  "assign the first eligible employee",
  "persist next cursor, queue draft generation, and append audit logs",
  "if nobody is eligible: create a blocked queue record and notify admin",
];
