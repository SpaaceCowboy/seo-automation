import { OPENAI_CONNECTION_QUEUE } from "@roco/shared/control";
import { WorkflowError } from "@roco/workflow";
import { randomUUID } from "node:crypto";

import { parseApiConfig, loadEnvironment } from "@roco/config";
import {
  createCrawlRepository,
  createDatabase,
  createIntegrationStatusRepository,
  createIntegrationRepository,
  createOpportunityRepository,
  createAgentRepository,
  createWorkflowRepository,
  createMeasurementRepository,
  createControlRepository,
} from "@roco/db";
import { isInternalUrl } from "@roco/seo-core";
import {
  CRAWL_SITE_QUEUE,
  OPPORTUNITY_DETECTION_QUEUE,
  AGENT_ANALYSIS_QUEUE,
  CHANGE_MEASUREMENT_QUEUE,
  GA4_SYNC_QUEUE,
  GSC_BACKFILL_QUEUE,
  GSC_SYNC_QUEUE,
  PAGESPEED_SYNC_QUEUE,
  createLogger,
} from "@roco/shared";
import { PgBoss } from "pg-boss";

import { buildApp } from "./app.js";

const bootstrapLogger = createLogger({
  service: "roco-seo-api",
  environment: process.env.NODE_ENV ?? "development",
  level: "info",
});
let startupCleanup: (() => Promise<void>) | undefined;

