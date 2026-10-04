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
        .string({ error: "DATABASE_URL is required"})
        .url("DATABASE_URL must be a valid posgreSQL URL")
        .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    )
});

const crawlerConfigShape = {
    CRAWLER_USER_AGENT: z
        .string()
        .min(10)
        .default("RocoSE0/1.0 (+https://rocobroker.com/; technical SEO audit)"),
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
    CRAWLER_RETY_LIMIT: z.coerce.number().int().min(0).max(5).default(2)
}

const googleConfigShape = {
    GOOGLE_CREDENTIALS_FILE: z.string().min(1).optional(),
    GOOGLE_SITE_ID: z.string().uuid().optional,
    GSC_PROPERTY: z.string().min(1).optional(),
    GA4_PROPERTY_ID: z
        .string()
        .regex(/^\d+$/, "GA4_PRPPERTY_ID must contain digits only")
        .optional(),
    PAGESPEED_API
}
