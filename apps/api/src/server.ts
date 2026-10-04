import { randomUUID } from "node:crypto";

import { parseApiConfig, loadEnvironment } from "@roco/config";
import {
  createCrawlRepository,
  createDatabase,
  createIntegrationRepository,
} from "@roco/db";
import { isInternalUrl } from "@roco/seo-core";
import {
  CRAWL_SITE_QUEUE,
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
  const app = buildApp({
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
  process.exitCode = 1;
}
