import { randomUUID } from "node:crypto";

import pino, { type Logger, type LoggerOptions } from "pino";
import { z } from "zod";

export const CRAWL_SITE_QUEUE = "crawl.site";
export const GSC_SYNC_QUEUE = "google.gsc.sync";
export const GSC_BACKFILL_QUEUE = "google.gsc.backfill";
export const GA4_SYNC_QUEUE = "google.ga4.sync";
export const PAGESPEED_SYNC_QUEUE = "google.pagespeed.sync";
export const GOOGLE_SYNC_DISPATCH_QUEUE = "google.sync.dispatch";

export const correlationIdSchema = z.string().trim().min(1).max(128);

const redactionPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "DATABASE_URL",
  "databaseUrl",
  "password",
  "token",
  "accessToken",
  "private_key",
  "PAGESPEED_API_KEY",
];

export interface LoggerConfiguration {
  readonly level: NonNullable<LoggerOptions["level"]>;
  readonly service: string;
  readonly environment: string;
}

export function createLogger(configuration: LoggerConfiguration): Logger {
  return pino({
    name: configuration.service,
    level: configuration.level,
    base: {
      service: configuration.service,
      environment: configuration.environment,
    },
    redact: {
      paths: redactionPaths,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function resolveCorrelationId(value: unknown): string {
  const parsed = correlationIdSchema.safeParse(value);
  return parsed.success ? parsed.data : randomUUID();
}

export type { Logger } from "pino";
