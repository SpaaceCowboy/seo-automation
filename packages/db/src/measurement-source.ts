import { and, asc, desc, eq, gte, lte, or, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  emptySample,
  sampleSchema,
  type MeasurementSample,
  type MeasurementRule,
} from "@roco/workflow";
import { shiftDate } from "@roco/opportunities";
import * as s from "./schema.js";
type Reader = Pick<NodePgDatabase<typeof s>, "select">;
export async function captureMeasurement(
  db: Reader,
  input: {
    siteId: string;
    pageId: string;
    startDate: string;
    endDate: string;
    rule: MeasurementRule;
    now: Date;
    asOf?: Date;
  },
): Promise<MeasurementSample> {
  const sample = emptySample(input.startDate, input.endDate, input.now);
  const asOf = input.asOf ?? new Date(`${input.endDate}T23:59:59.999Z`);
  const page = (
    await db
      .select()
      .from(s.pages)
      .where(
        and(eq(s.pages.siteId, input.siteId), eq(s.pages.id, input.pageId)),
      )
  )[0];
  if (!page) return sample;
  const matches = (
    table:
      | typeof s.gscPageDaily
      | typeof s.ga4PageDaily
      | typeof s.pagespeedSnapshots,
  ) =>
    or(
      eq(table.pageId, input.pageId),
      eq(table.normalizedUrlHash, page.normalizedUrlHash),
    );
  const gsc = await db
    .select({
      id: s.gscPageDaily.id,
      date: s.gscPageDaily.date,
      clicks: s.gscPageDaily.clicks,
      impressions: s.gscPageDaily.impressions,
      position: s.gscPageDaily.position,
    })
    .from(s.gscPageDaily)
    .innerJoin(
      s.integrationSyncRuns,
      eq(s.integrationSyncRuns.id, s.gscPageDaily.syncRunId),
    )
    .where(
      and(
        eq(s.gscPageDaily.siteId, input.siteId),
        matches(s.gscPageDaily),
        gte(s.gscPageDaily.date, input.startDate),
        lte(s.gscPageDaily.date, input.endDate),
        eq(s.gscPageDaily.searchType, "web"),
        eq(s.gscPageDaily.dataState, "final"),
        eq(s.integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .orderBy(asc(s.gscPageDaily.id))
    .limit(100001);
  const ga4 = await db
    .select({
      id: s.ga4PageDaily.id,
      date: s.ga4PageDaily.date,
      sessions: s.ga4PageDaily.sessions,
      users: s.ga4PageDaily.totalUsers,
      engaged: s.ga4PageDaily.engagedSessions,
      events: s.ga4PageDaily.keyEvents,
    })
    .from(s.ga4PageDaily)
    .innerJoin(
      s.integrationSyncRuns,
      eq(s.integrationSyncRuns.id, s.ga4PageDaily.syncRunId),
    )
    .where(
      and(
        eq(s.ga4PageDaily.siteId, input.siteId),
        matches(s.ga4PageDaily),
        gte(s.ga4PageDaily.date, input.startDate),
        lte(s.ga4PageDaily.date, input.endDate),
        eq(s.ga4PageDaily.channel, "Organic Search"),
        eq(s.ga4PageDaily.dimensionVersion, "ga4-organic-landing-v1"),
        eq(s.integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .orderBy(asc(s.ga4PageDaily.id))
    .limit(100001);
  const syncs = await db
    .select()
    .from(s.integrationSyncRuns)
    .where(
      and(
        eq(s.integrationSyncRuns.siteId, input.siteId),
        eq(s.integrationSyncRuns.status, "SUCCEEDED"),
        lte(s.integrationSyncRuns.startDate, input.endDate),
        gte(s.integrationSyncRuns.endDate, input.startDate),
      ),
    )
    .limit(10001);
  if (gsc.length > 100000 || ga4.length > 100000 || syncs.length > 10000)
    throw new Error("Measurement source budget exceeded.");
  function covered(provider: "GSC" | "GA4") {
    for (
      let day = input.startDate;
      day <= input.endDate;
      day = shiftDate(day, 1)
    )
      if (
        !syncs.some(
          (r) =>
            r.provider === provider &&
            (provider !== "GSC" || r.dimensionSet === "PAGE") &&
            r.startDate !== null &&
            r.endDate !== null &&
            r.startDate <= day &&
            r.endDate >= day,
        )
      )
        return false;
    return true;
  }
  const clicks = gsc.reduce((n, r) => n + r.clicks, 0),
    impressions = gsc.reduce((n, r) => n + r.impressions, 0);
  sample.gsc = {
    values: gsc.length
      ? {
          GSC_CLICKS: clicks,
          GSC_IMPRESSIONS: impressions,
          GSC_CTR: impressions === 0 ? null : clicks / impressions,
          GSC_POSITION:
            impressions === 0
              ? null
              : gsc.reduce((n, r) => n + r.position * r.impressions, 0) /
                impressions,
        }
      : {},
    days: new Set(gsc.map((r) => r.date)).size,
    samples: gsc.length,
    coverage: covered("GSC"),
    sourceIds: gsc.map((r) => r.id),
    collectedAt: null,
  };
  const sessions = ga4.reduce((n, r) => n + r.sessions, 0);
  sample.ga4 = {
    values: ga4.length
      ? {
          GA4_SESSIONS: sessions,
          GA4_DAILY_USERS: ga4.reduce((n, r) => n + r.users, 0),
          GA4_ENGAGEMENT_RATE:
            sessions === 0
              ? null
              : ga4.reduce((n, r) => n + r.engaged, 0) / sessions,
          GA4_KEY_EVENTS: ga4.reduce((n, r) => n + r.events, 0),
        }
      : {},
    days: new Set(ga4.map((r) => r.date)).size,
    samples: ga4.length,
    coverage: covered("GA4"),
    sourceIds: ga4.map((r) => r.id),
    collectedAt: null,
  };
  const psi = await db
    .select()
    .from(s.pagespeedSnapshots)
    .innerJoin(
      s.integrationSyncRuns,
      eq(s.integrationSyncRuns.id, s.pagespeedSnapshots.syncRunId),
    )
    .where(
      and(
        eq(s.pagespeedSnapshots.siteId, input.siteId),
        matches(s.pagespeedSnapshots),
        eq(s.pagespeedSnapshots.strategy, input.rule.strategy),
        gte(
          s.pagespeedSnapshots.collectedAt,
          new Date(`${input.startDate}T00:00:00Z`),
        ),
        lte(s.pagespeedSnapshots.collectedAt, asOf),
        eq(s.integrationSyncRuns.status, "SUCCEEDED"),
      ),
    )
    .limit(100001);
  if (psi.length > 100000) throw new Error("PageSpeed sample budget exceeded.");
  const metricFields = {
    PAGESPEED_PERFORMANCE: "performanceScore",
    PAGESPEED_LCP: "lcpMs",
    PAGESPEED_INP: "inpMs",
    PAGESPEED_CLS: "cls",
  } as const;
  const psiValues: Record<string, number | null> = {};
  let availableCount = 0;
  for (const [metric, field] of Object.entries(metricFields)) {
    const values = psi
      .map((r) => r.pagespeed_snapshots[field])
      .filter((v): v is number => typeof v === "number");
    psiValues[metric] = values.length
      ? values.reduce((n, v) => n + v, 0) / values.length
      : null;
    if (metric === input.rule.primary) availableCount = values.length;
  }
  sample.psi = {
    values: psiValues,
    days: 0,
    samples: availableCount,
    coverage: psi.length > 0,
    sourceIds: psi.map((r) => r.pagespeed_snapshots.id),
    collectedAt: null,
  };
  const snapshot = (
    await db
      .select({ snapshot: s.pageSnapshots, run: s.crawlRuns })
      .from(s.pageSnapshots)
      .innerJoin(s.crawlRuns, eq(s.crawlRuns.id, s.pageSnapshots.crawlRunId))
      .where(
        and(
          eq(s.crawlRuns.siteId, input.siteId),
          eq(s.pageSnapshots.pageId, input.pageId),
          eq(s.crawlRuns.status, "SUCCEEDED"),
          gte(
            s.pageSnapshots.fetchedAt,
            new Date(`${input.startDate}T00:00:00Z`),
          ),
          lte(s.pageSnapshots.fetchedAt, asOf),
          inArray(s.pageSnapshots.fetchStatus, ["SUCCESS", "HTTP_ERROR"]),
        ),
      )
      .orderBy(desc(s.pageSnapshots.fetchedAt), asc(s.pageSnapshots.id))
      .limit(1)
  )[0];
  if (snapshot) {
    const graph = (
      await db
        .select()
        .from(s.pageMetrics)
        .where(
          and(
            eq(s.pageMetrics.crawlRunId, snapshot.run.id),
            eq(s.pageMetrics.pageId, input.pageId),
          ),
        )
    )[0];
    const analysis = (
      await db
        .select()
        .from(s.analysisRuns)
        .where(
          and(
            eq(s.analysisRuns.crawlRunId, snapshot.run.id),
            eq(s.analysisRuns.status, "SUCCEEDED"),
          ),
        )
        .orderBy(desc(s.analysisRuns.startedAt))
        .limit(1)
    )[0];
    const count = analysis
      ? ((
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(s.issueOccurrences)
            .where(
              and(
                eq(s.issueOccurrences.analysisRunId, analysis.id),
                eq(s.issueOccurrences.pageId, input.pageId),
              ),
            )
        )[0]?.count ?? null)
      : null;
    sample.crawl = {
      values: {
        CRAWL_INDEXABILITY: snapshot.snapshot.isIndexable ? 1 : 0,
        CRAWL_DEPTH: graph?.crawlDepth ?? null,
        CRAWL_INCOMING_LINKS: graph?.incomingInternalLinks ?? null,
        TECHNICAL_ISSUES: count,
      },
      days: 1,
      samples: 1,
      coverage: true,
      sourceIds: [
        snapshot.snapshot.id,
        ...(graph ? [graph.id] : []),
        ...(analysis ? [analysis.id] : []),
      ],
      collectedAt: snapshot.snapshot.fetchedAt.toISOString(),
    };
  }
  return sampleSchema.parse(sample);
}
