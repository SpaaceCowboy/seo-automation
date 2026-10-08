import { randomUUID } from "node:crypto";

import pino, { type Logger, type LoggerOptions } from "pino";
import { z } from "zod";

export const CHANGE_MEASUREMENT_QUEUE = "workflow.measure-change";
export const MEASUREMENT_DISPATCH_QUEUE = "workflow.measure.dispatch";
export const AGENT_ANALYSIS_QUEUE = "agents.analyze-opportunity";
export const OPPORTUNITY_DETECTION_QUEUE = "opportunities.detect";
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
  "OPPORTUNITY_API_TOKEN",
  "AGENT_API_TOKEN",
  "WORKFLOW_ACCESS_JSON",
  "LLM_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "OPENAIKEY",
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
    serializers: { err: safeErrorMetadata, error: safeErrorMetadata },
    redact: {
      paths: redactionPaths,
      censor: "[REDACTED]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function safeErrorMetadata(error: unknown): {
  code: string;
  httpStatus?: number;
  retryable?: boolean;
} {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "UNCLASSIFIED_ERROR";
  const metadata: ReturnType<typeof safeErrorMetadata> = {
    code: /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNCLASSIFIED_ERROR",
  };
  if (typeof error === "object" && error !== null) {
    if (
      "status" in error &&
      typeof error.status === "number" &&
      Number.isInteger(error.status) &&
      (error.status === 0 || (error.status >= 100 && error.status <= 599))
    )
      metadata.httpStatus = error.status;
    if ("retryable" in error && typeof error.retryable === "boolean")
      metadata.retryable = error.retryable;
  }
  return metadata;
}

export function resolveCorrelationId(value: unknown): string {
  const parsed = correlationIdSchema.safeParse(value);
  return parsed.success ? parsed.data : randomUUID();
}

export type { Logger } from "pino";
