import { readFile } from "fs/promises";
import path from "path";

import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";

import { createAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { requireApiRole } from "@/lib/request-auth";
import { prisma } from "@/lib/prisma";
import { assertPathInsideDirectory, sanitizeDownloadFileName } from "@/lib/security";
import { readStoredObject } from "@/lib/storage";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      exportJobId: string;
    }>;
  },
) {
  const authResult = await requireApiRole([UserRole.AGENT]);
  if (authResult.error) {
    return authResult.error;
  }

  try {
    const { exportJobId } = await context.params;
    const exportJob = await prisma.exportJob.findFirst({
      where: {
        id: exportJobId,
        tenantId: authResult.user!.tenantId!,
      },
    });

    if (!exportJob) {
      return NextResponse.json({ error: "Export job not found." }, { status: 404 });
    }

    if (!exportJob.storagePath || exportJob.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Export file is not ready for download yet." },
        { status: 409 },
      );
    }

    const fileBuffer =
      exportJob.storageKey || exportJob.storageProvider
        ? await readStoredObject({
            key: exportJob.storageKey ?? exportJob.storagePath,
            provider: exportJob.storageProvider,
          })
        : await readFile(
            assertPathInsideDirectory(exportJob.storagePath, env.JOBS_EXPORT_DIRECTORY),
          );
    const fileName = sanitizeDownloadFileName(
      exportJob.fileName || path.basename(exportJob.storageKey ?? exportJob.storagePath),
    );
    const contentType =
      exportJob.format === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";

    await createAuditLog({
      action: "export.downloaded",
      actorId: authResult.user?.id,
      entityId: exportJob.id,
      entityType: "ExportJob",
      tenantId: authResult.user?.tenantId ?? undefined,
      summary: `Downloaded export file ${fileName}.`,
    });

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-type": contentType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to download export file.",
      },
      { status: 400 },
    );
  }
}
