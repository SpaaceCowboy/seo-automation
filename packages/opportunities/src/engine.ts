import { createHash } from "node:crypto";
import {
  candidateSchema,
  configSchema,
  DETECTOR_VERSION,
  inputSchema,
  opportunityTypeSchema,
  shiftDate,
  windows,
  type Candidate,
  type Components,
  type EngineInput,
  type EngineResult,
  type Metric,
  type OpportunityConfig,
  type OpportunityStatus,
  type OpportunityType,
} from "./contracts.js";

const clamp = (v: number) => Math.max(0, Math.min(100, v));
export function scoreComponents(
  c: Components,
  weights: OpportunityConfig["weights"],
): number {
  const denominator = Object.entries(weights).reduce(
    (sum, [key, w]) =>
      sum + (key === "businessValue" && c.businessValue === null ? 0 : w),
    0,
  );
  if (denominator === 0) return 0;
  const numerator =
    weights.searchDemand * c.searchDemand +
    weights.impact * c.impact +
    weights.confidence * c.confidence +
    weights.effort * (100 - c.effort) +
    (c.businessValue === null ? 0 : weights.businessValue * c.businessValue);
  return Math.round(clamp(numerator / denominator) * 100) / 100;
}
export function nextStatus(
  status: OpportunityStatus,
  detected: boolean,
  evaluated: boolean,
  expired: boolean,
): OpportunityStatus {
  if (status === "DISMISSED") return status;
  if (detected) return status === "ACKNOWLEDGED" ? status : "OPEN";
  if (evaluated) return "RESOLVED";
  return expired && status !== "RESOLVED" ? "STALE" : status;
}
export function opportunityKey(type: OpportunityType, target: string): string {
  return createHash("sha256")
    .update(JSON.stringify([type, target]))
    .digest("hex");
}
interface Aggregate {
  url: string;
  pageId: string | null;
  queryId: string | null;
  query: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  days: number;
  observedDates: string[];
  rowIds: string[];
  syncRunIds: string[];
}
function aggregate(
  rows: Metric[],
  key: (r: Metric) => string,
): Map<string, Aggregate> {
  const groups = new Map<string, Metric[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k) ?? [];
    group.push(row);
    groups.set(k, group);
  }
  const result = new Map<string, Aggregate>();
  for (const [k, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const first = group[0]!;
    const impressions = group.reduce((s, r) => s + r.impressions, 0);
    const clicks = group.reduce((s, r) => s + r.clicks, 0);
    result.set(k, {
      url: first.url,
      pageId: first.pageId,
      queryId: first.queryId,
      query: first.query,
      clicks,
      impressions,
      ctr: impressions === 0 ? 0 : clicks / impressions,
      position:
        impressions === 0
          ? 0
          : group.reduce((s, r) => s + r.position * r.impressions, 0) /
            impressions,
      days: new Set(group.map((r) => r.date)).size,
      observedDates: [...new Set(group.map((r) => r.date))].sort(),
      rowIds: group.map((r) => r.id),
      syncRunIds: [...new Set(group.map((r) => r.syncRunId))].sort(),
    });
  }
  return result;
}
function pathMatches(path: string, prefix: string) {
  return (
    prefix === "/" ||
    path === prefix ||
    path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
  );
}
function businessValue(
  url: string | null,
  c: OpportunityConfig,
): { value: number | null; rule: string | null } {
  if (url === null) return { value: null, rule: null };
  const path = decodeURI(new URL(url).pathname);
  const rule = [...c.businessRules]
    .sort(
      (a, b) =>
        b.pathPrefix.length - a.pathPrefix.length ||
        a.pathPrefix.localeCompare(b.pathPrefix),
    )
    .find((r) => pathMatches(path, r.pathPrefix));
  return { value: rule?.value ?? null, rule: rule?.pathPrefix ?? null };
}
export function detectOpportunities(
  raw: EngineInput,
  rawConfig: OpportunityConfig,
): EngineResult {
  const input = inputSchema.parse(raw);
  const c = configSchema.parse(rawConfig);
  const w = windows(input.endDate, c.windowDays);
  const insufficient: Record<string, number> = {};
  const note = (reason: string) => {
    insufficient[reason] = (insufficient[reason] ?? 0) + 1;
  };
  const covered = (
    dimensionSet: "PAGE" | "PAGE_QUERY",
    start: string,
    end: string,
  ) => {
    for (let date = start; date <= end; date = shiftDate(date, 1))
      if (
        !input.coverage.some(
          (r) =>
            r.dimensionSet === dimensionSet &&
            r.startDate <= date &&
            r.endDate >= date,
        )
      )
        return false;
    return true;
  };
  const coverage = {
    page: covered("PAGE", w.startDate, w.endDate),
    pageQuery: covered("PAGE_QUERY", w.startDate, w.endDate),
    previousPage: covered("PAGE", w.previousStart, w.previousEnd),
  };
  if (!coverage.page) note("PAGE_WINDOW_INCOMPLETE");
  if (!coverage.pageQuery) note("PAGE_QUERY_WINDOW_INCOMPLETE");
  if (!coverage.previousPage) note("PREVIOUS_PAGE_WINDOW_INCOMPLETE");
  const eligible = (r: Metric) => {
    const path = decodeURI(new URL(r.url).pathname);
    return (
      !c.excludedPathPrefixes.some((p) => pathMatches(path, p)) &&
      !(
        r.query &&
        c.excludedQueryPatterns.some((q) =>
          r.query!.toLocaleLowerCase("en").includes(q.toLocaleLowerCase("en")),
        )
      )
    );
  };
  for (const rows of [input.pageMetrics, input.pageQueryMetrics])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error("Duplicate source row IDs");
  const current = (rows: Metric[]) =>
    rows.filter(
      (r) => r.date >= w.startDate && r.date <= w.endDate && eligible(r),
    );
  const pages = aggregate(current(input.pageMetrics), (r) => r.url);
  const currentPairRows = current(input.pageQueryMetrics);
  const rowsByUrl = new Map<string, Metric[]>();
  for (const row of currentPairRows) {
    const rows = rowsByUrl.get(row.url) ?? [];
    rows.push(row);
    rowsByUrl.set(row.url, rows);
  }
  const pairs = aggregate(currentPairRows, (r) =>
    JSON.stringify([r.queryId, r.url]),
  );
  const queries = aggregate(currentPairRows, (r) => r.queryId ?? "");
  const previous = aggregate(
    input.pageMetrics.filter(
      (r) =>
        r.date >= w.previousStart && r.date <= w.previousEnd && eligible(r),
    ),
    (r) => r.url,
  );
  const pairsByQuery = new Map<string, Aggregate[]>();
  const pairsByUrl = new Map<string, Aggregate[]>();
  for (const pair of pairs.values()) {
    if (pair.queryId !== null) {
      const members = pairsByQuery.get(pair.queryId) ?? [];
      members.push(pair);
      pairsByQuery.set(pair.queryId, members);
    }
    const members = pairsByUrl.get(pair.url) ?? [];
    members.push(pair);
    pairsByUrl.set(pair.url, members);
  }
  const crawlPagesById = new Map(
    input.crawl?.pages.map((p) => [p.id, p]) ?? [],
  );
  const existingEdges = new Set(
    input.crawl?.edges.map((e) => JSON.stringify([e.source, e.target])) ?? [],
  );
  if (input.crawl && input.crawl.pages.length > 2000)
    throw new Error("Internal-link source page budget exceeded (2000)");
  const minimumDays = Math.ceil(c.windowDays * c.minObservedDaysRatio);
  const adequate = (a: Aggregate, min = c.minImpressions) =>
    a.days >= minimumDays && a.impressions >= min;
  const candidates: Candidate[] = [];
  const evaluated = new Set<string>();
  const add = (
    type: OpportunityType,
    target: string,
    a: Aggregate,
    impact: number,
    effort: number,
    evidence: Record<string, unknown>,
    candidateOnly = false,
  ) => {
    const key = opportunityKey(type, target);
    const queryGroup =
      type === "CANNIBALIZATION_CANDIDATE" || type === "CONTENT_GAP_CANDIDATE";
    const business = businessValue(queryGroup ? null : a.url, c);
    const demandImpressions =
      type === "DECAY" && typeof evidence.baselineImpressions === "number"
        ? evidence.baselineImpressions
        : a.impressions;
    const components: Components = {
      searchDemand: clamp(
        (100 * Math.log1p(demandImpressions)) / Math.log1p(c.demandSaturation),
      ),
      impact: clamp(impact),
      confidence: clamp(
        (100 *
          Math.min(1, demandImpressions / c.confidenceSaturation) *
          a.days) /
          c.windowDays,
      ),
      effort: c.effortByType[type] ?? effort,
      businessValue: business.value,
    };
    if (candidates.length >= 5000)
      throw new Error("Opportunity budget exceeded (5000)");
    candidates.push(
      candidateSchema.parse({
        key,
        type,
        pageId: queryGroup ? null : a.pageId,
        url: queryGroup ? null : a.url,
        queryId: a.queryId,
        detectorVersion: DETECTOR_VERSION,
        candidateOnly,
        components,
        score: scoreComponents(components, c.weights),
        evidence: {
          ...evidence,
          window: w,
          thresholds: c,
          metrics: {
            ...a,
            url: queryGroup ? null : a.url,
            pageId: queryGroup ? null : a.pageId,
          },
          businessValue: {
            ...business,
            state: business.value === null ? "UNASSIGNED" : "CONFIGURED",
          },
          limitations: [
            "GSC rows may omit anonymized queries or low-volume dimensions.",
            "Scores are prioritization estimates; they do not predict uplift.",
          ],
          sourceDataset:
            type === "CTR" || type === "DECAY" || type === "INTERNAL_LINK"
              ? "PAGE"
              : "PAGE_QUERY",
        },
      }),
    );
    evaluated.add(key);
  };
  if (coverage.pageQuery) {
    for (const [target, a] of pairs) {
      if (a.queryId === null) continue;
      if (!adequate(a)) {
        note("QUERY_PAGE_MINIMUM_EVIDENCE");
        continue;
      }
      evaluated.add(opportunityKey("QUICK_WIN", target));
      if (
        a.position >= c.quickWin.minPosition &&
        a.position <= c.quickWin.maxPosition
      )
        add(
          "QUICK_WIN",
          target,
          a,
          (100 * (c.quickWin.maxPosition - a.position + 1)) /
            (c.quickWin.maxPosition - c.quickWin.minPosition + 1),
          40,
          { rule: "position_band" },
        );
    }
    for (const [queryId, a] of queries) {
      if (!adequate(a)) {
        note("QUERY_MINIMUM_EVIDENCE");
        continue;
      }
      const members = pairsByQuery.get(queryId) ?? [];
      const visible = members.filter(
        (p) =>
          adequate(p, c.cannibalization.minPageImpressions) &&
          p.impressions / a.impressions >= c.cannibalization.minPageShare,
      );
      evaluated.add(opportunityKey("CANNIBALIZATION_CANDIDATE", queryId));
      if (visible.length >= 2)
        add(
          "CANNIBALIZATION_CANDIDATE",
          queryId,
          a,
          60,
          70,
          {
            rule: "shared_exact_query",
            pages: visible.map((p) => ({
              url: p.url,
              pageId: p.pageId,
              impressions: p.impressions,
              share: p.impressions / a.impressions,
              rowIds: p.rowIds,
            })),
            review:
              "Intent and locale differences require later semantic review.",
          },
          true,
        );
      evaluated.add(opportunityKey("CONTENT_GAP_CANDIDATE", queryId));
      if (
        members.length > 0 &&
        members.every((p) => p.position >= c.contentGap.minPosition)
      )
        add(
          "CONTENT_GAP_CANDIDATE",
          queryId,
          a,
          70,
          80,
          {
            rule: "no_strong_visible_landing_page",
            pages: members.map((p) => ({
              url: p.url,
              position: p.position,
              rowIds: p.rowIds,
            })),
            review:
              "Weak visibility is a candidate signal, not proof of missing or unsuitable content.",
          },
          true,
        );
    }
    // Exact shared-query sets provide a deterministic overlap signal; no stemming or semantic grouping.
    const sets = new Map<string, Set<string>>();
    for (const a of pairs.values())
      if (a.queryId && adequate(a, c.cannibalization.minPageImpressions)) {
        const set = sets.get(a.url) ?? new Set<string>();
        set.add(a.queryId);
        sets.set(a.url, set);
      }
    const urls = [...sets.keys()].sort();
    if (urls.length > 500)
      throw new Error("Query-overlap page budget exceeded (500)");
    for (let i = 0; i < urls.length; i++)
      for (let j = i + 1; j < urls.length; j++) {
        const left = urls[i]!;
        const right = urls[j]!;
        const l = sets.get(left)!;
        const r = sets.get(right)!;
        const shared = [...l].filter((q) => r.has(q)).sort();
        const similarity = shared.length / (l.size + r.size - shared.length);
        const target = JSON.stringify([left, right]);
        evaluated.add(opportunityKey("CANNIBALIZATION_CANDIDATE", target));
        if (
          shared.length >= c.cannibalization.minSharedQueries &&
          similarity >= c.cannibalization.minJaccard
        ) {
          const sharedSet = new Set(shared);
          const rows = [
            ...(rowsByUrl.get(left) ?? []),
            ...(rowsByUrl.get(right) ?? []),
          ].filter((row) => row.queryId !== null && sharedSet.has(row.queryId));
          const a = [...aggregate(rows, () => "group").values()][0]!;
          a.queryId = null;
          a.query = null;
          add(
            "CANNIBALIZATION_CANDIDATE",
            target,
            a,
            100 * similarity,
            70,
            {
              rule: "overlapping_exact_query_sets",
              pages: [left, right],
              queryIds: shared,
              jaccard: similarity,
            },
            true,
          );
        }
      }
  }
  if (coverage.page)
    for (const [url, a] of pages) {
      if (a.days < minimumDays) {
        note("PAGE_MINIMUM_EVIDENCE");
        continue;
      }
      if (adequate(a)) {
        evaluated.add(opportunityKey("CTR", url));
        const band = c.ctr.bands.find((b) => a.position <= b.maxPosition);
        if (band && a.ctr < band.expectedCtr * c.ctr.maxRatio)
          add("CTR", url, a, 100 * (1 - a.ctr / band.expectedCtr), 20, {
            rule: "configured_ctr_expectation",
            expectedCtr: band.expectedCtr,
            expectedClickGap: a.impressions * band.expectedCtr - a.clicks,
          });
      } else note("PAGE_DEMAND_BELOW_MINIMUM");
      const before = previous.get(url);
      if (
        coverage.previousPage &&
        before &&
        adequate(before) &&
        before.observedDates
          .map((d) => shiftDate(d, c.windowDays))
          .join(",") === a.observedDates.join(",")
      ) {
        evaluated.add(opportunityKey("DECAY", url));
        const drop = (old: number, now: number) =>
          old === 0 ? 0 : (old - now) / old;
        const signals = {
          clicks:
            before.clicks - a.clicks >= c.decay.minClickLoss &&
            drop(before.clicks, a.clicks) >= c.decay.relativeDrop,
          impressions:
            before.impressions - a.impressions >= c.decay.minImpressionLoss &&
            drop(before.impressions, a.impressions) >= c.decay.relativeDrop,
          ctr:
            before.ctr - a.ctr >= c.decay.minCtrLoss &&
            drop(before.ctr, a.ctr) >= c.decay.relativeDrop,
          position:
            a.position - before.position >= c.decay.minPositionLoss &&
            (before.position === 0
              ? 0
              : (a.position - before.position) / before.position) >=
              c.decay.relativeDrop,
        };
        if (Object.values(signals).some(Boolean))
          add(
            "DECAY",
            url,
            a,
            100 *
              Math.max(
                ...Object.entries(signals)
                  .filter(([, v]) => v)
                  .map(([key]) =>
                    key === "position"
                      ? before.position === 0
                        ? 0
                        : (a.position - before.position) / before.position
                      : drop(
                          before[key as "clicks" | "impressions" | "ctr"],
                          a[key as "clicks" | "impressions" | "ctr"],
                        ),
                  ),
              ),
            50,
            {
              rule: "practical_absolute_and_relative_loss",
              previous: before,
              baselineImpressions: before.impressions,
              signals,
              relativeClickChange:
                before.clicks === 0
                  ? null
                  : (a.clicks - before.clicks) / before.clicks,
              positionLoss: a.position - before.position,
            },
          );
      } else note("DECAY_PREVIOUS_EVIDENCE_MISSING");
      if (!adequate(a)) continue;
      const crawl = input.crawl;
      if (
        !crawl ||
        Date.parse(`${w.endDate}T23:59:59Z`) - Date.parse(crawl.finishedAt) >
          c.links.crawlMaxAgeDays * 86400000
      ) {
        note("LINK_CRAWL_MISSING_OR_OLD");
        continue;
      }
      const target =
        a.pageId === null ? undefined : crawlPagesById.get(a.pageId);
      if (!target || !target.indexable) {
        note("LINK_TARGET_UNOBSERVED_OR_UNSAFE");
        continue;
      }
      evaluated.add(opportunityKey("INTERNAL_LINK", url));
      if (
        target.incoming <= c.links.maxIncoming ||
        target.depth > c.links.excessiveDepth ||
        target.orphan
      ) {
        const segments = (u: string) =>
          new URL(u).pathname.split("/").filter(Boolean);
        const targetSegments = segments(url);
        const sources = crawl.pages
          .filter(
            (p) =>
              p.id !== target.id &&
              p.indexable &&
              !c.excludedPathPrefixes.some((prefix) =>
                pathMatches(new URL(p.url).pathname, prefix),
              ) &&
              !existingEdges.has(JSON.stringify([p.id, target.id])),
          )
          .flatMap((p) => {
            const performance = pages.get(p.url);
            if (
              !performance ||
              !adequate(performance) ||
              performance.clicks < c.links.minSourceClicks
            )
              return [];
            const sourceSegments = segments(p.url);
            const sameSection =
              targetSegments.length >= 2 &&
              sourceSegments.length >= 2 &&
              targetSegments[0] === sourceSegments[0] &&
              targetSegments[1] === sourceSegments[1];
            const targetQueries = new Set(
              (pairsByUrl.get(url) ?? [])
                .filter(
                  (pair) =>
                    pair.url === url &&
                    adequate(pair, c.cannibalization.minPageImpressions),
                )
                .map((pair) => pair.queryId),
            );
            const shared = coverage.pageQuery
              ? (pairsByUrl.get(p.url) ?? [])
                  .filter(
                    (pair) =>
                      pair.url === p.url &&
                      pair.queryId !== null &&
                      targetQueries.has(pair.queryId) &&
                      adequate(pair, c.cannibalization.minPageImpressions),
                  )
                  .map((pair) => pair.queryId)
              : [];
            if (!sameSection && shared.length === 0) return [];
            return [
              {
                pageId: p.id,
                url: p.url,
                clicks: performance.clicks,
                relationship: shared.length
                  ? "shared_exact_query"
                  : "same_path_section",
                queryIds: shared,
                snapshotId: p.snapshotId,
                metricId: p.metricId,
                rowIds: performance.rowIds,
              },
            ];
          })
          .sort((a, b) => b.clicks - a.clicks || a.url.localeCompare(b.url))
          .slice(0, c.links.maxSources);
        add(
          "INTERNAL_LINK",
          url,
          a,
          target.orphan ? 90 : target.depth > c.links.excessiveDepth ? 75 : 60,
          30,
          {
            rule: "weak_observed_link_support",
            crawlRunId: crawl.id,
            snapshotId: target.snapshotId,
            metricId: target.metricId,
            incoming: target.incoming,
            depth: target.depth,
            orphan: target.orphan,
            sources,
            graphCaveat:
              "Bounded crawl: orphan and incoming counts describe observed scope only.",
            ga4: input.ga4.filter((r) => r.pageId === a.pageId),
            pageSpeed: input.pageSpeed.filter((r) => r.pageId === a.pageId),
          },
          true,
        );
      }
    }
  if (candidates.length > 5000)
    throw new Error("Opportunity budget exceeded (5000)");
  const counts = Object.fromEntries(
    opportunityTypeSchema.options.map((t) => [t, 0]),
  ) as Record<OpportunityType, number>;
  for (const candidate of candidates) counts[candidate.type]++;
  return {
    candidates: candidates.sort(
      (a, b) => b.score - a.score || a.key.localeCompare(b.key),
    ),
    evaluatedKeys: [...evaluated].sort(),
    statistics: {
      counts,
      insufficient,
      coverage,
      detectors: [...opportunityTypeSchema.options],
    },
  };
}
