import { fileURLToPath } from "node:url";
import { readFileSync, statSync } from "node:fs";

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
  GOOGLE_FINALITY_DAYS: z.coerce.number().int().min(2).max(14).default(3),
  PAGESPEED_REFRESH_HOURS: z.coerce.number().int().min(1).max(720).default(168),
};

const agentEnabledSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const apiConfigSchema = baseConfigSchema.extend({
  WORKFLOW_ACCESS_JSON: z.string().max(30000).optional(),
  AGENTS_ENABLED: agentEnabledSchema,
  AGENT_API_TOKEN: z.string().min(32).max(256).optional(),
  AGENT_ACTOR_ID: z.string().uuid().optional(),
  OPPORTUNITY_ACTOR_ID: z.string().uuid().optional(),
  OPPORTUNITY_API_TOKEN: z.string().min(32).max(256).optional(),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  ...crawlerConfigShape,
  ...googleConfigShape,
});

const workerConfigSchema = baseConfigSchema.extend({
  WORKER_HEALTH_FILE: z.string().min(1).default("/tmp/roco-worker-health.json"),
  WORKFLOW_SCHEDULES_ENABLED: agentEnabledSchema,
  WORKFLOW_MEASUREMENT_ACTOR_ID: z.string().uuid().optional(),
  WORKFLOW_MEASUREMENT_SCHEDULE: z.string().min(1).default("15 * * * *"),
  AGENTS_ENABLED: agentEnabledSchema,
  LLM_OPENAI_API_KEY: z.string().min(1).optional(),
  LLM_POLICY_JSON: z.string().max(20000).optional(),
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

// File mounts keep secrets out of Compose interpolation and image layers.
export function loadSecretFiles(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  for (const name of [
    "DATABASE_URL",
    "WORKFLOW_ACCESS_JSON",
    "OPPORTUNITY_API_TOKEN",
    "AGENT_API_TOKEN",
    "LLM_OPENAI_API_KEY",
    "PAGESPEED_API_KEY",
  ]) {
    const path = environment[`${name}_FILE`];
    if (!path) continue;
    if (environment[name])
      throw new ConfigurationError([
        `${name}: configure a value or a file, not both`,
      ]);
    try {
      if (statSync(path).size > 30000) throw new Error("SECRET_TOO_LARGE");
      const value = readFileSync(path, "utf8").trim();
      if (value) environment[name] = value;
    } catch {
      throw new ConfigurationError([
        `${name}_FILE: secret file is unavailable or too large`,
      ]);
    }
  }
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
  loadSecretFiles();
}

export function parseBaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BaseConfig {
  return parseConfig(baseConfigSchema, environment);
}

export function parseApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const config = parseConfig(apiConfigSchema, environment);
  if (config.NODE_ENV === "production" && !config.WORKFLOW_ACCESS_JSON)
    throw new ConfigurationError([
      "WORKFLOW_ACCESS_JSON: named access is required in production",
    ]);
  return config;
}

export function parseWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const config = parseConfig(workerConfigSchema, environment);
  if (config.GOOGLE_SCHEDULES_ENABLED && !config.GOOGLE_SITE_ID)
    throw new ConfigurationError([
      "GOOGLE_SITE_ID: required for enabled Google schedules",
    ]);
  if (
    config.GOOGLE_SCHEDULES_ENABLED &&
    (config.GSC_PROPERTY || config.GA4_PROPERTY_ID) &&
    !config.GOOGLE_CREDENTIALS_FILE
  )
    throw new ConfigurationError([
      "GOOGLE_CREDENTIALS_FILE: required for configured Google property schedules",
    ]);
  return config;
}
