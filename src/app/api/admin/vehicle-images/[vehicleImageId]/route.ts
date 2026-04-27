import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";

import { requireApiRole } from "@/lib/request-auth";
import { prisma } from "@/lib/prisma";
import { readStoredObject } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      vehicleImageId: string;
    }>;
  },
) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const { vehicleImageId } = await context.params;
    const image = await prisma.vehicleImage.findFirst({
      where: {
        id: vehicleImageId,
        tenantId: authResult.user!.tenantId!,
      },
      select: {
        contentType: true,
        storageKey: true,
        storageProvider: true,
        url: true,
      },
    });

    if (!image?.storageKey) {
      return NextResponse.json({ error: "Cached image not found." }, { status: 404 });
    }

    const buffer = await readStoredObject({
      key: image.storageKey,
      provider: image.storageProvider,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": image.contentType ?? "application/octet-stream",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load cached vehicle image.",
      },
      { status: 400 },
    );
  }
}
