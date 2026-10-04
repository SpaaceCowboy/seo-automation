import { PgBoss } from "pg-boss";

import type { WorkerConfig } from "@roco/config";
import {
  createDatabase,
  createCrawlRepository,
  createIntegrationRepository,
  createFoundationJobRepository,
  type DatabaseClient,
} from "@roco/db";
import {
  createGa4Client,
  createGscClient,
  createPageSpeedClient,
  createServiceAccountTokenProvider,
} from "@roco/integrations";
import {
  CRAWL_SITE_QUEUE,
  GA4_SYNC_QUEUE,
  GOOGLE_SYNC_DISPATCH_QUEUE,
  GSC_BACKFILL_QUEUE,
  GSC_SYNC_QUEUE,
  PAGESPEED_SYNC_QUEUE,
  type Logger,
} from "@roco/shared";

import {
  createFoundationNoopHandler,
  FOUNDATION_NOOP_QUEUE,
} from "./jobs/foundation-noop.js";
import { createCrawlSiteHandler } from "./jobs/crawl-site.js";
import { createGoogleDispatchHandler } from "./jobs/google-dispatch.js";
import {
  createGa4SyncHandler,
  createGscSyncHandler,
  createPageSpeedSyncHandler,
} from "./jobs/google-sync.js";

export interface WorkerRuntime {
  readonly boss: PgBoss;
  readonly database: DatabaseClient;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createWorkerRuntime(
  config: WorkerConfig,
  logger: Logger,
): WorkerRuntime {
  const database = createDatabase(config.DATABASE_URL, {
    application_name: "roco-seo-worker-domain",
  });
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    application_name: "roco-seo-worker-queue",
    max: 5,
  });
  const repository = createFoundationJobRepository(database.db);
  const crawlRepository = createCrawlRepository(database.db);
  const integrationRepository = createIntegrationRepository(database.db);
  const policy = {
    timeoutMs: config.GOOGLE_REQUEST_TIMEOUT_MS,
    retryLimit: config.GOOGLE_RETRY_LIMIT,
    requestsPerSecond: config.GOOGLE_REQUESTS_PER_SECOND,
  };
  const tokenProvider =
    config.GOOGLE_CREDENTIALS_FILE === undefined
      ? {
          getAccessToken(): Promise<string> {
            return Promise.reject(
              new Error("GOOGLE_CREDENTIALS_FILE is not configured."),
            );
          },
        }
      : createServiceAccountTokenProvider({
          credentialFile: config.GOOGLE_CREDENTIALS_FILE,
          scopes: [
            "https://www.googleapis.com/auth/webmasters.readonly",
            "https://www.googleapis.com/auth/analytics.readonly",
          ],
        });
  const gscClient = createGscClient({ tokenProvider, policy });
  const ga4Client = createGa4Client({ tokenProvider, policy });
  const pageSpeedClient = createPageSpeedClient({
    policy,
    ...(config.PAGESPEED_API_KEY === undefined
      ? {}
      : { apiKey: config.PAGESPEED_API_KEY }),
  });
  let started = false;

  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
  });
  boss.on("warning", (warning) => {
    logger.warn({ warning }, "pg-boss warning");
  });

  return {
    boss,
    database,
    async start() {
      if (started) return;
      await database.pool.query("select 1");
      await boss.start();
      await boss.createQueue(FOUNDATION_NOOP_QUEUE, {
        retryLimit: 2,
        retryDelay: 5,
        retryBackoff: true,
        expireInSeconds: 60,
        deleteAfterSeconds: 86_400,
      });
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
        GOOGLE_SYNC_DISPATCH_QUEUE,
      ]) {
        await boss.createQueue(queue, {
          retryLimit: config.GOOGLE_RETRY_LIMIT,
          retryDelay: 60,
          retryBackoff: true,
          expireInSeconds: 3_600,
          deleteAfterSeconds: 604_800,
        });
      }
      await boss.work(
        FOUNDATION_NOOP_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createFoundationNoopHandler({ logger, repository }),
      );
      const gscHandler = createGscSyncHandler({
        logger,
        repository: integrationRepository,
        client: gscClient,
        property: config.GSC_PROPERTY ?? "",
      });
      await boss.work(
        GSC_SYNC_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        gscHandler,
      );
      await boss.work(
        GSC_BACKFILL_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        gscHandler,
      );
      await boss.work(
        GA4_SYNC_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createGa4SyncHandler({
          logger,
          repository: integrationRepository,
          client: ga4Client,
          propertyId: config.GA4_PROPERTY_ID ?? "",
        }),
      );
      await boss.work(
        PAGESPEED_SYNC_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createPageSpeedSyncHandler({
          logger,
          repository: integrationRepository,
          client: pageSpeedClient,
          refreshHours: config.PAGESPEED_REFRESH_HOURS,
        }),
      );
      await boss.work(
        GOOGLE_SYNC_DISPATCH_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createGoogleDispatchHandler({
          logger,
          repository: integrationRepository,
          boss,
          properties: { gsc: config.GSC_PROPERTY, ga4: config.GA4_PROPERTY_ID },
        }),
      );
      await boss.work(
        CRAWL_SITE_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createCrawlSiteHandler({ logger, repository: crawlRepository }),
      );

      if (config.WORKER_HEALTH_JOB_ENABLED) {
        await boss.schedule(
          FOUNDATION_NOOP_QUEUE,
          config.WORKER_HEALTH_JOB_SCHEDULE,
          {},
          { tz: "UTC", key: "foundation-health" },
        );
      }
      if (
        config.GOOGLE_SCHEDULES_ENABLED &&
        config.GOOGLE_SITE_ID !== undefined
      ) {
        if (config.GSC_PROPERTY !== undefined)
          await boss.schedule(
            GOOGLE_SYNC_DISPATCH_QUEUE,
            config.GSC_SYNC_SCHEDULE,
            { provider: "GSC", siteId: config.GOOGLE_SITE_ID },
            { tz: "UTC", key: "daily-gsc" },
          );
        if (config.GA4_PROPERTY_ID !== undefined)
          await boss.schedule(
            GOOGLE_SYNC_DISPATCH_QUEUE,
            config.GA4_SYNC_SCHEDULE,
            { provider: "GA4", siteId: config.GOOGLE_SITE_ID },
            { tz: "UTC", key: "daily-ga4" },
          );
        await boss.schedule(
          GOOGLE_SYNC_DISPATCH_QUEUE,
          config.PAGESPEED_SYNC_SCHEDULE,
          { provider: "PAGESPEED", siteId: config.GOOGLE_SITE_ID },
          { tz: "UTC", key: "weekly-pagespeed" },
        );
      }

      started = true;
      logger.info(
        {
          queue: FOUNDATION_NOOP_QUEUE,
          crawlQueue: CRAWL_SITE_QUEUE,
          googleSchedules: config.GOOGLE_SCHEDULES_ENABLED,
          scheduled: config.WORKER_HEALTH_JOB_ENABLED,
        },
        "worker started",
      );
    },
    async stop() {
      if (!started) {
        await database.close();
        return;
      }
      logger.info("worker shutdown started");
      await boss.stop({
        graceful: true,
        timeout: config.WORKER_SHUTDOWN_TIMEOUT_MS,
        close: true,
      });
      await database.close();
      started = false;
      logger.info("worker shutdown completed");
    },
  };
}
