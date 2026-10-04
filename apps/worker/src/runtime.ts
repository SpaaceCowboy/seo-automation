import { PgBoss } from "pg-boss";

import type { WorkerConfig } from "@roco/config";
import {
  createDatabase,
  createCrawlRepository,
  createFoundationJobRepository,
  type DatabaseClient,
} from "@roco/db";
import { CRAWL_SITE_QUEUE, type Logger } from "@roco/shared";

import {
  createFoundationNoopHandler,
  FOUNDATION_NOOP_QUEUE,
} from "./jobs/foundation-snoop.js";
import { createCrawlSiteHandler } from "./jobs/crawl-site.js";

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
      await boss.work(
        FOUNDATION_NOOP_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createFoundationNoopHandler({ logger, repository }),
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

      started = true;
      logger.info(
        {
          queue: FOUNDATION_NOOP_QUEUE,
          crawlQueue: CRAWL_SITE_QUEUE,
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
