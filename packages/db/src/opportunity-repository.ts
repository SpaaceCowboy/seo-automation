import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  configSchema,
  DETECTOR_VERSION,
  inputSchema,
  nextStatus,
  safeEndDate,
  windows,
  type EngineInput,
  type EngineResult,
  type ListFilter,
  type StatusChange,
  type OpportunityConfig,
} from "@roco/opportunities";
import * as schema from "./schema.js";
const {
  scoringConfigs,
  opportunityRuns,
  opportunities,
  opportunityScores,
  opportunityEvents,
  sites,
  gscPageDaily,
  gscPageQueryDaily,
  integrationSyncRuns,
  searchQueries,
  crawlRuns,
  pages,
  pageSnapshots,
  pageMetrics,
  linkEdges,
  ga4PageDaily,
  pagespeedSnapshots,
} = schema;
type Database = NodePgDatabase<typeof schema>;
type Run = typeof opportunityRuns.$inferSelect;
export interface OpportunityRepository {
  previewInput(
    siteId: string,
    endDate: string,
    config: OpportunityConfig,
  ): Promise<EngineInput>;
  changeStatus(
    input: StatusChange & {
      siteId: string;
      id: string;
      actorId: string;
      correlationId: string;
    },
  ): Promise<void>;
  createRun(input: {
    siteId: string;
    endDate?: string | undefined;
    config: OpportunityConfig;
    idempotencyKey?: string | undefined;
    correlationId: string;
  }): Promise<Run>;
  getRun(id: string): Promise<Run | null>;
  captureInput(
    this: void,
    id: string,
  ): Promise<{
    run: Run;
    config: OpportunityConfig;
    input: EngineInput;
  } | null>;
  persistResult(
    this: void,
    id: string,
    result: EngineResult,
    durationMs: number,
  ): Promise<void>;
  fail(this: void, id: string): Promise<void>;
  list(siteId: string, filter: ListFilter): Promise<unknown>;
  detail(siteId: string, id: string): Promise<unknown>;
}
async function loadOpportunityInput(
  tx: Pick<Database, "select">,
  run: Pick<Run, "siteId" | "endDate">,
  c: OpportunityConfig,
): Promise<EngineInput> {
  const w = windows(run.endDate, c.windowDays);
  const pageRows = await tx
    .select({
      id: gscPageDaily.id,
      syncRunId: gscPageDaily.syncRunId,
      date: gscPageDaily.date,
      url: gscPageDaily.normalizedUrl,
      pageId: gscPageDaily.pageId,
      clicks: gscPageDaily.clicks,
      impressions: gscPageDaily.impressions,
      position: gscPageDaily.position,
    })
    .from(gscPageDaily)
    .innerJoin(
      integrationSyncRuns,
      eq(integrationSyncRuns.id, gscPageDaily.syncRunId),
    )
    .where(
      and(
        eq(gscPageDaily.siteId, run.siteId),
        gte(gscPageDaily.date, w.previousStart),
        lte(gscPageDaily.date, w.endDate),
        eq(gscPageDaily.dataState, "final"),
        eq(gscPageDaily.searchType, "web"),
        eq(integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .orderBy(asc(gscPageDaily.id))
    .limit(100001);
  const pairs = await tx
    .select({
      id: gscPageQueryDaily.id,
      syncRunId: gscPageQueryDaily.syncRunId,
      date: gscPageQueryDaily.date,
      url: gscPageQueryDaily.normalizedUrl,
      pageId: gscPageQueryDaily.pageId,
      queryId: gscPageQueryDaily.queryId,
      query: searchQueries.displayQuery,
      clicks: gscPageQueryDaily.clicks,
      impressions: gscPageQueryDaily.impressions,
      position: gscPageQueryDaily.position,
    })
    .from(gscPageQueryDaily)
    .innerJoin(searchQueries, eq(searchQueries.id, gscPageQueryDaily.queryId))
    .innerJoin(
      integrationSyncRuns,
      eq(integrationSyncRuns.id, gscPageQueryDaily.syncRunId),
    )
    .where(
      and(
        eq(gscPageQueryDaily.siteId, run.siteId),
        gte(gscPageQueryDaily.date, w.startDate),
        lte(gscPageQueryDaily.date, w.endDate),
        eq(gscPageQueryDaily.dataState, "final"),
        eq(gscPageQueryDaily.searchType, "web"),
        eq(integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .orderBy(asc(gscPageQueryDaily.id))
    .limit(100001);
  const syncs = await tx
    .select({
      id: integrationSyncRuns.id,
      dimensionSet: integrationSyncRuns.dimensionSet,
      startDate: integrationSyncRuns.startDate,
      endDate: integrationSyncRuns.endDate,
    })
    .from(integrationSyncRuns)
    .where(
      and(
        eq(integrationSyncRuns.siteId, run.siteId),
        eq(integrationSyncRuns.provider, "GSC"),
        eq(integrationSyncRuns.status, "SUCCEEDED"),
        gte(integrationSyncRuns.endDate, w.previousStart),
        lte(integrationSyncRuns.startDate, w.endDate),
      ),
    )
    .limit(10001);
  const crawl = (
    await tx
      .select()
      .from(crawlRuns)
      .where(
        and(
          eq(crawlRuns.siteId, run.siteId),
          eq(crawlRuns.status, "SUCCEEDED"),
          isNotNull(crawlRuns.finishedAt),
          lte(crawlRuns.finishedAt, new Date(`${w.endDate}T23:59:59Z`)),
        ),
      )
      .orderBy(desc(crawlRuns.finishedAt), asc(crawlRuns.id))
      .limit(1)
  )[0];
  const crawlPages = crawl
    ? await tx
        .select({
          id: pages.id,
          url: pages.normalizedUrl,
          snapshotId: pageSnapshots.id,
          metricId: pageMetrics.id,
          indexable: pageSnapshots.isIndexable,
          incoming: pageMetrics.incomingInternalLinks,
          depth: pageMetrics.crawlDepth,
          orphan: pageMetrics.isOrphan,
        })
        .from(pageSnapshots)
        .innerJoin(pages, eq(pages.id, pageSnapshots.pageId))
        .innerJoin(
          pageMetrics,
          and(
            eq(pageMetrics.crawlRunId, pageSnapshots.crawlRunId),
            eq(pageMetrics.pageId, pageSnapshots.pageId),
          ),
        )
        .where(
          and(
            eq(pageSnapshots.crawlRunId, crawl.id),
            eq(pages.siteId, run.siteId),
          ),
        )
        .limit(100001)
    : [];
  const edges = crawl
    ? await tx
        .select({
          id: linkEdges.id,
          source: linkEdges.sourcePageId,
          target: linkEdges.targetPageId,
        })
        .from(linkEdges)
        .where(
          and(
            eq(linkEdges.crawlRunId, crawl.id),
            eq(linkEdges.isInternal, true),
            isNotNull(linkEdges.targetPageId),
          ),
        )
        .limit(100001)
    : [];
  const ga4 = await tx
    .select({
      id: ga4PageDaily.id,
      pageId: ga4PageDaily.pageId,
      sessions: ga4PageDaily.sessions,
      engagedSessions: ga4PageDaily.engagedSessions,
      keyEvents: ga4PageDaily.keyEvents,
    })
    .from(ga4PageDaily)
    .innerJoin(
      integrationSyncRuns,
      eq(integrationSyncRuns.id, ga4PageDaily.syncRunId),
    )
    .where(
      and(
        eq(ga4PageDaily.siteId, run.siteId),
        gte(ga4PageDaily.date, w.startDate),
        lte(ga4PageDaily.date, w.endDate),
        eq(ga4PageDaily.channel, "Organic Search"),
        eq(ga4PageDaily.dimensionVersion, "ga4-organic-landing-v1"),
        eq(integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .limit(100001);
  const speed = await tx
    .select({
      id: pagespeedSnapshots.id,
      pageId: pagespeedSnapshots.pageId,
      strategy: pagespeedSnapshots.strategy,
      collectedAt: pagespeedSnapshots.collectedAt,
      performanceScore: pagespeedSnapshots.performanceScore,
      fieldLcpMs: pagespeedSnapshots.fieldLcpMs,
      fieldInpMs: pagespeedSnapshots.fieldInpMs,
      fieldCls: pagespeedSnapshots.fieldCls,
    })
    .from(pagespeedSnapshots)
    .innerJoin(
      integrationSyncRuns,
      eq(integrationSyncRuns.id, pagespeedSnapshots.syncRunId),
    )
    .where(
      and(
        eq(pagespeedSnapshots.siteId, run.siteId),
        gte(
          pagespeedSnapshots.collectedAt,
          new Date(`${w.startDate}T00:00:00Z`),
        ),
        lte(pagespeedSnapshots.collectedAt, new Date(`${w.endDate}T23:59:59Z`)),
        eq(integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .limit(100001);
  return inputSchema.parse({
    endDate: run.endDate,
    pageMetrics: pageRows.map((r) => ({
      ...r,
      queryId: null,
      query: null,
    })),
    pageQueryMetrics: pairs,
    coverage: syncs.filter(
      (r) => r.dimensionSet === "PAGE" || r.dimensionSet === "PAGE_QUERY",
    ),
    crawl: crawl
      ? {
          id: crawl.id,
          finishedAt: crawl.finishedAt!.toISOString(),
          pages: crawlPages,
          edges,
        }
      : null,
    ga4,
    pageSpeed: speed.map((r) => ({
      ...r,
      collectedAt: r.collectedAt.toISOString(),
    })),
  });
}
export function createOpportunityRepository(
  db: Database,
): OpportunityRepository {
  return {
    async previewInput(siteId, endDate, config) {
      return db.transaction(
        async (tx) => {
          await tx.execute(sql`set local statement_timeout = '30s'`);
          return loadOpportunityInput(
            tx,
            { siteId, endDate },
            configSchema.parse(config),
          );
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async changeStatus(input) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${input.siteId}))`,
        );
        const actor = (
          await tx
            .select()
            .from(schema.actors)
            .where(
              and(
                eq(schema.actors.id, input.actorId),
                sql`${schema.actors.disabledAt} is null`,
              ),
            )
        )[0];
        if (!actor)
          throw new Error("An active configured operator actor is required.");
        const opportunity = (
          await tx
            .select()
            .from(opportunities)
            .where(
              and(
                eq(opportunities.id, input.id),
                eq(opportunities.siteId, input.siteId),
              ),
            )
            .for("update")
        )[0];
        if (!opportunity) throw new Error("Opportunity not found.");
        if (opportunity.status === input.status) return;
        if (opportunity.status !== input.expectedStatus)
          throw new Error(
            "Opportunity status changed; reload before retrying.",
          );
        await tx
          .update(opportunities)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(opportunities.id, opportunity.id));
        await tx.insert(schema.auditEvents).values({
          actorId: input.actorId,
          action: "opportunity.status.changed",
          subjectType: "opportunity",
          subjectId: opportunity.id,
          correlationId: input.correlationId,
          metadata: {
            fromStatus: opportunity.status,
            toStatus: input.status,
            reason: input.reason,
          },
        });
      });
    },
    async createRun(input) {
      const c = configSchema.parse(input.config);
      const now = new Date();
      const endDate = input.endDate ?? safeEndDate(now, c.lagDays);
      if (endDate > safeEndDate(now, c.lagDays))
        throw new Error(
          "The window includes potentially incomplete recent dates.",
        );
      const w = windows(endDate, c.windowDays);
      const hash = createHash("sha256").update(JSON.stringify(c)).digest("hex");
      const key =
        input.idempotencyKey ?? `detect:${endDate}:${hash}:${DETECTOR_VERSION}`;
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        const site = (
          await tx
            .select()
            .from(sites)
            .where(and(eq(sites.id, input.siteId), eq(sites.status, "ACTIVE")))
        )[0];
        if (!site) throw new Error("An active registered site is required.");
        await tx
          .insert(scoringConfigs)
          .values({
            siteId: input.siteId,
            contentHash: hash,
            version: c.version,
            configuration: c,
          })
          .onConflictDoNothing();
        const config = (
          await tx
            .select()
            .from(scoringConfigs)
            .where(
              and(
                eq(scoringConfigs.siteId, input.siteId),
                eq(scoringConfigs.contentHash, hash),
              ),
            )
        )[0]!;
        await tx
          .insert(opportunityRuns)
          .values({
            siteId: input.siteId,
            configId: config.id,
            idempotencyKey: key,
            detectorVersion: DETECTOR_VERSION,
            startDate: w.startDate,
            endDate,
            correlationId: input.correlationId,
          })
          .onConflictDoNothing();
        const run = (
          await tx
            .select()
            .from(opportunityRuns)
            .where(
              and(
                eq(opportunityRuns.siteId, input.siteId),
                eq(opportunityRuns.idempotencyKey, key),
              ),
            )
        )[0]!;
        if (
          run.configId !== config.id ||
          run.endDate !== endDate ||
          run.detectorVersion !== DETECTOR_VERSION
        )
          throw new Error(
            "Idempotency key already belongs to a different detection command.",
          );
        return run;
      });
    },
    async getRun(id) {
      return (
        (
          await db
            .select()
            .from(opportunityRuns)
            .where(eq(opportunityRuns.id, id))
        )[0] ?? null
      );
    },
    async captureInput(id) {
      return db.transaction(
        async (tx) => {
          await tx.execute(sql`set local statement_timeout = '30s'`);
          const run = (
            await tx
              .select()
              .from(opportunityRuns)
              .where(eq(opportunityRuns.id, id))
              .for("update")
          )[0];
          if (!run || run.status === "SUCCEEDED") return null;
          const stored = (
            await tx
              .select()
              .from(scoringConfigs)
              .where(eq(scoringConfigs.id, run.configId))
          )[0]!;
          const c = configSchema.parse(stored.configuration);
          let input: EngineInput;
          if (run.inputSnapshot !== null)
            input = inputSchema.parse(run.inputSnapshot);
          else {
            input = await loadOpportunityInput(tx, run, c);
          }
          await tx
            .update(opportunityRuns)
            .set({
              status: "RUNNING",
              finishedAt: null,
              inputSnapshot: input,
              attemptCount: sql`${opportunityRuns.attemptCount}+1`,
              startedAt: run.startedAt ?? new Date(),
              errorCode: null,
              errorMessage: null,
            })
            .where(eq(opportunityRuns.id, id));
          return { run, config: c, input };
        },
        { isolationLevel: "repeatable read" },
      );
    },
    async persistResult(id, result, durationMs) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '30s'`);
        const initial = (
          await tx
            .select()
            .from(opportunityRuns)
            .where(eq(opportunityRuns.id, id))
        )[0];
        if (!initial) throw new Error("Detection run not found.");
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${initial.siteId}))`,
        );
        const run = (
          await tx
            .select()
            .from(opportunityRuns)
            .where(eq(opportunityRuns.id, id))
            .for("update")
        )[0]!;
        if (run.status === "SUCCEEDED") return;
        const config = (
          await tx
            .select()
            .from(scoringConfigs)
            .where(eq(scoringConfigs.id, run.configId))
        )[0]!;
        const newer = (
          await tx
            .select()
            .from(opportunityRuns)
            .where(
              and(
                eq(opportunityRuns.siteId, run.siteId),
                eq(opportunityRuns.status, "SUCCEEDED"),
                sql`(${opportunityRuns.endDate}, ${opportunityRuns.createdAt}, ${opportunityRuns.id}) > (${run.endDate}::date, ${run.createdAt}::timestamptz, ${run.id}::uuid)`,
              ),
            )
            .limit(1)
        )[0];
        const projectionSkipped = newer !== undefined;
        const now = new Date();
        let created = 0,
          updated = 0,
          resolved = 0,
          staled = 0;
        const existing = await tx
          .select()
          .from(opportunities)
          .where(eq(opportunities.siteId, run.siteId));
        const byKey = new Map(existing.map((o) => [o.fingerprint, o]));
        const detected = new Set(result.candidates.map((c) => c.key));
        for (const candidate of result.candidates) {
          let opportunity = byKey.get(candidate.key);
          if (!opportunity) {
            // Historical runs keep evidence without replacing a newer current projection.
            const rows = await tx
              .insert(opportunities)
              .values({
                siteId: run.siteId,
                fingerprint: candidate.key,
                type: candidate.type,
                pageId: candidate.pageId,
                queryId: candidate.queryId,
                url: candidate.url,
                score: candidate.score,
                lastRunId: run.id,
                status: projectionSkipped ? "STALE" : "OPEN",
              })
              .returning();
            opportunity = rows[0]!;
            created++;
            await tx.insert(opportunityEvents).values({
              opportunityId: opportunity.id,
              runId: run.id,
              toStatus: opportunity.status,
              reason: projectionSkipped ? "HISTORICAL_DETECTION" : "DETECTED",
            });
          } else if (!projectionSkipped) {
            const status = nextStatus(opportunity.status, true, true, false);
            await tx
              .update(opportunities)
              .set({
                status,
                score: candidate.score,
                lastRunId: run.id,
                lastDetectedAt: now,
                updatedAt: now,
                pageId: candidate.pageId,
                queryId: candidate.queryId,
                url: candidate.url,
              })
              .where(eq(opportunities.id, opportunity.id));
            updated++;
            if (status !== opportunity.status)
              await tx.insert(opportunityEvents).values({
                opportunityId: opportunity.id,
                runId: run.id,
                fromStatus: opportunity.status,
                toStatus: status,
                reason: "REDETECTED",
              });
          }
          await tx
            .insert(opportunityScores)
            .values({
              opportunityId: opportunity.id,
              runId: run.id,
              configId: run.configId,
              score: candidate.score,
              observation: candidate,
            })
            .onConflictDoNothing();
        }
        if (!projectionSkipped)
          for (const opportunity of existing) {
            if (detected.has(opportunity.fingerprint)) continue;
            const evaluated = result.evaluatedKeys.includes(
              opportunity.fingerprint,
            );
            const expired =
              now.getTime() - opportunity.lastDetectedAt.getTime() >
              config.configuration.staleAfterDays * 86400000;
            const status = nextStatus(
              opportunity.status,
              false,
              evaluated,
              expired,
            );
            if (status === opportunity.status) continue;
            await tx
              .update(opportunities)
              .set({ status, lastRunId: run.id, updatedAt: now })
              .where(eq(opportunities.id, opportunity.id));
            await tx.insert(opportunityEvents).values({
              opportunityId: opportunity.id,
              runId: run.id,
              fromStatus: opportunity.status,
              toStatus: status,
              reason: evaluated
                ? "EVIDENCE_NO_LONGER_MEETS_RULE"
                : "EVIDENCE_EXPIRED",
            });
            if (status === "RESOLVED") resolved++;
            if (status === "STALE") staled++;
          }
        await tx
          .update(opportunityRuns)
          .set({
            status: "SUCCEEDED",
            finishedAt: now,
            errorCode: null,
            errorMessage: null,
            statistics: {
              ...result.statistics,
              created,
              updated,
              resolved,
              staled,
              projectionSkipped,
              durationMs,
            },
          })
          .where(eq(opportunityRuns.id, id));
      });
    },
    async fail(id) {
      await db
        .update(opportunityRuns)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorCode: "DETECTION_FAILED",
          errorMessage:
            "Opportunity detection failed. Inspect correlated worker logs; retry uses the frozen input.",
        })
        .where(
          and(
            eq(opportunityRuns.id, id),
            sql`${opportunityRuns.status} <> 'SUCCEEDED'`,
          ),
        );
    },
    async list(siteId, filter) {
      const conditions = [eq(opportunities.siteId, siteId)];
      if (filter.type) conditions.push(eq(opportunities.type, filter.type));
      if (filter.status)
        conditions.push(eq(opportunities.status, filter.status));
      if (filter.minScore !== undefined)
        conditions.push(gte(opportunities.score, filter.minScore));
      if (filter.pageId)
        conditions.push(eq(opportunities.pageId, filter.pageId));
      const items = await db
        .select()
        .from(opportunities)
        .where(and(...conditions))
        .orderBy(desc(opportunities.score), asc(opportunities.id))
        .limit(filter.limit + 1)
        .offset(filter.offset);
      return {
        items: items.slice(0, filter.limit),
        hasMore: items.length > filter.limit,
        limit: filter.limit,
        offset: filter.offset,
      };
    },
    async detail(siteId, id) {
      const opportunity = (
        await db
          .select()
          .from(opportunities)
          .where(
            and(eq(opportunities.id, id), eq(opportunities.siteId, siteId)),
          )
      )[0];
      if (!opportunity) return null;
      const scores = await db
        .select()
        .from(opportunityScores)
        .where(eq(opportunityScores.opportunityId, id))
        .orderBy(desc(opportunityScores.createdAt), desc(opportunityScores.id))
        .limit(100);
      const events = await db
        .select()
        .from(opportunityEvents)
        .where(eq(opportunityEvents.opportunityId, id))
        .orderBy(desc(opportunityEvents.createdAt), desc(opportunityEvents.id))
        .limit(100);
      const decisions = await db
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.subjectType, "opportunity"),
            eq(schema.auditEvents.subjectId, id),
          ),
        )
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(100);
      return {
        ...opportunity,
        decisions,
        observations: scores,
        events,
        historyLimit: 100,
      };
    },
  };
}
