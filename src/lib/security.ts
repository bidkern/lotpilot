import { lookup } from "node:dns/promises";
import path from "node:path";

import { sanitizeHttpUrl } from "@/lib/url";

const blockedHostSuffixes = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
] as const;

const dnsSafetyCache = new Map<
  string,
  {
    checkedAt: number;
    safe: boolean;
  }
>();

function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (normalized === "localhost") {
    return true;
  }

  return blockedHostSuffixes.some((suffix) => normalized.endsWith(suffix));
}

function isPrivateIpv4(ipAddress: string) {
  const octets = ipAddress.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) {
    return true;
  }

  const [first, second] = octets;
  if (first === 10 || first === 127) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }

  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }

  if (first === 0) {
    return true;
  }

  return first >= 224;
}

function isPrivateIpv6(ipAddress: string) {
  const normalized = ipAddress.toLowerCase();

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.") ||
    normalized.startsWith("::ffff:172.")
  );
}

export async function assertSafeExternalUrl(input: string) {
  const sanitized = sanitizeHttpUrl(input);

  if (!sanitized) {
    throw new Error("Only valid http(s) URLs are allowed.");
  }

  const url = new URL(sanitized);
  if (url.username || url.password) {
    throw new Error("Embedded URL credentials are not allowed.");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("Private or local network hosts are not allowed.");
  }

  const cached = dnsSafetyCache.get(url.hostname);
  if (cached && Date.now() - cached.checkedAt < 5 * 60 * 1000) {
    if (!cached.safe) {
      throw new Error("Private network targets are not allowed.");
    }

    return sanitized;
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error("Unable to resolve the target host.");
  }

  for (const address of addresses) {
    if (address.family === 4 && isPrivateIpv4(address.address)) {
      dnsSafetyCache.set(url.hostname, { checkedAt: Date.now(), safe: false });
      throw new Error("Private network targets are not allowed.");
    }

    if (address.family === 6 && isPrivateIpv6(address.address)) {
      dnsSafetyCache.set(url.hostname, { checkedAt: Date.now(), safe: false });
      throw new Error("Private network targets are not allowed.");
    }
  }

  dnsSafetyCache.set(url.hostname, { checkedAt: Date.now(), safe: true });

  return sanitized;
}

export async function fetchTextWithRedirectValidation(input: string, init?: RequestInit) {
  let currentUrl = await assertSafeExternalUrl(input);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response was missing a location header.");
      }

      const redirectedUrl = sanitizeHttpUrl(location, currentUrl);
      if (!redirectedUrl) {
        throw new Error("Redirect target was not a valid http(s) URL.");
      }

      currentUrl = await assertSafeExternalUrl(redirectedUrl);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Request failed for ${currentUrl}: ${response.status}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(contentLength) && contentLength > 2_000_000) {
        throw new Error("Response was too large to inspect safely.");
      }
    }

    const text = await response.text();
    if (text.length > 2_000_000) {
      throw new Error("Response was too large to inspect safely.");
    }

    return text;
  }

  throw new Error("Too many redirects while fetching the target URL.");
}

export function assertPathInsideDirectory(filePath: string, directoryPath: string) {
  const resolvedDirectory = path.resolve(directoryPath);
  const resolvedFilePath = path.resolve(filePath);
  const relativePath = path.relative(resolvedDirectory, resolvedFilePath);

  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  ) {
    return resolvedFilePath;
  }

  throw new Error("Resolved file path escapes the allowed directory.");
}

export function sanitizeDownloadFileName(fileName: string) {
  return path
    .basename(fileName)
    .replace(/[\r\n"]/g, "-")
    .slice(0, 180);
}
