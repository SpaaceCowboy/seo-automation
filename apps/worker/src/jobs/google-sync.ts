import { z } from "zod";
import type { Job } from "pg-boss";

import type { IntegrationRepository } from "@roco/db";
import {
  mapGoogleUrl,
  type Ga4MetricRow,
  type GscDimensionSet,
  type GscMetricRow,
  type PageSpeedSnapshot,
  type PageSpeedStrategy,
} from "@roco/integrations";
import type { Logger } from "@roco/shared";

const baseSchema = z.object({
  syncRunId: z.string().uuid(),
  siteId: z.string().uuid(),
  correlationId: z.string().min(1),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
});
const gscSchema = baseSchema.extend({
  dimensionSet: z.enum(["PAGE", "QUERY", "PAGE_QUERY"]),
});
const pagespeedJobSchema = baseSchema.extend({
  urls: z.array(z.string().url()).min(1).max(20),
  strategies: z
    .array(z.enum(["mobile", "desktop"]))
    .min(1)
    .max(2),
});

export interface GscClientPort {
  queryAll(input: {
    property: string;
    startDate: string;
    endDate: string;
    dimensionSet: GscDimensionSet;
    dataState: "final";
  }): Promise<{ rows: GscMetricRow[]; requestCount: number }>;
}
export interface Ga4ClientPort {
  queryOrganicLandingPages(input: {
    propertyId: string;
    startDate: string;
    endDate: string;
  }): Promise<{ rows: Ga4MetricRow[]; requestCount: number }>;
}
export interface PageSpeedClientPort {
  inspect(url: string, strategy: PageSpeedStrategy): Promise<PageSpeedSnapshot>;
}

interface CommonDependencies {
  readonly logger: Logger;
  readonly repository: IntegrationRepository;
}

function safeSyncQueueFailure(code: string): Error {
  // Do not persist provider bodies or original database errors in pg-boss output.
  return new Error(code, { cause: new Error(code) });
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof z.ZodError)
    return {
      code: "INVALID_PROVIDER_RESPONSE",
      message:
        "Google returned a response that did not match the expected contract.",
    };
  if (error instanceof Error && error.name === "GoogleApiError")
    return {
      code: "GOOGLE_API_ERROR",
      message:
        "Google rejected the request; verify property access, quota and correlated status.",
    };
  return {
    code: "SYNC_FAILED",
    message:
      "The Google synchronization failed. Review structured worker logs.",
  };
}

export function createGscSyncHandler(
  dependencies: CommonDependencies & {
    client: GscClientPort;
    property: string;
  },
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const data = gscSchema.parse(job.data);
      const run = await dependencies.repository.getSyncRun(data.syncRunId);
      if (run === null || run.status === "SUCCEEDED") continue;
      if (
        run.siteId !== data.siteId ||
        run.provider !== "GSC" ||
        run.dimensionSet !== data.dimensionSet
      )
        throw new Error("INVALID_SYNC_CONTEXT");
      if (!(await dependencies.repository.markRunning(run.id))) continue;
      try {
        const scope = await dependencies.repository.getSiteScope(data.siteId);
        if (scope === null) throw new Error("Site scope is unavailable.");
        const result = await dependencies.client.queryAll({
          property: dependencies.property,
          startDate: data.startDate ?? run.startDate ?? "",
          endDate: data.endDate ?? run.endDate ?? "",
          dimensionSet: data.dimensionSet,
          dataState: "final",
        });
        const mapped = result.rows.map((row) => ({
          ...row,
          urlMapping: row.page === null ? null : mapGoogleUrl(row.page, scope),
        }));
        const unmatchedUrlCount = mapped.filter(
          (row) => row.urlMapping !== null && !row.urlMapping.matchedScope,
        ).length;
        await dependencies.repository.recordUnmatchedUrls(
          run.id,
          data.siteId,
          "GSC",
          mapped.flatMap((row) =>
            row.urlMapping !== null && !row.urlMapping.matchedScope
              ? [
                  {
                    observedUrl: row.page ?? "",
                    reason: row.urlMapping.reason,
                    dimensionSet: data.dimensionSet,
                    observedDate: row.date,
                  },
                ]
              : [],
          ),
        );
        const rowsWritten = await dependencies.repository.persistGscRows(
          run.id,
          data.siteId,
          mapped,
        );
        await dependencies.repository.complete(run.id, {
          rowsRead: result.rows.length,
          rowsWritten,
          requestCount: result.requestCount,
          unmatchedUrlCount,
          details: { dimensionSet: data.dimensionSet },
        });
        dependencies.logger.info(
          {
            syncRunId: run.id,
            siteId: data.siteId,
            rowsRead: result.rows.length,
            rowsWritten,
            unmatchedUrlCount,
          },
          "GSC sync completed",
        );
      } catch (error) {
        const failure = safeFailure(error);
        await dependencies.repository.fail(
          run.id,
          failure.code,
          failure.message,
        );
        dependencies.logger.error(
          { err: error, syncRunId: run.id, siteId: data.siteId },
          "GSC sync failed",
        );
        throw safeSyncQueueFailure(failure.code);
      }
    }
  };
}

