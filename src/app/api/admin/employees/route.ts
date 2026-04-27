import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiRole } from "@/lib/request-auth";
import {
  createTenantEmployee,
  updateTenantEmployeeSettings,
} from "@/lib/services/listing-assignment-service";

const employeeRoleSchema = z.enum(["ADMIN", "MANAGER", "AGENT"]);

const createEmployeeSchema = z.object({
  email: z.string().email(),
  listingEnabled: z.boolean().optional(),
  listingOrder: z.number().int().min(0).optional(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(128),
  role: employeeRoleSchema.default("AGENT"),
});

const updateEmployeesSchema = z.object({
  updates: z
    .array(
      z.object({
        listingEnabled: z.boolean(),
        listingOrder: z.number().int().min(0),
        membershipId: z.string().min(1),
        role: employeeRoleSchema.optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = createEmployeeSchema.parse(await request.json());
    const membership = await createTenantEmployee({
      createdById: authResult.user!.id,
      email: payload.email,
      listingEnabled: payload.listingEnabled,
      listingOrder: payload.listingOrder,
      name: payload.name,
      password: payload.password,
      role: payload.role,
      tenantId: authResult.user!.tenantId!,
    });

    return NextResponse.json({
      employee: {
        email: membership.user.email,
        id: membership.id,
        listingEnabled: membership.listingEnabled,
        listingOrder: membership.listingOrder,
        name: membership.user.name,
        role: membership.role,
        status: membership.user.status,
        userId: membership.user.id,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create employee.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const authResult = await requireApiRole([UserRole.MANAGER]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const payload = updateEmployeesSchema.parse(await request.json());
    const result = await updateTenantEmployeeSettings({
      actorId: authResult.user!.id,
      tenantId: authResult.user!.tenantId!,
      updates: payload.updates,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update employee settings.",
      },
      { status: 400 },
    );
  }
}
