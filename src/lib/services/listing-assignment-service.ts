import { hash } from "bcryptjs";
import {
  ListingAssignmentStatus,
  ListingTaskStatus,
  ListingTaskType,
  PlatformRole,
  Prisma,
  UserRole,
  UserStatus,
  VehicleLifecycleStatus,
} from "@prisma/client";

import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function canManageAllListingTasks(role: UserRole) {
  return role === UserRole.OWNER || role === UserRole.ADMIN || role === UserRole.MANAGER;
}

function buildVehicleDisplayName(vehicle: {
  make: string | null;
  model: string | null;
  title: string | null;
  trim: string | null;
  year: number | null;
}) {
  return (
    vehicle.title ||
    [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ").trim() ||
    "Vehicle"
  );
}

function buildTaskTitle(taskType: ListingTaskType, vehicleTitle: string) {
  switch (taskType) {
    case ListingTaskType.UPDATE_POST:
      return `Update Marketplace listing for ${vehicleTitle}`;
    case ListingTaskType.MARK_SOLD:
      return `Mark ${vehicleTitle} as sold or remove listing`;
    default:
      return `Post ${vehicleTitle} to Marketplace`;
  }
}

function buildTaskDescription(input: {
  detailPageUrl: string;
  price: number | null;
  stockNumber: string | null;
  taskType: ListingTaskType;
  vehicleTitle: string;
}) {
  const summary = [
    input.vehicleTitle,
    input.price ? `Price ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(input.price)}` : null,
    input.stockNumber ? `Stock ${input.stockNumber}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  if (input.taskType === ListingTaskType.MARK_SOLD) {
    return `${summary}. This vehicle changed status in The Book and should be marked sold, removed, or archived in the employee-managed Marketplace workflow. Source listing: ${input.detailPageUrl}`;
  }

  if (input.taskType === ListingTaskType.UPDATE_POST) {
    return `${summary}. Inventory details changed and the Marketplace listing should be updated. Source listing: ${input.detailPageUrl}`;
  }

  return `${summary}. This vehicle is ready for the employee Marketplace workflow. Source listing: ${input.detailPageUrl}`;
}

async function getEligibleListingMemberships(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  return tx.tenantMembership.findMany({
    where: {
      listingEnabled: true,
      tenantId,
      user: {
        status: UserStatus.ACTIVE,
      },
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
          name: true,
        },
      },
    },
    orderBy: [
      {
        listingOrder: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  });
}

async function createAssignmentTask(
  tx: Prisma.TransactionClient,
  input: {
    assignmentId: string;
    assigneeMembershipId: string;
    description: string;
    taskType: ListingTaskType;
    tenantId: string;
    title: string;
    vehicleId: string;
  },
) {
  return tx.listingTask.create({
    data: {
      assigneeMembershipId: input.assigneeMembershipId,
      assignmentId: input.assignmentId,
      description: input.description,
      payload: asJson({
        taskType: input.taskType,
        vehicleId: input.vehicleId,
      }),
      taskType: input.taskType,
      tenantId: input.tenantId,
      title: input.title,
      vehicleId: input.vehicleId,
    },
  });
}

export async function getTenantListingAutomationData(tenantId: string) {
  const [memberships, assignments, openTasks, vehicleCounts] = await Promise.all([
    prisma.tenantMembership.findMany({
      where: {
        tenantId,
      },
      include: {
        user: {
          select: {
            email: true,
            id: true,
            name: true,
            status: true,
          },
        },
      },
      orderBy: [
        {
          listingOrder: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    }),
    prisma.listingAssignment.findMany({
      where: {
        tenantId,
      },
      select: {
        assigneeMembershipId: true,
        status: true,
      },
    }),
    prisma.listingTask.findMany({
      where: {
        status: {
          in: [ListingTaskStatus.OPEN, ListingTaskStatus.IN_PROGRESS],
        },
        tenantId,
      },
      select: {
        assigneeMembershipId: true,
        status: true,
        taskType: true,
      },
    }),
    prisma.vehicle.findMany({
      where: {
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
        tenantId,
      },
      select: {
        id: true,
        listingAssignment: {
          select: {
            id: true,
          },
        },
      },
    }),
  ]);

  const countsByMembership = new Map<
    string,
    {
      assignedCount: number;
      needsUpdateCount: number;
      openTaskCount: number;
      postedCount: number;
      readyToPostCount: number;
      soldActionCount: number;
    }
  >();

  for (const assignment of assignments) {
    const current = countsByMembership.get(assignment.assigneeMembershipId) ?? {
      assignedCount: 0,
      needsUpdateCount: 0,
      openTaskCount: 0,
      postedCount: 0,
      readyToPostCount: 0,
      soldActionCount: 0,
    };

    current.assignedCount += 1;

    if (assignment.status === ListingAssignmentStatus.POSTED) {
      current.postedCount += 1;
    }

    if (assignment.status === ListingAssignmentStatus.READY_TO_POST) {
      current.readyToPostCount += 1;
    }

    if (assignment.status === ListingAssignmentStatus.NEEDS_UPDATE) {
      current.needsUpdateCount += 1;
    }

    if (assignment.status === ListingAssignmentStatus.SOLD_ACTION_REQUIRED) {
      current.soldActionCount += 1;
    }

    countsByMembership.set(assignment.assigneeMembershipId, current);
  }

  for (const task of openTasks) {
    const current = countsByMembership.get(task.assigneeMembershipId) ?? {
      assignedCount: 0,
      needsUpdateCount: 0,
      openTaskCount: 0,
      postedCount: 0,
      readyToPostCount: 0,
      soldActionCount: 0,
    };
    current.openTaskCount += 1;
    countsByMembership.set(task.assigneeMembershipId, current);
  }

  const roster = memberships.map((membership) => {
    const counts = countsByMembership.get(membership.id) ?? {
      assignedCount: 0,
      needsUpdateCount: 0,
      openTaskCount: 0,
      postedCount: 0,
      readyToPostCount: 0,
      soldActionCount: 0,
    };

    return {
      assignedCount: counts.assignedCount,
      email: membership.user.email,
      id: membership.id,
      listingEnabled: membership.listingEnabled,
      listingOrder: membership.listingOrder,
      name: membership.user.name,
      needsUpdateCount: counts.needsUpdateCount,
      openTaskCount: counts.openTaskCount,
      postedCount: counts.postedCount,
      readyToPostCount: counts.readyToPostCount,
      role: membership.role,
      soldActionCount: counts.soldActionCount,
      status: membership.user.status,
      userId: membership.user.id,
    };
  });

  const unassignedCount = vehicleCounts.filter((vehicle) => !vehicle.listingAssignment).length;
  const assignedCount = assignments.filter(
    (assignment) => assignment.status !== ListingAssignmentStatus.ARCHIVED,
  ).length;

  return {
    roster,
    stats: {
      assigned: assignedCount,
      needsUpdate: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.NEEDS_UPDATE).length,
      openTasks: openTasks.length,
      posted: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.POSTED).length,
      readyToPost: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.READY_TO_POST).length,
      soldActionRequired: assignments.filter(
        (assignment) => assignment.status === ListingAssignmentStatus.SOLD_ACTION_REQUIRED,
      ).length,
      unassigned: unassignedCount,
    },
  };
}

export async function createTenantEmployee(input: {
  createdById: string;
  email: string;
  listingEnabled?: boolean;
  listingOrder?: number;
  name: string;
  password: string;
  role: UserRole;
  tenantId: string;
}) {
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
    select: {
      id: true,
    },
  });

  if (existingUser) {
    throw new Error("An account with that email already exists.");
  }

  const passwordHash = await hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        passwordHash,
        platformRole: PlatformRole.USER,
        status: UserStatus.ACTIVE,
      },
    });

    const membership = await tx.tenantMembership.create({
      data: {
        isDefault: true,
        listingEnabled: input.listingEnabled ?? true,
        listingOrder: input.listingOrder ?? 0,
        role: input.role,
        tenantId: input.tenantId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            email: true,
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    await createAuditLog({
      action: "tenant.employee.created",
      actorId: input.createdById,
      entityId: membership.id,
      entityType: "TenantMembership",
      metadata: asJson({
        email: user.email,
        listingEnabled: membership.listingEnabled,
        listingOrder: membership.listingOrder,
        role: membership.role,
      }),
      summary: `Added ${user.name || user.email} to the dealership roster.`,
      tenantId: input.tenantId,
    });

    return membership;
  });
}

export async function updateTenantEmployeeSettings(input: {
  actorId: string;
  tenantId: string;
  updates: Array<{
    listingEnabled: boolean;
    listingOrder: number;
    membershipId: string;
    role?: UserRole;
  }>;
}) {
  if (!input.updates.length) {
    return { updatedCount: 0 };
  }

  await prisma.$transaction(
    input.updates.map((update) =>
      prisma.tenantMembership.updateMany({
        where: {
          id: update.membershipId,
          tenantId: input.tenantId,
        },
        data: {
          listingEnabled: update.listingEnabled,
          listingOrder: update.listingOrder,
          ...(update.role ? { role: update.role } : {}),
        },
      }),
    ),
  );

  await createAuditLog({
    action: "tenant.employee.settings.updated",
    actorId: input.actorId,
    entityId: input.updates.map((update) => update.membershipId).join(","),
    entityType: "TenantMembership",
    metadata: asJson({
      updates: input.updates,
    }),
    summary: `Updated ${input.updates.length} employee listing settings.`,
    tenantId: input.tenantId,
  });

  return {
    updatedCount: input.updates.length,
  };
}

export async function assignVehiclesRoundRobin(input: {
  createdById?: string | null;
  tenantId: string;
  vehicleIds: string[];
}) {
  if (!input.vehicleIds.length) {
    return {
      assigned: 0,
      skipped: 0,
    };
  }

  return prisma.$transaction(async (tx) => {
    const eligibleMemberships = await getEligibleListingMemberships(tx, input.tenantId);

    if (!eligibleMemberships.length) {
      throw new Error("Enable at least one employee in the listing order before assigning vehicles.");
    }

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: {
        id: input.tenantId,
      },
      select: {
        postingRotationCursor: true,
      },
    });

    const vehicles = await tx.vehicle.findMany({
      where: {
        id: {
          in: input.vehicleIds,
        },
        isArchived: false,
        lifecycleStatus: VehicleLifecycleStatus.ACTIVE,
        tenantId: input.tenantId,
      },
      include: {
        listingAssignment: {
          select: {
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    let cursor = tenant.postingRotationCursor;
    let assigned = 0;
    let skipped = 0;

    for (const vehicle of vehicles) {
      if (vehicle.listingAssignment) {
        skipped += 1;
        continue;
      }

      const assigneeMembership = eligibleMemberships[cursor % eligibleMemberships.length];
      cursor += 1;
      const vehicleTitle = buildVehicleDisplayName(vehicle);

      const assignment = await tx.listingAssignment.create({
        data: {
          assignedById: input.createdById ?? undefined,
          assigneeMembershipId: assigneeMembership.id,
          assignmentOrderSnapshot: assigneeMembership.listingOrder,
          assignmentSequence: cursor,
          lastStatusAt: new Date(),
          lastTaskAt: new Date(),
          status: ListingAssignmentStatus.READY_TO_POST,
          tenantId: input.tenantId,
          vehicleId: vehicle.id,
        },
      });

      await createAssignmentTask(tx, {
        assignmentId: assignment.id,
        assigneeMembershipId: assigneeMembership.id,
        description: buildTaskDescription({
          detailPageUrl: vehicle.detailPageUrl,
          price: vehicle.price,
          stockNumber: vehicle.stockNumber,
          taskType: ListingTaskType.INITIAL_POST,
          vehicleTitle,
        }),
        taskType: ListingTaskType.INITIAL_POST,
        tenantId: input.tenantId,
        title: buildTaskTitle(ListingTaskType.INITIAL_POST, vehicleTitle),
        vehicleId: vehicle.id,
      });

      await tx.conversation.updateMany({
        where: {
          OR: [
            {
              assignedToId: null,
            },
            {
              assignedToId: assigneeMembership.userId,
            },
          ],
          tenantId: input.tenantId,
          vehicleId: vehicle.id,
        },
        data: {
          assignedToId: assigneeMembership.userId,
        },
      });

      assigned += 1;
    }

    await tx.tenant.update({
      where: {
        id: input.tenantId,
      },
      data: {
        postingRotationCursor: cursor,
      },
    });

    if (assigned) {
      await createAuditLog({
        action: "listing.assignment.round_robin",
        actorId: input.createdById ?? undefined,
        entityId: input.vehicleIds.join(","),
        entityType: "Vehicle",
        metadata: asJson({
          assigned,
          skipped,
        }),
        summary: `Assigned ${assigned} vehicle(s) into the employee listing rotation.`,
        tenantId: input.tenantId,
      });
    }

    return {
      assigned,
      skipped,
    };
  });
}

export async function queueListingUpdatesForVehicles(input: {
  createdById?: string | null;
  tenantId: string;
  vehicleIds: string[];
}) {
  if (!input.vehicleIds.length) {
    return { queued: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const assignments = await tx.listingAssignment.findMany({
      where: {
        status: {
          in: [
            ListingAssignmentStatus.POSTED,
            ListingAssignmentStatus.NEEDS_UPDATE,
            ListingAssignmentStatus.READY_TO_POST,
          ],
        },
        tenantId: input.tenantId,
        vehicleId: {
          in: input.vehicleIds,
        },
      },
      include: {
        tasks: {
          where: {
            status: {
              in: [ListingTaskStatus.OPEN, ListingTaskStatus.IN_PROGRESS],
            },
            taskType: {
              in: [ListingTaskType.INITIAL_POST, ListingTaskType.UPDATE_POST],
            },
          },
          select: {
            id: true,
            taskType: true,
          },
        },
        vehicle: true,
      },
    });

    let queued = 0;

    for (const assignment of assignments) {
      if (assignment.status === ListingAssignmentStatus.READY_TO_POST) {
        continue;
      }

      if (assignment.tasks.some((task) => task.taskType === ListingTaskType.UPDATE_POST)) {
        continue;
      }

      const vehicleTitle = buildVehicleDisplayName(assignment.vehicle);

      await tx.listingAssignment.update({
        where: {
          id: assignment.id,
        },
        data: {
          lastStatusAt: new Date(),
          lastTaskAt: new Date(),
          status: ListingAssignmentStatus.NEEDS_UPDATE,
        },
      });

      await createAssignmentTask(tx, {
        assignmentId: assignment.id,
        assigneeMembershipId: assignment.assigneeMembershipId,
        description: buildTaskDescription({
          detailPageUrl: assignment.vehicle.detailPageUrl,
          price: assignment.vehicle.price,
          stockNumber: assignment.vehicle.stockNumber,
          taskType: ListingTaskType.UPDATE_POST,
          vehicleTitle,
        }),
        taskType: ListingTaskType.UPDATE_POST,
        tenantId: input.tenantId,
        title: buildTaskTitle(ListingTaskType.UPDATE_POST, vehicleTitle),
        vehicleId: assignment.vehicleId,
      });

      queued += 1;
    }

    if (queued) {
      await createAuditLog({
        action: "listing.task.update.queued",
        actorId: input.createdById ?? undefined,
        entityId: input.vehicleIds.join(","),
        entityType: "Vehicle",
        metadata: asJson({
          queued,
          vehicleIds: input.vehicleIds,
        }),
        summary: `Queued ${queued} Marketplace update task(s).`,
        tenantId: input.tenantId,
      });
    }

    return { queued };
  });
}

export async function queueListingSoldTasksForVehicles(input: {
  createdById?: string | null;
  tenantId: string;
  vehicleIds: string[];
}) {
  if (!input.vehicleIds.length) {
    return { queued: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const assignments = await tx.listingAssignment.findMany({
      where: {
        status: {
          not: ListingAssignmentStatus.ARCHIVED,
        },
        tenantId: input.tenantId,
        vehicleId: {
          in: input.vehicleIds,
        },
      },
      include: {
        tasks: {
          where: {
            status: {
              in: [ListingTaskStatus.OPEN, ListingTaskStatus.IN_PROGRESS],
            },
            taskType: ListingTaskType.MARK_SOLD,
          },
          select: {
            id: true,
          },
        },
        vehicle: true,
      },
    });

    let queued = 0;

    for (const assignment of assignments) {
      if (assignment.tasks.length) {
        continue;
      }

      const vehicleTitle = buildVehicleDisplayName(assignment.vehicle);

      await tx.listingAssignment.update({
        where: {
          id: assignment.id,
        },
        data: {
          lastStatusAt: new Date(),
          lastTaskAt: new Date(),
          status: ListingAssignmentStatus.SOLD_ACTION_REQUIRED,
        },
      });

      await createAssignmentTask(tx, {
        assignmentId: assignment.id,
        assigneeMembershipId: assignment.assigneeMembershipId,
        description: buildTaskDescription({
          detailPageUrl: assignment.vehicle.detailPageUrl,
          price: assignment.vehicle.price,
          stockNumber: assignment.vehicle.stockNumber,
          taskType: ListingTaskType.MARK_SOLD,
          vehicleTitle,
        }),
        taskType: ListingTaskType.MARK_SOLD,
        tenantId: input.tenantId,
        title: buildTaskTitle(ListingTaskType.MARK_SOLD, vehicleTitle),
        vehicleId: assignment.vehicleId,
      });

      queued += 1;
    }

    if (queued) {
      await createAuditLog({
        action: "listing.task.sold.queued",
        actorId: input.createdById ?? undefined,
        entityId: input.vehicleIds.join(","),
        entityType: "Vehicle",
        metadata: asJson({
          queued,
          vehicleIds: input.vehicleIds,
        }),
        summary: `Queued ${queued} sold/archive Marketplace task(s).`,
        tenantId: input.tenantId,
      });
    }

    return { queued };
  });
}

export async function getEmployeeListingBucketData(input: {
  tenantId: string;
  userId: string;
}) {
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: input.tenantId,
      userId: input.userId,
    },
    include: {
      user: {
        select: {
          email: true,
          id: true,
          name: true,
        },
      },
    },
  });

  if (!membership) {
    return {
      membership: null,
      stats: {
        needsUpdate: 0,
        openTasks: 0,
        posted: 0,
        readyToPost: 0,
        soldActionRequired: 0,
      },
      vehicles: [],
    };
  }

  const assignments = await prisma.listingAssignment.findMany({
    where: {
      assigneeMembershipId: membership.id,
      tenantId: input.tenantId,
    },
    include: {
      tasks: {
        orderBy: [
          {
            status: "asc",
          },
          {
            createdAt: "desc",
          },
        ],
      },
      vehicle: {
        select: {
          detailPageUrl: true,
          id: true,
          make: true,
          mileage: true,
          model: true,
          price: true,
          primaryImageUrl: true,
          sourceUrl: true,
          stockNumber: true,
          title: true,
          trim: true,
          year: true,
        },
      },
    },
    orderBy: [
      {
        lastTaskAt: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });

  return {
    membership: {
      id: membership.id,
      listingEnabled: membership.listingEnabled,
      listingOrder: membership.listingOrder,
      role: membership.role,
      user: membership.user,
    },
    stats: {
      needsUpdate: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.NEEDS_UPDATE).length,
      openTasks: assignments.reduce(
        (count, assignment) =>
          count +
          assignment.tasks.filter(
            (task) =>
              task.status === ListingTaskStatus.OPEN ||
              task.status === ListingTaskStatus.IN_PROGRESS,
          ).length,
        0,
      ),
      posted: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.POSTED).length,
      readyToPost: assignments.filter((assignment) => assignment.status === ListingAssignmentStatus.READY_TO_POST).length,
      soldActionRequired: assignments.filter(
        (assignment) => assignment.status === ListingAssignmentStatus.SOLD_ACTION_REQUIRED,
      ).length,
    },
    vehicles: assignments.map((assignment) => ({
      id: assignment.id,
      lastStatusAt: assignment.lastStatusAt?.toISOString() ?? null,
      listingReference: assignment.listingReference,
      listingUrl: assignment.listingUrl,
      notes: assignment.notes,
      postedAt: assignment.postedAt?.toISOString() ?? null,
      status: assignment.status,
      vehicle: {
        detailPageUrl: assignment.vehicle.detailPageUrl,
        id: assignment.vehicle.id,
        mileage: assignment.vehicle.mileage,
        price: assignment.vehicle.price,
        primaryImageUrl: assignment.vehicle.primaryImageUrl,
        sourceUrl: assignment.vehicle.sourceUrl,
        stockNumber: assignment.vehicle.stockNumber,
        title: buildVehicleDisplayName(assignment.vehicle),
      },
      tasks: assignment.tasks.map((task) => ({
        completedAt: task.completedAt?.toISOString() ?? null,
        description: task.description,
        id: task.id,
        status: task.status,
        taskType: task.taskType,
        title: task.title,
        updatedAt: task.updatedAt.toISOString(),
      })),
    })),
  };
}

export async function updateListingTaskStatus(input: {
  action: "dismiss" | "markComplete" | "start";
  actorRole: UserRole;
  actorUserId: string;
  externalListingUrl?: string | null;
  listingReference?: string | null;
  taskId: string;
  tenantId: string;
}) {
  const task = await prisma.listingTask.findUnique({
    where: {
      id: input.taskId,
    },
    include: {
      assignment: {
        include: {
          assigneeMembership: {
            select: {
              userId: true,
            },
          },
          vehicle: {
            select: {
              id: true,
              make: true,
              model: true,
              title: true,
              trim: true,
              year: true,
            },
          },
        },
      },
    },
  });

  if (!task || task.tenantId !== input.tenantId) {
    throw new Error("Listing task not found.");
  }

  if (
    !canManageAllListingTasks(input.actorRole) &&
    task.assignment.assigneeMembership.userId !== input.actorUserId
  ) {
    throw new Error("You do not have permission to update that listing task.");
  }

  const now = new Date();
  let nextTaskStatus = task.status;
  let nextAssignmentStatus = task.assignment.status;
  const assignmentUpdate: Prisma.ListingAssignmentUpdateInput = {
    lastTaskAt: now,
    notes: task.assignment.notes ?? undefined,
  };

  if (input.action === "start") {
    nextTaskStatus = ListingTaskStatus.IN_PROGRESS;
  } else if (input.action === "dismiss") {
    nextTaskStatus = ListingTaskStatus.DISMISSED;
    assignmentUpdate.lastStatusAt = now;
  } else {
    nextTaskStatus = ListingTaskStatus.COMPLETED;
    assignmentUpdate.lastStatusAt = now;

    if (task.taskType === ListingTaskType.MARK_SOLD) {
      nextAssignmentStatus = ListingAssignmentStatus.ARCHIVED;
    } else {
      nextAssignmentStatus = ListingAssignmentStatus.POSTED;
      assignmentUpdate.postedAt = task.assignment.postedAt ?? now;
    }

    if (input.externalListingUrl) {
      assignmentUpdate.listingUrl = input.externalListingUrl;
    }

    if (input.listingReference) {
      assignmentUpdate.listingReference = input.listingReference;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedTask = await tx.listingTask.update({
      where: {
        id: task.id,
      },
      data: {
        completedAt: nextTaskStatus === ListingTaskStatus.COMPLETED ? now : null,
        resolvedById:
          nextTaskStatus === ListingTaskStatus.COMPLETED ||
          nextTaskStatus === ListingTaskStatus.DISMISSED
            ? input.actorUserId
            : null,
        status: nextTaskStatus,
      },
    });

    const updatedAssignment = await tx.listingAssignment.update({
      where: {
        id: task.assignment.id,
      },
      data: {
        ...assignmentUpdate,
        status: nextAssignmentStatus,
      },
    });

    if (updatedAssignment.status === ListingAssignmentStatus.ARCHIVED) {
      await tx.vehicle.update({
        where: {
          id: updatedAssignment.vehicleId,
        },
        data: {
          archivedAt: now,
          isArchived: true,
          lifecycleStatus: VehicleLifecycleStatus.ARCHIVED,
          removedAt: now,
        },
      });
    }

    return {
      assignment: updatedAssignment,
      task: updatedTask,
    };
  });

  await createAuditLog({
    action: "listing.task.updated",
    actorId: input.actorUserId,
    entityId: task.id,
    entityType: "ListingTask",
    metadata: asJson({
      action: input.action,
      assignmentStatus: nextAssignmentStatus,
      taskStatus: nextTaskStatus,
    }),
    summary: `${buildVehicleDisplayName(task.assignment.vehicle)} listing task was updated.`,
    tenantId: input.tenantId,
  });

  return updated;
}

export async function getAssignedUserIdForVehicle(input: {
  tenantId: string;
  vehicleId: string;
}) {
  const assignment = await prisma.listingAssignment.findFirst({
    where: {
      status: {
        in: [
          ListingAssignmentStatus.READY_TO_POST,
          ListingAssignmentStatus.POSTED,
          ListingAssignmentStatus.NEEDS_UPDATE,
          ListingAssignmentStatus.SOLD_ACTION_REQUIRED,
        ],
      },
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
    },
    include: {
      assigneeMembership: {
        select: {
          userId: true,
        },
      },
    },
  });

  return assignment?.assigneeMembership.userId ?? null;
}
