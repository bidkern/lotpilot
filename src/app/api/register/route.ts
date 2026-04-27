import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { assertRateLimit, getRequestRateLimitKey } from "@/lib/rate-limit";
import { registerTenantOwner } from "@/lib/services/tenant-service";

const payloadSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  tenantName: z.string().min(1),
  websiteUrl: z.string().url().optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user) {
    return NextResponse.json(
      { error: "Sign out before creating a new workspace." },
      { status: 409 },
    );
  }

  try {
    assertRateLimit({
      key: `register:${getRequestRateLimitKey(request)}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });

    const payload = payloadSchema.parse(await request.json());
    const result = await registerTenantOwner(payload);

    return NextResponse.json({
      tenantId: result.tenant.id,
      userId: result.user.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace.",
      },
      { status: 400 },
    );
  }
}
