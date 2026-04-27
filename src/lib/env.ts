import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrlString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_NAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(16),
  DATABASE_URL: z.string().url(),
  DEFAULT_SYNC_CRON: z.string().default("*/30 * * * *"),
  IMAGE_CACHE_ENABLED: z.enum(["true", "false"]).default("false"),
  IMAGE_CACHE_LIMIT_PER_VEHICLE: z.coerce.number().int().min(1).max(10).default(4),
  INVENTORY_PERSIST_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  JOBS_EXPORT_DIRECTORY: z.string().default("./runtime-data/exports"),
  META_APP_ID: optionalNonEmptyString,
  META_APP_SECRET: optionalNonEmptyString,
  META_GRAPH_API_VERSION: z.string().default("v23.0"),
  META_REDIRECT_URI: optionalUrlString,
  META_TOKEN_ENCRYPTION_KEY: optionalNonEmptyString,
  META_VERIFY_TOKEN: optionalNonEmptyString,
  PLAYWRIGHT_BROWSER: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
  SCRAPER_HEADLESS: z.enum(["true", "false"]).default("true"),
  SCRAPER_DETAIL_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  SEED_DEMO_EMAIL: z.string().email().optional(),
  SEED_DEMO_NAME: z.string().min(1).optional(),
  SEED_DEMO_PASSWORD: z.string().min(8).optional(),
  SEED_DEMO_TENANT_NAME: z.string().min(1).optional(),
  SEED_DEMO_WEBSITE_URL: z.string().url().optional(),
  STORAGE_LOCAL_DIRECTORY: z.string().default("./runtime-data/storage"),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_ACCESS_KEY_ID: optionalNonEmptyString,
  S3_BUCKET_NAME: optionalNonEmptyString,
  S3_ENDPOINT: optionalUrlString,
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  S3_PUBLIC_BASE_URL: optionalUrlString,
  S3_REGION: optionalNonEmptyString,
  S3_SECRET_ACCESS_KEY: optionalNonEmptyString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Environment configuration is invalid.");
}

export const env = parsed.data;

export function isTruthyFlag(value: string | undefined) {
  return value === "true";
}
