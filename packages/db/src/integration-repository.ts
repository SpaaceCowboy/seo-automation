import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  Ga4MetricRow,
  GoogleProvider,
  GscMetricRow,
  PageSpeedSnapshot,
  UrlMappingResult,
} from "@roco/integrations";

import * as schema from "./schema.js";

export interface IntegrationSyncRunRecord {
  readonly id: string;
  readonly siteId: string;
  readonly provider: GoogleProvider;
  readonly jobType: string;
  readonly dimensionSet: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: string;
  readonly idempotencyKey: string;
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly requestCount: number;
  readonly unmatchedUrlCount: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface MappedGscMetric extends GscMetricRow {
  readonly urlMapping: UrlMappingResult | null;
}

export interface MappedGa4Metric extends Ga4MetricRow {
  readonly urlMapping: UrlMappingResult;
}

export interface MappedPageSpeedSnapshot extends PageSpeedSnapshot {
  readonly urlMapping: UrlMappingResult;
}

export interface IntegrationRepository {
  getSiteScope(siteId: string): Promise<{
    canonicalOrigin: string;
    allowedHosts: { host: string; includeSubdomains: boolean }[];
  } | null>;
  ensureAccount(input: {
    siteId: string;
    provider: GoogleProvider;
    propertyIdentifier: string;
    credentialReference?: string | undefined;
  }): Promise<string>;
  createSyncRun(input: {
    siteId: string;
    accountId?: string | undefined;
    provider: GoogleProvider;
    jobType: string;
    dimensionSet?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    idempotencyKey: string;
  }): Promise<IntegrationSyncRunRecord>;
  getSyncRun(id: string): Promise<IntegrationSyncRunRecord | null>;
  markRunning(id: string): Promise<boolean>;
  complete(
    id: string,
    summary: {
      rowsRead: number;
      rowsWritten: number;
      requestCount: number;
      unmatchedUrlCount: number;
      details?: Record<string, unknown>;
    },
  ): Promise<void>;
  fail(id: string, code: string, safeMessage: string): Promise<void>;
  persistGscRows(
    syncRunId: string,
    siteId: string,
    rows: readonly MappedGscMetric[],
  ): Promise<number>;
  persistGa4Rows(
    syncRunId: string,
    siteId: string,
    rows: readonly MappedGa4Metric[],
  ): Promise<number>;
  persistPageSpeed(
    syncRunId: string,
    siteId: string,
    snapshot: MappedPageSpeedSnapshot,
  ): Promise<number>;
  recordUnmatchedUrls(
    syncRunId: string,
    siteId: string,
    provider: GoogleProvider,
    rows: readonly {
      observedUrl: string;
      reason: string;
      dimensionSet?: string | undefined;
      observedDate?: string | undefined;
    }[],
  ): Promise<void>;
  hasRecentPageSpeed(
    siteId: string,
    normalizedUrlHash: string,
    strategy: string,
    since: Date,
  ): Promise<boolean>;
  latestFreshness(siteId: string): Promise<
    {
      provider: GoogleProvider;
      lastSuccess: Date | null;
      startDate: string | null;
      endDate: string | null;
      lastFailure: {
        code: string | null;
        message: string | null;
        at: Date;
      } | null;
      currentStatus: string | null;
    }[]
  >;
}

function toRun(
  row: typeof schema.integrationSyncRuns.$inferSelect,
): IntegrationSyncRunRecord {
  return {
    id: row.id,
    siteId: row.siteId,
    provider: row.provider,
    jobType: row.jobType,
    dimensionSet: row.dimensionSet,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    rowsRead: row.rowsRead,
    rowsWritten: row.rowsWritten,
    requestCount: row.requestCount,
    unmatchedUrlCount: row.unmatchedUrlCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function createIntegrationRepository(
  db: NodePgDatabase<typeof schema>,
): IntegrationRepository {
  async function findPage(
    siteId: string,
    hash: string | null,
  ): Promise<string | null> {
    if (hash === null) return null;
    const [page] = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(
        and(
          eq(schema.pages.siteId, siteId),
          eq(schema.pages.normalizedUrlHash, hash),
        ),
      )
      .limit(1);
    return page?.id ?? null;
  }

  async function ensureQuery(
    siteId: string,
    displayQuery: string,
    normalizedQuery: string,
    queryHash: string,
  ): Promise<string> {
    const [inserted] = await db
      .insert(schema.searchQueries)
      .values({ siteId, displayQuery, normalizedQuery, queryHash })
      .onConflictDoNothing({
        target: [schema.searchQueries.siteId, schema.searchQueries.queryHash],
      })
      .returning({ id: schema.searchQueries.id });
    if (inserted !== undefined) return inserted.id;
    const [existing] = await db
      .select({ id: schema.searchQueries.id })
      .from(schema.searchQueries)
      .where(
        and(
          eq(schema.searchQueries.siteId, siteId),
          eq(schema.searchQueries.queryHash, queryHash),
        ),
      )
      .limit(1);
    if (existing === undefined)
      throw new Error("Failed to resolve search query identity.");
    return existing.id;
  }

  return {
    async getSiteScope(siteId) {
      const [site] = await db
        .select({ canonicalOrigin: schema.sites.canonicalOrigin })
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .limit(1);
      if (site === undefined) return null;
      const hosts = await db
        .select({
          host: schema.siteHosts.host,
          includeSubdomains: schema.siteHosts.includeSubdomains,
        })
        .from(schema.siteHosts)
        .where(eq(schema.siteHosts.siteId, siteId));
      return { canonicalOrigin: site.canonicalOrigin, allowedHosts: hosts };
    },
    async ensureAccount(input) {
      const [inserted] = await db
        .insert(schema.integrationAccounts)
        .values({
          siteId: input.siteId,
          provider: input.provider,
          propertyIdentifier: input.propertyIdentifier,
          credentialReference: input.credentialReference,
        })
        .onConflictDoUpdate({
          target: [
            schema.integrationAccounts.siteId,
            schema.integrationAccounts.provider,
            schema.integrationAccounts.propertyIdentifier,
          ],
          set: {
            credentialReference: input.credentialReference,
            status: "ACTIVE",
            updatedAt: new Date(),
          },
        })
        .returning({ id: schema.integrationAccounts.id });
      if (inserted === undefined)
        throw new Error("Failed to create integration account.");
      return inserted.id;
    },
    async createSyncRun(input) {
      const [inserted] = await db
        .insert(schema.integrationSyncRuns)
        .values({
          siteId: input.siteId,
          accountId: input.accountId,
          provider: input.provider,
          jobType: input.jobType,
          dimensionSet: input.dimensionSet,
          startDate: input.startDate,
          endDate: input.endDate,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({
          target: schema.integrationSyncRuns.idempotencyKey,
        })
        .returning();
      if (inserted !== undefined) return toRun(inserted);
      const [existing] = await db
        .select()
        .from(schema.integrationSyncRuns)
        .where(
          eq(schema.integrationSyncRuns.idempotencyKey, input.idempotencyKey),
        )
        .limit(1);
      if (existing === undefined)
        throw new Error("Failed to resolve integration sync run.");
      return toRun(existing);
    },
    async getSyncRun(id) {
      const [row] = await db
        .select()
        .from(schema.integrationSyncRuns)
        .where(eq(schema.integrationSyncRuns.id, id))
        .limit(1);
      return row === undefined ? null : toRun(row);
    },
    async markRunning(id) {
      const updated = await db
        .update(schema.integrationSyncRuns)
        .set({
          status: "RUNNING",
          startedAt: new Date(),
          finishedAt: null,
          updatedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        })
        .where(
          and(
            eq(schema.integrationSyncRuns.id, id),
            inArray(schema.integrationSyncRuns.status, [
              "QUEUED",
              "RUNNING",
              "FAILED",
              "PARTIAL",
            ]),
          ),
        )
        .returning({ id: schema.integrationSyncRuns.id });
      return updated.length === 1;
    },
    async complete(id, summary) {
      await db
        .update(schema.integrationSyncRuns)
        .set({
          status: "SUCCEEDED",
          rowsRead: summary.rowsRead,
          rowsWritten: summary.rowsWritten,
          requestCount: summary.requestCount,
          unmatchedUrlCount: summary.unmatchedUrlCount,
          summary: summary.details ?? {},
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationSyncRuns.id, id));
    },
    async fail(id, code, safeMessage) {
      await db
        .update(schema.integrationSyncRuns)
        .set({
          status: "FAILED",
          errorCode: code,
          errorMessage: safeMessage,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.integrationSyncRuns.id, id));
    },
    async persistGscRows(syncRunId, siteId, rows) {
      let written = 0;
      await db.transaction(async (tx) => {
        for (const row of rows) {
          const mapping = row.urlMapping;
          const pageId =
            mapping === null
              ? null
              : await findPage(siteId, mapping.normalizedUrlHash);
          const metric = {
            syncRunId,
            siteId,
            date: row.date,
            country: row.country,
            device: row.device,
            searchType: row.searchType,
            dataState: row.dataState,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
            updatedAt: new Date(),
          };
          if (
            row.dimensionSet === "PAGE" &&
            mapping !== null &&
            mapping.normalizedUrl !== null &&
            mapping.normalizedUrlHash !== null &&
            mapping.normalizationVersion !== null
          ) {
            await tx
              .insert(schema.gscPageDaily)
              .values({
                ...metric,
                pageId,
                observedUrl: row.page ?? "",
                normalizedUrl: mapping.normalizedUrl,
                normalizedUrlHash: mapping.normalizedUrlHash,
                normalizationVersion: mapping.normalizationVersion,
              })
              .onConflictDoUpdate({
                target: [
                  schema.gscPageDaily.siteId,
                  schema.gscPageDaily.date,
                  schema.gscPageDaily.normalizedUrlHash,
                  schema.gscPageDaily.country,
                  schema.gscPageDaily.device,
                  schema.gscPageDaily.searchType,
                  schema.gscPageDaily.dataState,
                ],
                set: { ...metric, pageId },
              });
            written += 1;
          } else if (row.dimensionSet === "QUERY" && row.query !== null) {
            const normalizedQuery = row.query
              .trim()
              .normalize("NFC")
              .replace(/\s+/g, " ")
              .toLocaleLowerCase();
            const queryHash = await import("node:crypto").then(
              ({ createHash }) =>
                createHash("sha256").update(normalizedQuery).digest("hex"),
            );
            const queryId = await ensureQuery(
              siteId,
              row.query,
              normalizedQuery,
              queryHash,
            );
            await tx
              .insert(schema.gscQueryDaily)
              .values({ ...metric, queryId })
              .onConflictDoUpdate({
                target: [
                  schema.gscQueryDaily.siteId,
                  schema.gscQueryDaily.date,
                  schema.gscQueryDaily.queryId,
                  schema.gscQueryDaily.country,
                  schema.gscQueryDaily.device,
                  schema.gscQueryDaily.searchType,
                  schema.gscQueryDaily.dataState,
                ],
                set: metric,
              });
            written += 1;
          } else if (
            row.dimensionSet === "PAGE_QUERY" &&
            row.query !== null &&
            mapping !== null &&
            mapping.normalizedUrl !== null &&
            mapping.normalizedUrlHash !== null &&
            mapping.normalizationVersion !== null
          ) {
            const normalizedQuery = row.query
              .trim()
              .normalize("NFC")
              .replace(/\s+/g, " ")
              .toLocaleLowerCase();
            const queryHash = await import("node:crypto").then(
              ({ createHash }) =>
                createHash("sha256").update(normalizedQuery).digest("hex"),
            );
            const queryId = await ensureQuery(
              siteId,
              row.query,
              normalizedQuery,
              queryHash,
            );
            await tx
              .insert(schema.gscPageQueryDaily)
              .values({
                ...metric,
                pageId,
                queryId,
                observedUrl: row.page ?? "",
                normalizedUrl: mapping.normalizedUrl,
                normalizedUrlHash: mapping.normalizedUrlHash,
                normalizationVersion: mapping.normalizationVersion,
              })
              .onConflictDoUpdate({
                target: [
                  schema.gscPageQueryDaily.siteId,
                  schema.gscPageQueryDaily.date,
                  schema.gscPageQueryDaily.normalizedUrlHash,
                  schema.gscPageQueryDaily.queryId,
                  schema.gscPageQueryDaily.country,
                  schema.gscPageQueryDaily.device,
                  schema.gscPageQueryDaily.searchType,
                  schema.gscPageQueryDaily.dataState,
                ],
                set: { ...metric, pageId },
              });
            written += 1;
          }
        }
      });
      return written;
    },
    async persistGa4Rows(syncRunId, siteId, rows) {
      let written = 0;
      for (const row of rows) {
        const mapping = row.urlMapping;
        if (
          mapping.normalizedUrl === null ||
          mapping.normalizedUrlHash === null ||
          mapping.normalizationVersion === null
        )
          continue;
        const pageId = await findPage(siteId, mapping.normalizedUrlHash);
        const values = {
          syncRunId,
          siteId,
          pageId,
          date: row.date,
          observedLandingPage: row.landingPage,
          normalizedUrl: mapping.normalizedUrl,
          normalizedUrlHash: mapping.normalizedUrlHash,
          normalizationVersion: mapping.normalizationVersion,
          channel: row.channel,
          dimensionVersion: "ga4-organic-landing-v1",
          sessions: row.sessions,
          totalUsers: row.totalUsers,
          engagedSessions: row.engagedSessions,
          engagementRate: row.engagementRate,
          keyEvents: row.keyEvents,
          updatedAt: new Date(),
        };
        await db
          .insert(schema.ga4PageDaily)
          .values(values)
          .onConflictDoUpdate({
            target: [
              schema.ga4PageDaily.siteId,
              schema.ga4PageDaily.date,
              schema.ga4PageDaily.normalizedUrlHash,
              schema.ga4PageDaily.channel,
              schema.ga4PageDaily.dimensionVersion,
            ],
            set: values,
          });
        written += 1;
      }
      return written;
    },
    async persistPageSpeed(syncRunId, siteId, snapshot) {
      const mapping = snapshot.urlMapping;
      if (
        mapping.normalizedUrl === null ||
        mapping.normalizedUrlHash === null ||
        mapping.normalizationVersion === null
      )
        return 0;
      const pageId = await findPage(siteId, mapping.normalizedUrlHash);
      await db
        .insert(schema.pagespeedSnapshots)
        .values({
          syncRunId,
          siteId,
          pageId,
          observedUrl: snapshot.url,
          normalizedUrl: mapping.normalizedUrl,
          normalizedUrlHash: mapping.normalizedUrlHash,
          normalizationVersion: mapping.normalizationVersion,
          strategy: snapshot.strategy,
          collectedAt: snapshot.collectedAt,
          performanceScore: snapshot.performanceScore,
          lcpMs: snapshot.lcpMs,
          inpMs: snapshot.inpMs,
          cls: snapshot.cls,
          fieldLcpMs: snapshot.fieldLcpMs,
          fieldInpMs: snapshot.fieldInpMs,
          fieldCls: snapshot.fieldCls,
          fieldDataAvailable: snapshot.fieldDataAvailable,
          lighthouseVersion: snapshot.lighthouseVersion,
          apiVersion: snapshot.apiVersion,
        })
        .onConflictDoNothing({
          target: [
            schema.pagespeedSnapshots.siteId,
            schema.pagespeedSnapshots.normalizedUrlHash,
            schema.pagespeedSnapshots.strategy,
            schema.pagespeedSnapshots.collectedAt,
          ],
        });
      return 1;
    },
    async hasRecentPageSpeed(siteId, normalizedUrlHash, strategy, since) {
      const [row] = await db
        .select({ id: schema.pagespeedSnapshots.id })
        .from(schema.pagespeedSnapshots)
        .where(
          and(
            eq(schema.pagespeedSnapshots.siteId, siteId),
            eq(schema.pagespeedSnapshots.normalizedUrlHash, normalizedUrlHash),
            eq(schema.pagespeedSnapshots.strategy, strategy),
            gte(schema.pagespeedSnapshots.collectedAt, since),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    async recordUnmatchedUrls(syncRunId, siteId, provider, rows) {
      if (rows.length === 0) return;
      await db
        .insert(schema.integrationUnmatchedUrls)
        .values(
          rows.map((row) => ({
            syncRunId,
            siteId,
            provider,
            observedUrl: row.observedUrl,
            reason: row.reason,
            dimensionSet: row.dimensionSet,
            observedDate: row.observedDate,
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.integrationUnmatchedUrls.syncRunId,
            schema.integrationUnmatchedUrls.provider,
            schema.integrationUnmatchedUrls.observedUrl,
            schema.integrationUnmatchedUrls.reason,
          ],
        });
    },
    async latestFreshness(siteId) {
      const providers: GoogleProvider[] = ["GSC", "GA4", "PAGESPEED"];
      return Promise.all(
        providers.map(async (provider) => {
          const rows = await db
            .select()
            .from(schema.integrationSyncRuns)
            .where(
              and(
                eq(schema.integrationSyncRuns.siteId, siteId),
                eq(schema.integrationSyncRuns.provider, provider),
              ),
            )
            .orderBy(desc(schema.integrationSyncRuns.createdAt))
            .limit(50);
          const success = rows.find((row) => row.status === "SUCCEEDED");
          const failure = rows.find((row) => row.status === "FAILED");
          return {
            provider,
            lastSuccess: success?.finishedAt ?? null,
            startDate: success?.startDate ?? null,
            endDate: success?.endDate ?? null,
            lastFailure:
              failure === undefined
                ? null
                : {
                    code: failure.errorCode,
                    message: failure.errorMessage,
                    at: failure.finishedAt ?? failure.updatedAt,
                  },
            currentStatus: rows[0]?.status ?? null,
          };
        }),
      );
    },
  };
}
