import Fastify from "fastify";
import { z } from "zod";

import { resolveCorrelationId, type Logger } from "@roco/shared";

export interface ReadinessStatus {
  readonly database: boolean;
  readonly queue: boolean;
}

export interface AppDependencies {
  readonly logger: Logger;
  readonly readiness: () => Promise<ReadinessStatus>;
  readonly crawls?: CrawlApiService;
  readonly integrations?: IntegrationApiService;
}

export interface IntegrationApiService {
  trigger(input: {
    siteId: string;
    provider: "GSC" | "GA4" | "PAGESPEED";
    correlationId: string;
    mode: "sync" | "backfill";
    idempotencyKey?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    dimensionSet?: "PAGE" | "QUERY" | "PAGE_QUERY" | undefined;
    urls?: string[] | undefined;
    strategies?: ("mobile" | "desktop")[] | undefined;
  }): Promise<{ id: string; status: string }>;
  get(runId: string): Promise<unknown>;
  freshness(siteId: string): Promise<unknown>;
}

export interface CrawlApiService {
  start(input: {
    siteId: string;
    correlationId: string;
    idempotencyKey?: string | undefined;
    startUrl?: string | undefined;
    maxPages?: number | undefined;
    maxDepth?: number | undefined;
    concurrency?: number | undefined;
    requestsPerSecond?: number | undefined;
  }): Promise<{ id: string; status: string }>;
  get(runId: string): Promise<{
    id: string;
    siteId: string;
    status: string;
    startUrl: string;
    summary: Record<string, unknown> | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  } | null>;
  cancel(runId: string): Promise<boolean>;
}

const uuidParamsSchema = z.object({ siteId: z.string().uuid() });
const runParamsSchema = z.object({ runId: z.string().uuid() });
const startCrawlSchema = z.object({
  idempotencyKey: z.string().min(8).max(256).optional(),
  startUrl: z.string().url().optional(),
  maxPages: z.number().int().min(1).max(10_000).optional(),
  maxDepth: z.number().int().min(0).max(20).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
  requestsPerSecond: z.number().positive().max(10).optional(),
});
const integrationParamsSchema = z.object({
  siteId: z.string().uuid(),
  provider: z.enum(["gsc", "ga4", "pagespeed"]),
});
const integrationSyncSchema = z.object({
  mode: z.enum(["sync", "backfill"]).default("sync"),
  idempotencyKey: z.string().min(8).max(256).optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  dimensionSet: z.enum(["PAGE", "QUERY", "PAGE_QUERY"]).optional(),
  urls: z.array(z.string().url()).min(1).max(20).optional(),
  strategies: z
    .array(z.enum(["mobile", "desktop"]))
    .min(1)
    .max(2)
    .optional(),
});

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "timestamp"],
  properties: {
    status: { type: "string" },
    service: { type: "string" },
    timestamp: { type: "string" },
  },
} as const;

const readinessResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "services", "timestamp"],
  properties: {
    status: { type: "string" },
    services: {
      type: "object",
      additionalProperties: false,
      required: ["database", "queue"],
      properties: {
        database: { type: "boolean" },
        queue: { type: "boolean" },
      },
    },
    timestamp: { type: "string" },
  },
} as const;

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    loggerInstance: dependencies.logger,
    genReqId(request) {
      return resolveCorrelationId(request.headers["x-correlation-id"]);
    },
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, requestId: request.id }, "request failed");
    void reply.code(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "The request could not be completed.",
      requestId: request.id,
    });
  });

  app.get(
    "/health",
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    () => ({
      status: "ok",
      service: "roco-seo-api",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    "/ready",
    {
      schema: {
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const services = await dependencies.readiness();
      const ready = services.database && services.queue;
      return reply.code(ready ? 200 : 503).send({
        status: ready ? "ready" : "not_ready",
        services,
        timestamp: new Date().toISOString(),
      });
    },
  );

  if (dependencies.crawls !== undefined) {
    app.post("/sites/:siteId/crawls", async (request, reply) => {
      const params = uuidParamsSchema.safeParse(request.params);
      const body = startCrawlSchema.safeParse(request.body ?? {});
      if (!params.success || !body.success) {
        return reply.code(400).send({
          error: "INVALID_CRAWL_REQUEST",
          message: "The crawl request is invalid.",
          requestId: request.id,
        });
      }
      try {
        const run = await dependencies.crawls!.start({
          siteId: params.data.siteId,
          correlationId: request.id,
          ...body.data,
        });
        return reply.code(202).send(run);
      } catch (error) {
        request.log.warn(
          { err: error, siteId: params.data.siteId },
          "crawl request rejected",
        );
        return reply.code(400).send({
          error: "CRAWL_REQUEST_REJECTED",
          message:
            error instanceof Error
              ? error.message
              : "The crawl request was rejected.",
          requestId: request.id,
        });
      }
    });

    app.get("/crawls/:runId", async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({
          error: "INVALID_RUN_ID",
          message: "A valid crawl run ID is required.",
          requestId: request.id,
        });
      const run = await dependencies.crawls!.get(params.data.runId);
      if (run === null)
        return reply.code(404).send({
          error: "CRAWL_NOT_FOUND",
          message: "The crawl run was not found.",
          requestId: request.id,
        });
      return reply.send(run);
    });

    app.get("/crawls/:runId/summary", async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({
          error: "INVALID_RUN_ID",
          message: "A valid crawl run ID is required.",
          requestId: request.id,
        });
      const run = await dependencies.crawls!.get(params.data.runId);
      if (run === null)
        return reply.code(404).send({
          error: "CRAWL_NOT_FOUND",
          message: "The crawl run was not found.",
          requestId: request.id,
        });
      if (run.summary === null)
        return reply.code(409).send({
          error: "CRAWL_NOT_COMPLETE",
          message: "The crawl summary is not available yet.",
          status: run.status,
          requestId: request.id,
        });
      return reply.send({
        id: run.id,
        status: run.status,
        summary: run.summary,
        finishedAt: run.finishedAt,
      });
    });

    app.post("/crawls/:runId/cancel", async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({
          error: "INVALID_RUN_ID",
          message: "A valid crawl run ID is required.",
          requestId: request.id,
        });
      const cancelled = await dependencies.crawls!.cancel(params.data.runId);
      if (!cancelled)
        return reply.code(409).send({
          error: "CRAWL_NOT_CANCELLABLE",
          message: "The crawl does not exist or is already terminal.",
          requestId: request.id,
        });
      return reply
        .code(202)
        .send({ id: params.data.runId, status: "CANCELLED" });
    });
  }

  if (dependencies.integrations !== undefined) {
    app.post(
      "/sites/:siteId/integrations/:provider/sync",
      async (request, reply) => {
        const params = integrationParamsSchema.safeParse(request.params);
        const body = integrationSyncSchema.safeParse(request.body ?? {});
        if (!params.success || !body.success)
          return reply.code(400).send({
            error: "INVALID_INTEGRATION_REQUEST",
            message: "The integration synchronization request is invalid.",
            requestId: request.id,
          });
        try {
          const result = await dependencies.integrations!.trigger({
            siteId: params.data.siteId,
            provider: params.data.provider.toUpperCase() as
              "GSC" | "GA4" | "PAGESPEED",
            correlationId: request.id,
            ...body.data,
          });
          return reply.code(202).send(result);
        } catch (error) {
          request.log.warn(
            {
              err: error,
              siteId: params.data.siteId,
              provider: params.data.provider,
            },
            "integration sync request rejected",
          );
          return reply.code(400).send({
            error: "INTEGRATION_REQUEST_REJECTED",
            message:
              error instanceof Error
                ? error.message
                : "The synchronization request was rejected.",
            requestId: request.id,
          });
        }
      },
    );

    app.get("/integration-syncs/:runId", async (request, reply) => {
      const params = runParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({
          error: "INVALID_RUN_ID",
          message: "A valid integration run ID is required.",
          requestId: request.id,
        });
      const run = await dependencies.integrations!.get(params.data.runId);
      if (run === null)
        return reply.code(404).send({
          error: "INTEGRATION_RUN_NOT_FOUND",
          message: "The integration run was not found.",
          requestId: request.id,
        });
      return reply.send(run);
    });

    app.get("/sites/:siteId/integrations/freshness", async (request, reply) => {
      const params = uuidParamsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({
          error: "INVALID_SITE_ID",
          message: "A valid site ID is required.",
          requestId: request.id,
        });
      return reply.send(
        await dependencies.integrations!.freshness(params.data.siteId),
      );
    });
  }

  return app;
}
