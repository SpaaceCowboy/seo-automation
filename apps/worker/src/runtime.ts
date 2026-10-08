import {
  createMeasurementHandler,
  createMeasurementDispatcher,
} from "./jobs/measure-change.js";
import { policySchema, type AgentPolicy } from "@roco/agents";
import { createOpenAiProvider, type LLMProvider } from "@roco/llm";
import { createAnalysisHandler } from "./jobs/analyze-opportunity.js";
import { createDetectionHandler } from "./jobs/detect-opportunities.js";
import { PgBoss } from "pg-boss";
import { startWorkerHealth } from "./health.js";

import type { WorkerConfig } from "@roco/config";
import {
  createDatabase,
  createCrawlRepository,
  createIntegrationRepository,
  createOpportunityRepository,
  createAgentRepository,
  createMeasurementRepository,
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
  OPPORTUNITY_DETECTION_QUEUE,
  AGENT_ANALYSIS_QUEUE,
  CHANGE_MEASUREMENT_QUEUE,
  MEASUREMENT_DISPATCH_QUEUE,
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
  const opportunityRepository = createOpportunityRepository(database.db);
  const agentRepository = createAgentRepository(database.db, database.pool);
  let agentPolicy: AgentPolicy | null = null;
  const agentProviders = new Map<string, LLMProvider>();
  if (config.AGENTS_ENABLED) {
    if (!config.LLM_POLICY_JSON || !config.LLM_OPENAI_API_KEY)
      throw new Error(
        "Enabled agents require LLM_POLICY_JSON and LLM_OPENAI_API_KEY.",
      );
    try {
      agentPolicy = policySchema.parse(JSON.parse(config.LLM_POLICY_JSON));
    } catch {
      throw new Error(
        "LLM_POLICY_JSON does not match the agent policy contract.",
      );
    }
    if (
      (agentPolicy.executionMode === "SUPERVISOR_ONLY"
        ? [agentPolicy.routes.SUPERVISOR]
        : Object.values(agentPolicy.routes)
      ).some(
        (route) =>
          !route ||
          route.provider !== "openai" ||
          route.inputNanousdPerToken <= 0 ||
          route.outputNanousdPerToken <= 0,
      )
    )
      throw new Error(
        "Runtime routes require the installed OpenAI adapter and explicit positive token pricing.",
      );
    agentProviders.set(
      "openai",
      createOpenAiProvider(config.LLM_OPENAI_API_KEY),
    );
  }
  const measurements = createMeasurementRepository(database.db);
  if (
    config.WORKFLOW_SCHEDULES_ENABLED &&
    !config.WORKFLOW_MEASUREMENT_ACTOR_ID
  )
    throw new Error("Enabled measurement schedules require a service actor.");
  let started = false;
  let stopHealth: (() => Promise<void>) | undefined;
  database.pool.on("error", (error) =>
    logger.error({ err: error }, "worker database connection failed"),
  );

  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
  });
  boss.on("warning", (warning) => {
    logger.warn(
      { errorCode: "QUEUE_WARNING", warningType: typeof warning },
      "pg-boss warning",
    );
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
      await boss.createQueue(OPPORTUNITY_DETECTION_QUEUE, {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 1800,
        deleteAfterSeconds: 604800,
      });
      await boss.work(
        OPPORTUNITY_DETECTION_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createDetectionHandler({ repository: opportunityRepository, logger }),
      );
      await boss.createQueue(AGENT_ANALYSIS_QUEUE, {
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 1800,
        deleteAfterSeconds: 604800,
      });
      await boss.work(
        AGENT_ANALYSIS_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createAnalysisHandler({
          repository: agentRepository,
          policy: agentPolicy,
          providers: agentProviders,
          logger,
        }),
      );
      for (const queue of [
        CHANGE_MEASUREMENT_QUEUE,
        MEASUREMENT_DISPATCH_QUEUE,
      ])
        await boss.createQueue(queue, {
          retryLimit: 2,
          retryDelay: 30,
          retryBackoff: true,
          expireInSeconds: 1800,
          deleteAfterSeconds: 604800,
        });
      await boss.work(
        CHANGE_MEASUREMENT_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createMeasurementHandler({ repository: measurements, logger }),
      );
      await boss.work(
        MEASUREMENT_DISPATCH_QUEUE,
        { batchSize: 1, pollingIntervalSeconds: 2 },
        createMeasurementDispatcher({
          repository: measurements,
          boss,
          actorId: config.WORKFLOW_MEASUREMENT_ACTOR_ID,
          logger,
        }),
      );
      if (config.WORKFLOW_SCHEDULES_ENABLED)
        await boss.schedule(
          MEASUREMENT_DISPATCH_QUEUE,
          config.WORKFLOW_MEASUREMENT_SCHEDULE,
          {},
          { tz: "UTC", key: "measurement-dispatch" },
        );
      else
        await boss.unschedule(
          MEASUREMENT_DISPATCH_QUEUE,
          "measurement-dispatch",
        );
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
          finalityDays: config.GOOGLE_FINALITY_DAYS,
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
      } else await boss.unschedule(FOUNDATION_NOOP_QUEUE, "foundation-health");
      // Reconcile persisted schedules on every boot, including disabled/reconfigured properties.
      for (const [key, enabled] of [
        ["daily-gsc", config.GOOGLE_SCHEDULES_ENABLED && !!config.GSC_PROPERTY],
        [
          "daily-ga4",
          config.GOOGLE_SCHEDULES_ENABLED && !!config.GA4_PROPERTY_ID,
        ],
        ["weekly-pagespeed", config.GOOGLE_SCHEDULES_ENABLED],
      ] as const)
        if (!enabled) await boss.unschedule(GOOGLE_SYNC_DISPATCH_QUEUE, key);
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
      if (config.NODE_ENV !== "test")
        stopHealth = startWorkerHealth(
          config.WORKER_HEALTH_FILE,
          database,
          logger,
        );
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
      await stopHealth?.();
      logger.info("worker shutdown started");
      try {
        await boss.stop({
          graceful: started,
          timeout: config.WORKER_SHUTDOWN_TIMEOUT_MS,
          close: true,
        });
      } finally {
        await database.close();
      }
      started = false;
      logger.info("worker shutdown completed");
    },
  };
}
