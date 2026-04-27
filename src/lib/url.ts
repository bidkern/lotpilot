export function sanitizeHttpUrl(value: string | null | undefined, baseUrl?: string) {
  if (!value) {
    return null;
  }

  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