export function createGa4SyncHandler(
  dependencies: CommonDependencies & {
    client: Ga4ClientPort;
    propertyId: string;
  },
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const data = baseSchema.parse(job.data);
      const run = await dependencies.repository.getSyncRun(data.syncRunId);
      if (run === null || run.status === "SUCCEEDED") continue;
      if (run.siteId !== data.siteId || run.provider !== "GA4")
        throw new Error("INVALID_SYNC_CONTEXT");
      if (!(await dependencies.repository.markRunning(run.id))) continue;
      try {
        const scope = await dependencies.repository.getSiteScope(data.siteId);
        if (scope === null) throw new Error("Site scope is unavailable.");
        const result = await dependencies.client.queryOrganicLandingPages({
          propertyId: dependencies.propertyId,
          startDate: data.startDate ?? run.startDate ?? "",
          endDate: data.endDate ?? run.endDate ?? "",
        });
        const mapped = result.rows.map((row) => ({
          ...row,
          urlMapping: mapGoogleUrl(row.landingPage, scope),
        }));
        const unmatchedUrlCount = mapped.filter(
          (row) => !row.urlMapping.matchedScope,
        ).length;
        await dependencies.repository.recordUnmatchedUrls(
          run.id,
          data.siteId,
          "GA4",
          mapped
            .filter((row) => !row.urlMapping.matchedScope)
            .map((row) => ({
              observedUrl: row.landingPage,
              reason: row.urlMapping.reason,
              observedDate: row.date,
            })),
        );
        const rowsWritten = await dependencies.repository.persistGa4Rows(
          run.id,
          data.siteId,
          mapped,
        );
        await dependencies.repository.complete(run.id, {
          rowsRead: result.rows.length,
          rowsWritten,
          requestCount: result.requestCount,
          unmatchedUrlCount,
          details: {
            channel: "Organic Search",
            dimensionVersion: "ga4-organic-landing-v1",
          },
        });
        dependencies.logger.info(
          { syncRunId: run.id, siteId: data.siteId, rowsWritten },
          "GA4 sync completed",
        );
      } catch (error) {
        const failure = safeFailure(error);
        await dependencies.repository.fail(
          run.id,
          failure.code,
          failure.message,
        );
        dependencies.logger.error(
          { err: error, syncRunId: run.id, siteId: data.siteId },
          "GA4 sync failed",
        );
        throw safeSyncQueueFailure(failure.code);
      }
    }
  };
}

export function createPageSpeedSyncHandler(
  dependencies: CommonDependencies & {
    client: PageSpeedClientPort;
    refreshHours: number;
  },
) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const data = pagespeedJobSchema.parse(job.data);
      const run = await dependencies.repository.getSyncRun(data.syncRunId);
      if (run === null || run.status === "SUCCEEDED") continue;
      if (run.siteId !== data.siteId || run.provider !== "PAGESPEED")
        throw new Error("INVALID_SYNC_CONTEXT");
      if (!(await dependencies.repository.markRunning(run.id))) continue;
      try {
        const scope = await dependencies.repository.getSiteScope(data.siteId);
        if (scope === null) throw new Error("Site scope is unavailable.");
        let rowsWritten = 0;
        let unmatchedUrlCount = 0;
        let skippedRecent = 0;
        let requestCount = 0;
        for (const url of [...new Set(data.urls)]) {
          const urlMapping = mapGoogleUrl(url, scope);
          if (
            !urlMapping.matchedScope ||
            urlMapping.normalizedUrlHash === null
          ) {
            unmatchedUrlCount += 1;
            await dependencies.repository.recordUnmatchedUrls(
              run.id,
              data.siteId,
              "PAGESPEED",
              [{ observedUrl: url, reason: urlMapping.reason }],
            );
            continue;
          }
          for (const strategy of [...new Set(data.strategies)]) {
            const since = new Date(
              Date.now() - dependencies.refreshHours * 3_600_000,
            );
            if (
              await dependencies.repository.hasRecentPageSpeed(
                data.siteId,
                urlMapping.normalizedUrlHash,
                strategy,
                since,
              )
            ) {
              skippedRecent += 1;
              continue;
            }
            const snapshot = await dependencies.client.inspect(url, strategy);
            requestCount += 1;
            rowsWritten += await dependencies.repository.persistPageSpeed(
              run.id,
              data.siteId,
              { ...snapshot, urlMapping },
            );
          }
        }
        await dependencies.repository.complete(run.id, {
          rowsRead: data.urls.length * data.strategies.length,
          rowsWritten,
          requestCount,
          unmatchedUrlCount,
          details: { strategies: data.strategies, skippedRecent },
        });
        dependencies.logger.info(
          { syncRunId: run.id, siteId: data.siteId, rowsWritten },
          "PageSpeed sync completed",
        );
      } catch (error) {
        const failure = safeFailure(error);
        await dependencies.repository.fail(
          run.id,
          failure.code,
          failure.message,
        );
        dependencies.logger.error(
          { err: error, syncRunId: run.id, siteId: data.siteId },
          "PageSpeed sync failed",
        );
        throw safeSyncQueueFailure(failure.code);
      }
    }
  };
}