async function start(): Promise<void> {
  loadEnvironment();
  const config = parseApiConfig();
  const logger = createLogger({
    service: "roco-seo-api",
    environment: config.NODE_ENV,
    level: config.LOG_LEVEL,
  });
  const database = createDatabase(config.DATABASE_URL, {
    application_name: "roco-seo-api",
  });
  const crawlRepository = createCrawlRepository(database.db);
  const integrationRepository = createIntegrationRepository(database.db);
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    application_name: "roco-seo-api-queue",
    max: 2,
  });
  database.pool.on("error", (error) =>
    logger.error({ err: error }, "API database connection failed"),
  );
  startupCleanup = async () => {
    try {
      await boss.stop({ graceful: false, close: true });
    } finally {
      await database.close();
    }
  };
  boss.on("error", (error) =>
    logger.error({ err: error }, "API pg-boss error"),
  );
  await boss.start();
  await boss.createQueue(CRAWL_SITE_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 7_200,
    deleteAfterSeconds: 604_800,
  });
  for (const queue of [
    GSC_SYNC_QUEUE,
    GSC_BACKFILL_QUEUE,
    GA4_SYNC_QUEUE,
    PAGESPEED_SYNC_QUEUE,
  ]) {
    await boss.createQueue(queue, {
      retryLimit: config.GOOGLE_RETRY_LIMIT,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 3_600,
      deleteAfterSeconds: 604_800,
    });
  }
  await boss.createQueue(OPPORTUNITY_DETECTION_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1800,
    deleteAfterSeconds: 604800,
  });
  const opportunityRepository = createOpportunityRepository(database.db);
  const agentRepository = createAgentRepository(database.db, database.pool);
  await boss.createQueue(AGENT_ANALYSIS_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1800,
    deleteAfterSeconds: 604800,
  });
  const workflowRepository = createWorkflowRepository(database.db);
  const measurementRepository = createMeasurementRepository(database.db);
  await boss.createQueue(CHANGE_MEASUREMENT_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1800,
    deleteAfterSeconds: 604800,
  });
  const integrationStatus = createIntegrationStatusRepository(database.pool);
  await boss.createQueue(OPENAI_CONNECTION_QUEUE, {
    retryLimit: 0,
    expireInSeconds: 60,
    deleteAfterSeconds: 604800,
  });
  const app = buildApp({
    control: {
      ...createControlRepository(database.db),
      integrations: (siteId, p) => integrationStatus.read(siteId, p),
      async checkOpenai(p) {
        const ticket = await integrationStatus.request("MANUAL", p);
        if (ticket.enqueue) {
          try {
            const job = await boss.send(OPENAI_CONNECTION_QUEUE, {
              checkId: ticket.id,
              instanceId: ticket.instanceId,
              correlationId: ticket.correlationId,
            });
            if (!job) throw new Error("ENQUEUE_FAILED");
          } catch {
            await integrationStatus.finish(ticket.id, {
              status: "FAILED",
              errorCode: "CHECK_QUEUE_UNAVAILABLE",
              httpStatus: null,
              durationMs: 0,
            });
            throw new WorkflowError("INTEGRATION_CHECK_QUEUE_UNAVAILABLE");
          }
        }
        return ticket;
      },
    },
    workflowAccess: config.WORKFLOW_ACCESS_JSON,
    workflow: {
      async invoke(operation, siteId, id, body, p) {
        switch (operation) {
          case "CREATE":
            return workflowRepository.create(siteId, body, p);
          case "LIST":
            return workflowRepository.list(siteId, body, p);
          case "DETAIL":
            return workflowRepository.detail(siteId, id!, p);
          case "REVISE":
            return workflowRepository.revise(siteId, id!, body, p);
          case "TRANSITION":
            return workflowRepository.transition(siteId, id!, body, p);
          case "IMPLEMENT":
            return workflowRepository.implement(siteId, id!, body, p);
          case "LEDGER":
            return workflowRepository.ledger(siteId, id!, p);
          case "REVERT":
            return workflowRepository.event(siteId, id!, "REVERT", body, p);
          case "CORRECTION":
            return workflowRepository.event(siteId, id!, "CORRECTION", body, p);
          case "BASELINE":
            return workflowRepository.refreshBaseline(siteId, id!, body, p);
          case "HISTORY":
            return measurementRepository.history(siteId, id!, p);
          case "MEASURE30":
          case "MEASURE60":
          case "MEASURE90": {
            const horizon = Number(operation.slice(7)) as 30 | 60 | 90;
            const run = await measurementRepository.createRun(
              siteId,
              id!,
              horizon,
              body,
              p,
            );
            if (run.status !== "SUCCEEDED")
              await boss.send(
                CHANGE_MEASUREMENT_QUEUE,
                {
                  runId: run.id,
                  siteId: run.siteId,
                  correlationId: run.correlationId,
                },
                { singletonKey: run.id },
              );
            return { id: run.id, status: run.status };
          }
        }
      },
    },
    agentToken: config.AGENT_API_TOKEN,
    agentsEnabled: config.AGENTS_ENABLED,
    agents: {
      async retry(input) {
        if (!config.AGENT_ACTOR_ID)
          throw new Error("AGENT_ACTOR_ID is required.");
        const run = await agentRepository.retry({
          ...input,
          actorId: config.AGENT_ACTOR_ID,
        });
        await boss.send(
          AGENT_ANALYSIS_QUEUE,
          {
            runId: run.id,
            siteId: run.siteId,
            correlationId: run.correlationId,
          },
          { singletonKey: run.id },
        );
        return { id: run.id, status: run.status };
      },
      async trigger(input) {
        if (!config.AGENT_ACTOR_ID)
          throw new Error("AGENT_ACTOR_ID is required.");
        const run = await agentRepository.createRun({
          ...input,
          actorId: config.AGENT_ACTOR_ID,
        });
        if (run.status !== "SUCCEEDED")
          await boss.send(
            AGENT_ANALYSIS_QUEUE,
            {
              runId: run.id,
              siteId: run.siteId,
              correlationId: run.correlationId,
            },
            { singletonKey: run.id },
          );
        return { id: run.id, status: run.status };
      },
      inspect: (siteId, id) => agentRepository.inspect(siteId, id),
      draft: (siteId, id) => agentRepository.draft(siteId, id),
    },
    opportunityToken: config.OPPORTUNITY_API_TOKEN,
    opportunities: {
      async changeStatus(input) {
        if (config.OPPORTUNITY_ACTOR_ID === undefined)
          throw new Error("OPPORTUNITY_ACTOR_ID is not configured.");
        await opportunityRepository.changeStatus({
          ...input,
          actorId: config.OPPORTUNITY_ACTOR_ID,
        });
      },
      async trigger(input) {
        const run = await opportunityRepository.createRun(input);
        if (run.status !== "SUCCEEDED")
          await boss.send(
            OPPORTUNITY_DETECTION_QUEUE,
            {
              runId: run.id,
              siteId: run.siteId,
              correlationId: run.correlationId,
            },
            { singletonKey: run.id },
          );
        return { id: run.id, status: run.status };
      },
      list: (siteId, filter) => opportunityRepository.list(siteId, filter),
      detail: (siteId, id) => opportunityRepository.detail(siteId, id),
      async run(siteId, id) {
        const run = await opportunityRepository.getRun(id);
        if (!run || run.siteId !== siteId) return null;
        const { inputSnapshot, ...summary } = run;
        return { ...summary, sourceCaptured: inputSnapshot !== null };
      },
    },
    logger,
    async readiness() {
      const [databaseReady, queueReady] = await Promise.all([
        database.ping(),
        database.isQueueReady(),
      ]);
      return { database: databaseReady, queue: queueReady };
    },
    crawls: {
      async start(input) {
        const scope = await crawlRepository.getSiteScope(input.siteId);
        if (scope === null || scope.allowedHosts.length === 0)
          throw new Error(
            "The site does not exist or has no approved host scope.",
          );
        const startUrl = input.startUrl ?? scope.canonicalOrigin;
        if (!isInternalUrl(startUrl, scope))
          throw new Error(
            "The start URL is outside the site's approved host scope.",
          );
        const run = await crawlRepository.createRun({
          siteId: input.siteId,
          idempotencyKey:
            input.idempotencyKey ?? `crawl:${input.siteId}:${randomUUID()}`,
          trigger: "MANUAL",
          configuration: {
            startUrl,
            userAgent: config.CRAWLER_USER_AGENT,
            maxPages: Math.min(
              input.maxPages ?? config.CRAWLER_MAX_PAGES,
              config.CRAWLER_MAX_PAGES,
            ),
            maxDepth: Math.min(
              input.maxDepth ?? config.CRAWLER_MAX_DEPTH,
              config.CRAWLER_MAX_DEPTH,
            ),
            concurrency: Math.min(
              input.concurrency ?? config.CRAWLER_CONCURRENCY,
              config.CRAWLER_CONCURRENCY,
            ),
            requestsPerSecond: Math.min(
              input.requestsPerSecond ?? config.CRAWLER_REQUESTS_PER_SECOND,
              config.CRAWLER_REQUESTS_PER_SECOND,
            ),
            requestTimeoutMs: config.CRAWLER_REQUEST_TIMEOUT_MS,
            maxResponseBytes: config.CRAWLER_MAX_RESPONSE_BYTES,
            maxRedirects: config.CRAWLER_MAX_REDIRECTS,
            retryLimit: config.CRAWLER_RETRY_LIMIT,
            respectRobots: true,
            ignoredQueryParameters: [],
          },
        });
        if (run.status === "QUEUED") {
          await boss.send(CRAWL_SITE_QUEUE, {
            crawlRunId: run.id,
            siteId: input.siteId,
            correlationId: input.correlationId,
          });
        }
        return { id: run.id, status: run.status };
      },
      get: (runId) => crawlRepository.getRun(runId),
      cancel: (runId) => crawlRepository.cancel(runId),
    },
    integrations: {
      async trigger(input) {
        const scope = await integrationRepository.getSiteScope(input.siteId);
        if (scope === null) throw new Error("The site does not exist.");
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const endDate = input.endDate ?? yesterday.toISOString().slice(0, 10);
        const start = new Date(`${endDate}T00:00:00Z`);
        if (input.mode === "backfill")
          start.setUTCDate(
            start.getUTCDate() - config.GOOGLE_BACKFILL_DAYS + 1,
          );
        const startDate = input.startDate ?? start.toISOString().slice(0, 10);
        if (startDate > endDate)
          throw new Error("startDate must not be after endDate.");
        const days =
          Math.floor(
            (Date.parse(`${endDate}T00:00:00Z`) -
              Date.parse(`${startDate}T00:00:00Z`)) /
              86_400_000,
          ) + 1;
        if (days < 1 || days > 480)
          throw new Error(
            "The requested date range must be between 1 and 480 days.",
          );
        let propertyIdentifier: string;
        let queue: string;
        let jobType: string;
        if (input.provider === "GSC") {
          if (config.GSC_PROPERTY === undefined)
            throw new Error("GSC_PROPERTY is not configured.");
          if (config.GOOGLE_CREDENTIALS_FILE === undefined)
            throw new Error("GOOGLE_CREDENTIALS_FILE is not configured.");
          propertyIdentifier = config.GSC_PROPERTY;
          queue =
            input.mode === "backfill" ? GSC_BACKFILL_QUEUE : GSC_SYNC_QUEUE;
          jobType = input.mode === "backfill" ? "backfill-gsc" : "sync-gsc";
        } else if (input.provider === "GA4") {
          if (config.GA4_PROPERTY_ID === undefined)
            throw new Error("GA4_PROPERTY_ID is not configured.");
          if (config.GOOGLE_CREDENTIALS_FILE === undefined)
            throw new Error("GOOGLE_CREDENTIALS_FILE is not configured.");
          propertyIdentifier = config.GA4_PROPERTY_ID;
          queue = GA4_SYNC_QUEUE;
          jobType = "sync-ga4";
        } else {
          propertyIdentifier = scope.canonicalOrigin;
          queue = PAGESPEED_SYNC_QUEUE;
          jobType = "sync-pagespeed";
        }
        const accountId = await integrationRepository.ensureAccount({
          siteId: input.siteId,
          provider: input.provider,
          propertyIdentifier,
          ...(config.GOOGLE_CREDENTIALS_FILE === undefined
            ? {}
            : { credentialReference: config.GOOGLE_CREDENTIALS_FILE }),
        });
        const dimensionSet =
          input.provider === "GSC"
            ? (input.dimensionSet ?? "PAGE_QUERY")
            : undefined;
        const urls =
          input.provider === "PAGESPEED"
            ? (input.urls ?? [scope.canonicalOrigin])
            : undefined;
        for (const url of urls ?? []) {
          if (!isInternalUrl(url, scope))
            throw new Error(
              `PageSpeed URL is outside the approved site scope: ${url}`,
            );
        }
        const idempotencyKey =
          input.idempotencyKey ??
          [
            input.provider.toLowerCase(),
            input.siteId,
            input.mode,
            startDate,
            endDate,
            dimensionSet ?? "default",
            ...(urls ?? []),
          ].join(":");
        const run = await integrationRepository.createSyncRun({
          siteId: input.siteId,
          accountId,
          provider: input.provider,
          jobType,
          ...(input.provider === "PAGESPEED" ? {} : { startDate, endDate }),
          ...(dimensionSet === undefined ? {} : { dimensionSet }),
          idempotencyKey,
        });
        if (run.status === "QUEUED") {
          const payload =
            input.provider === "GSC"
              ? {
                  syncRunId: run.id,
                  siteId: input.siteId,
                  correlationId: input.correlationId,
                  startDate,
                  endDate,
                  dimensionSet,
                }
              : input.provider === "GA4"
                ? {
                    syncRunId: run.id,
                    siteId: input.siteId,
                    correlationId: input.correlationId,
                    startDate,
                    endDate,
                  }
                : {
                    syncRunId: run.id,
                    siteId: input.siteId,
                    correlationId: input.correlationId,
                    urls,
                    strategies: input.strategies ?? ["mobile", "desktop"],
                  };
          await boss.send(queue, payload);
        }
        return { id: run.id, status: run.status };
      },
      get: (runId) => integrationRepository.getSyncRun(runId),
      freshness: (siteId) => integrationRepository.latestFreshness(siteId),
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "API shutdown started");
    await app.close();
    await boss.stop({ graceful: true, timeout: 10_000, close: true });
    await database.close();
    logger.info("API shutdown completed");
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  logger.info({ host: config.API_HOST, port: config.API_PORT }, "API started");
}

try {
  await start();
} catch (error) {
  bootstrapLogger.fatal({ err: error }, "API failed to start");
  try {
    await startupCleanup?.();
  } catch {
    bootstrapLogger.error(
      { errorCode: "API_STARTUP_CLEANUP_FAILED" },
      "API startup cleanup failed",
    );
  }
  process.exitCode = 1;
}
