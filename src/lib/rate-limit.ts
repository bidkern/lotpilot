type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export function getRequestRateLimitKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

export function assertRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const bucket = buckets.get(input.key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return;
  }

  if (bucket.count >= input.limit) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    throw new Error(`Rate limit exceeded. Retry in about ${retryAfterSeconds} seconds.`);
  }

  bucket.count += 1;
  buckets.set(input.key, bucket);
}
