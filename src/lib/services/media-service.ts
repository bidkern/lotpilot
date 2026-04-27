import { StorageProvider } from "@prisma/client";

import { env, isTruthyFlag } from "@/lib/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { buildStorageKey, buildStoredObjectPublicUrl, storeBinaryObject } from "@/lib/storage";

const imageExtensionByContentType: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function inferImageExtension(contentType: string) {
  return imageExtensionByContentType[contentType.toLowerCase()] ?? "bin";
}

async function fetchImageAsset(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "TheBookBot/1.0 (+image cache)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Image request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Unsupported image content type: ${contentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      buffer,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function cacheVehicleImagesForVehicle(vehicleId: string) {
  if (!isTruthyFlag(env.IMAGE_CACHE_ENABLED)) {
    return [];
  }

  const vehicleImages = await prisma.vehicleImage.findMany({
    where: {
      vehicleId,
    },
    orderBy: {
      sortOrder: "asc",
    },
    take: env.IMAGE_CACHE_LIMIT_PER_VEHICLE,
  });

  const cachedImageIds: string[] = [];

  for (const image of vehicleImages) {
    if (!image.url) {
      continue;
    }

    if (image.storageKey && image.cachedAssetUrl) {
      cachedImageIds.push(image.id);
      continue;
    }

    try {
      const asset = await fetchImageAsset(image.url);
      const extension = inferImageExtension(asset.contentType);
      const storageKey = buildStorageKey(
        "tenants",
        image.tenantId,
        "vehicles",
        image.vehicleId,
        "images",
        `${image.id}.${extension}`,
      );
      const storedObject = await storeBinaryObject(storageKey, asset.contentType, asset.buffer);
      const cachedAssetUrl =
        storedObject.publicUrl ??
        buildStoredObjectPublicUrl(storedObject.key) ??
        `/api/admin/vehicle-images/${image.id}`;

      await prisma.vehicleImage.update({
        where: {
          id: image.id,
        },
        data: {
          byteSize: asset.buffer.byteLength,
          cachedAssetUrl,
          contentType: asset.contentType,
          storageKey: storedObject.key,
          storageProvider: storedObject.provider,
        },
      });

      cachedImageIds.push(image.id);
    } catch (error) {
      logger.warn("Unable to cache vehicle image", {
        error: error instanceof Error ? error.message : String(error),
        imageId: image.id,
        url: image.url,
        vehicleId,
      });
    }
  }

  return cachedImageIds;
}

export function getImageProxyUrl(input: {
  imageId: string;
  provider: StorageProvider | null;
  storageKey: string | null;
}) {
  if (input.provider === StorageProvider.S3 && input.storageKey) {
    const publicUrl = buildStoredObjectPublicUrl(input.storageKey);
    if (publicUrl) {
      return publicUrl;
    }
  }

  return `/api/admin/vehicle-images/${input.imageId}`;
}
