import { createHash } from "node:crypto";

import type { Job, PgBoss } from "pg-boss";
import { z } from "zod";

import type { IntegrationRepository } from "@roco/db";
import {
  GA4_SYNC_QUEUE,
  GSC_SYNC_QUEUE,
  PAGESPEED_SYNC_QUEUE,
  type Logger,
} from "@roco/shared";

const dispatchSchema = z.object({
  provider: z.enum(["GSC", "GA4", "PAGESPEED"]),
  siteId: z.string().uuid(),
});

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createGoogleDispatchHandler(dependencies: {
  logger: Logger;
  repository: IntegrationRepository;
  boss: PgBoss;
  properties: { gsc?: string | undefined; ga4?: string | undefined };
  finalityDays?: number;
  clock?: () => Date;
}) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const data = dispatchSchema.parse(job.data);
      const day = dependencies.clock?.() ?? new Date();
      day.setUTCDate(day.getUTCDate() - (dependencies.finalityDays ?? 3));
      const date = isoDate(day);
      const scope = await dependencies.repository.getSiteScope(data.siteId);
      if (scope === null)
        throw new Error("Scheduled Google sync site does not exist.");
      const correlationId = `scheduled:${data.provider.toLowerCase()}:${date}`;
      if (data.provider === "GSC") {
        if (dependencies.properties.gsc === undefined)
          throw new Error("GSC_PROPERTY is not configured.");
        const accountId = await dependencies.repository.ensureAccount({
          siteId: data.siteId,
          provider: "GSC",
          propertyIdentifier: dependencies.properties.gsc,
        });
        for (const dimensionSet of ["PAGE", "QUERY", "PAGE_QUERY"] as const) {
          const idempotencyKey = `gsc:${data.siteId}:${date}:${dimensionSet}:final`;
          const run = await dependencies.repository.createSyncRun({
            siteId: data.siteId,
            accountId,
            provider: "GSC",
            jobType: "sync-gsc",
            dimensionSet,
            startDate: date,
            endDate: date,
            idempotencyKey,
          });
          if (run.status === "QUEUED")
            await dependencies.boss.send(GSC_SYNC_QUEUE, {
              syncRunId: run.id,
              siteId: data.siteId,
              correlationId,
              startDate: date,
              endDate: date,
              dimensionSet,
            });
        }
      } else if (data.provider === "GA4") {
        if (dependencies.properties.ga4 === undefined)
          throw new Error("GA4_PROPERTY_ID is not configured.");
        const accountId = await dependencies.repository.ensureAccount({
          siteId: data.siteId,
          provider: "GA4",
          propertyIdentifier: dependencies.properties.ga4,
        });
        const run = await dependencies.repository.createSyncRun({
          siteId: data.siteId,
          accountId,
          provider: "GA4",
          jobType: "sync-ga4",
          startDate: date,
          endDate: date,
          idempotencyKey: `ga4:${data.siteId}:${date}:organic-v1`,
        });
        if (run.status === "QUEUED")
          await dependencies.boss.send(GA4_SYNC_QUEUE, {
            syncRunId: run.id,
            siteId: data.siteId,
            correlationId,
            startDate: date,
            endDate: date,
          });
      } else {
        const accountId = await dependencies.repository.ensureAccount({
          siteId: data.siteId,
          provider: "PAGESPEED",
          propertyIdentifier: scope.canonicalOrigin,
        });
        const monday = dependencies.clock?.() ?? new Date();
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const week = isoDate(monday);
        const key = createHash("sha256")
          .update(`${scope.canonicalOrigin}:${week}`)
          .digest("hex");
        const run = await dependencies.repository.createSyncRun({
          siteId: data.siteId,
          accountId,
          provider: "PAGESPEED",
          jobType: "sync-pagespeed",
          idempotencyKey: `pagespeed:${data.siteId}:${key}`,
        });
        if (run.status === "QUEUED")
          await dependencies.boss.send(PAGESPEED_SYNC_QUEUE, {
            syncRunId: run.id,
            siteId: data.siteId,
            correlationId,
            urls: [scope.canonicalOrigin],
            strategies: ["mobile", "desktop"],
          });
      }
      dependencies.logger.info(
        { provider: data.provider, siteId: data.siteId, date },
        "scheduled Google sync dispatched",
      );
    }
  };
}
