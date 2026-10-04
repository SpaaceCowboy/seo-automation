import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

const baseConfigSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default("development"),
  LOG_LEVEL: logLevelSchema.default("info"),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid PostgreSQL URL")
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use the postgresql:// or postgres:// scheme",
    ),
});

const crawlerConfigShape = {
  CRAWLER_USER_AGENT: z
    .string()
    .min(10)
    .default("RocoSEO/1.0 (+https://rocobroker.com/; technical SEO audit)"),
  CRAWLER_MAX_PAGES: z.coerce.number().int().min(1).max(10_000).default(30),
  CRAWLER_MAX_DEPTH: z.coerce.number().int().min(0).max(20).default(6),
  CRAWLER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  CRAWLER_REQUESTS_PER_SECOND: z.coerce.number().positive().max(10).default(1),
  CRAWLER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(15_000),
  CRAWLER_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(16_384)
    .max(20_000_000)
    .default(2_000_000),
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().min(0).max(20).default(5),
  CRAWLER_RETRY_LIMIT: z.coerce.number().int().min(0).max(5).default(2),
};

const googleConfigShape = {
  GOOGLE_CREDENTIALS_FILE: z.string().min(1).optional(),
  GOOGLE_SITE_ID: z.string().uuid().optional(),
  GSC_PROPERTY: z.string().min(1).optional(),
  GA4_PROPERTY_ID: z
    .string()
    .regex(/^\d+$/, "GA4_PROPERTY_ID must contain digits only")
    .optional(),
  PAGESPEED_API_KEY: z.string().min(1).optional(),
  GOOGLE_BACKFILL_DAYS: z.coerce.number().int().min(1).max(480).default(90),
  GOOGLE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  GOOGLE_RETRY_LIMIT: z.coerce.number().int().min(0).max(8).default(3),
  GOOGLE_REQUESTS_PER_SECOND: z.coerce.number().positive().max(20).default(2),
  GSC_SYNC_SCHEDULE: z.string().min(1).default("15 4 * * *"),
  GA4_SYNC_SCHEDULE: z.string().min(1).default("45 4 * * *"),
  PAGESPEED_SYNC_SCHEDULE: z.string().min(1).default("15 5 * * 1"),
  GOOGLE_SCHEDULES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PAGESPEED_REFRESH_HOURS: z.coerce.number().int().min(1).max(720).default(168),
};

const apiConfigSchema = baseConfigSchema.extend({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  ...crawlerConfigShape,
  ...googleConfigShape,
});

const workerConfigSchema = baseConfigSchema.extend({
  WORKER_HEALTH_JOB_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WORKER_HEALTH_JOB_SCHEDULE: z.string().min(1).default("*/5 * * * *"),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(10_000),
  ...crawlerConfigShape,
  ...googleConfigShape,
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;
export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class ConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

function parseConfig<T>(
  schema: z.ZodType<T>,
  environment: NodeJS.ProcessEnv,
): T {
  const result = schema.safeParse(environment);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`,
    );
    throw new ConfigurationError(issues);
  }

  return result.data;
}

export function loadEnvironment(path?: string): void {
  const resolvedPath =
    path ?? fileURLToPath(new URL("../../../.env", import.meta.url));
  const result = loadDotenv({ path: resolvedPath, quiet: true });
  if (
    result.error !== undefined &&
    "code" in result.error &&
    result.error.code !== "ENOENT"
  ) {
    throw result.error;
  }
}

export function parseBaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BaseConfig {
  return parseConfig(baseConfigSchema, environment);
}

export function parseApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return parseConfig(apiConfigSchema, environment);
}

export function parseWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return parseConfig(workerConfigSchema, environment);
}
