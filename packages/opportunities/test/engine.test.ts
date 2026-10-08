import { describe, expect, it } from "vitest";
import {
  configSchema,
  detectOpportunities,
  nextStatus,
  opportunityKey,
  scoreComponents,
  windows,
  shiftDate,
} from "../src/index.js";
import { config, fixture } from "./fixtures.js";
const run = () => detectOpportunities(fixture(), config);
describe("deterministic opportunity detectors", () => {
  it("detects all six types with provenance and candidate labels", () => {
    const result = run();
    expect(result.statistics.counts).toEqual({
      QUICK_WIN: 2,
      CTR: 1,
      DECAY: 1,
      CANNIBALIZATION_CANDIDATE: 2,
      INTERNAL_LINK: 1,
      CONTENT_GAP_CANDIDATE: 1,
    });
    const quick = result.candidates.find((c) => c.type === "QUICK_WIN")!;
    expect(quick.evidence.metrics).toMatchObject({ impressions: 700, days: 7 });
    expect(quick.evidence.businessValue).toMatchObject({ state: "UNASSIGNED" });
    expect(
      result.candidates
        .filter((c) => c.type.endsWith("CANDIDATE"))
        .every((c) => c.candidateOnly),
    ).toBe(true);
    const ctr = result.candidates.find((c) => c.type === "CTR")!;
    expect(ctr.evidence).toMatchObject({
      expectedCtr: 0.03,
      expectedClickGap: 14,
    });
    expect(
      result.candidates.find((c) => c.type === "DECAY")!.evidence,
    ).toMatchObject({
      signals: { clicks: true, impressions: true, ctr: true, position: true },
    });
  });
  it("uses configured thresholds and scoring rules rather than hidden assumptions", () => {
    const c = configSchema.parse({ ...config, minImpressions: 5000 });
    expect(detectOpportunities(fixture(), c).candidates).toEqual([]);
    const business = configSchema.parse({
      ...config,
      businessRules: [
        { pathPrefix: "/fa", value: 20 },
        { pathPrefix: "/fa/blog", value: 90 },
      ],
    });
    expect(
      detectOpportunities(fixture(), business)
        .candidates.filter((c) => c.url !== null)
        .every((c) => c.components.businessValue === 90),
    ).toBe(true);
    expect(() =>
      configSchema.parse({
        weights: {
          searchDemand: 0,
          impact: 0,
          confidence: 0,
          effort: 0,
          businessValue: 0,
        },
      }),
    ).toThrow();
    expect(() =>
      configSchema.parse({
        ctr: {
          bands: [
            { maxPosition: 10, expectedCtr: 0.1 },
            { maxPosition: 5, expectedCtr: 0.2 },
          ],
        },
      }),
    ).toThrow();
  });
  it("does not detect or evaluate incomplete imports, sparse dates or vanished rows", () => {
    const input = fixture();
    input.coverage = [];
    const missing = detectOpportunities(input, config);
    expect(missing.candidates).toEqual([]);
    expect(missing.evaluatedKeys).toEqual([]);
    expect(missing.statistics.insufficient.PAGE_WINDOW_INCOMPLETE).toBe(1);
    const sparse = fixture();
    sparse.pageMetrics = sparse.pageMetrics.filter(
      (r) => r.date === "2026-09-28",
    );
    sparse.pageQueryMetrics = [];
    expect(detectOpportunities(sparse, config).candidates).toEqual([]);
    expect(detectOpportunities(sparse, config).evaluatedKeys).not.toContain(
      opportunityKey("DECAY", "https://example.test/fa/blog/forex"),
    );
  });
  it("compares impression-weighted position, recomputes CTR, and avoids tiny decay", () => {
    const input = fixture();
    for (const row of input.pageMetrics) {
      row.clicks = 10;
      row.impressions = 100;
      row.position = 5;
    }
    expect(
      detectOpportunities(input, config).candidates.some(
        (c) => c.type === "DECAY",
      ),
    ).toBe(false);
    // One low-impression segment must not receive the same weight as 100 impressions.
    input.pageMetrics.push({
      ...input.pageMetrics[0]!,
      id: "extra",
      clicks: 0,
      impressions: 1,
      position: 100,
    });
    const internal = detectOpportunities(input, config).candidates.find(
      (c) => c.type === "INTERNAL_LINK",
    )!;
    expect(internal.evidence.metrics).toMatchObject({ impressions: 701 });
    expect(
      (internal.evidence.metrics as { position: number }).position,
    ).toBeCloseTo(3600 / 701);
  });
  it("finds deterministic overlap groups and never invents semantic relevance", () => {
    const input = fixture();
    for (const row of [...input.pageQueryMetrics])
      input.pageQueryMetrics.push({
        ...row,
        id: `third-${row.id}`,
        queryId: "third",
        query: "third",
      });
    const groups = detectOpportunities(input, config).candidates.filter(
      (c) => c.evidence.rule === "overlapping_exact_query_sets",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.evidence).toMatchObject({
      jaccard: 1,
      queryIds: ["forex", "gap", "third"],
    });
  });
  it("excludes existing links, unsafe sources, stale crawls and locale-only path matches", () => {
    const input = fixture();
    input.crawl!.edges = [{ id: "edge", source: "source", target: "target" }];
    input.crawl!.pages.find((p) => p.id === "other")!.indexable = false;
    const internal = detectOpportunities(input, config).candidates.find(
      (c) => c.type === "INTERNAL_LINK",
    )!;
    expect(internal.evidence.sources).toEqual([]);
    input.crawl!.finishedAt = "2026-01-01T00:00:00Z";
    expect(
      detectOpportunities(input, config).candidates.some(
        (c) => c.type === "INTERNAL_LINK",
      ),
    ).toBe(false);
  });
  it("is stable under shuffled input and never mixes PAGE and PAGE_QUERY totals", () => {
    const input = fixture();
    input.pageMetrics.reverse();
    input.pageQueryMetrics.reverse();
    expect(detectOpportunities(input, config)).toEqual(run());
    for (const row of input.pageQueryMetrics) row.impressions *= 100;
    expect(
      detectOpportunities(input, config).candidates.find(
        (c) => c.type === "CTR",
      )!.evidence.metrics,
    ).toEqual(run().candidates.find((c) => c.type === "CTR")!.evidence.metrics);
  });
  it("honors query/path exclusions including Persian URLs", () => {
    const c = configSchema.parse({
      ...config,
      excludedPathPrefixes: ["/fa/blog"],
      excludedQueryPatterns: ["forex"],
    });
    expect(detectOpportunities(fixture(), c).candidates).toEqual([]);
    const input = fixture();
    for (const row of input.pageMetrics)
      row.url = "https://example.test/fa/%D9%81%D8%A7%D8%B1%D8%B3%DB%8C";
    expect(
      detectOpportunities(
        input,
        configSchema.parse({ ...config, excludedPathPrefixes: ["/fa/فارسی"] }),
      ).candidates.some((c) => c.type === "CTR" || c.type === "DECAY"),
    ).toBe(false);
  });
  it("rejects malformed inputs and duplicate observations", () => {
    const input = fixture();
    input.pageMetrics.push(input.pageMetrics[0]!);
    expect(() => detectOpportunities(input, config)).toThrow("Duplicate");
    input.pageMetrics[0]!.clicks = NaN;
    expect(() => detectOpportunities(input, config)).toThrow();
  });
});
describe("scoring, lifecycle and windows", () => {
  it("computes the actual weighted score and omits unknown business value", () => {
    const components = {
      searchDemand: 80,
      impact: 60,
      confidence: 50,
      effort: 20,
      businessValue: 100,
    };
    expect(scoreComponents(components, config.weights)).toBe(70);
    expect(
      scoreComponents({ ...components, businessValue: null }, config.weights),
    ).toBe(66.67);
    expect(
      scoreComponents({ ...components, effort: 100 }, config.weights),
    ).toBeLessThan(70);
    expect(
      scoreComponents(components, {
        searchDemand: 0,
        impact: 100,
        confidence: 0,
        effort: 0,
        businessValue: 0,
      }),
    ).toBe(60);
  });
  it("preserves acknowledgement and dismissal, resolves only evaluated evidence and reopens", () => {
    expect(nextStatus("ACKNOWLEDGED", true, true, false)).toBe("ACKNOWLEDGED");
    expect(nextStatus("DISMISSED", true, true, true)).toBe("DISMISSED");
    expect(nextStatus("OPEN", false, false, false)).toBe("OPEN");
    expect(nextStatus("OPEN", false, false, true)).toBe("STALE");
    expect(nextStatus("OPEN", false, true, false)).toBe("RESOLVED");
    expect(nextStatus("RESOLVED", true, true, false)).toBe("OPEN");
  });
  it.each([7, 28, 90])(
    "makes adjacent equivalent-length %i-day windows",
    (days) => {
      const w = windows("2026-09-28", days);
      expect(
        (Date.parse(w.endDate) - Date.parse(w.startDate)) / 86400000 + 1,
      ).toBe(days);
      expect(
        (Date.parse(w.previousEnd) - Date.parse(w.previousStart)) / 86400000 +
          1,
      ).toBe(days);
      expect(Date.parse(w.startDate) - Date.parse(w.previousEnd)).toBe(
        86400000,
      );
    },
  );
});

describe("calibration and bounded historical windows", () => {
  it("backs up ranking decisions with a 100-page historical fixture and weight sensitivity", () => {
    const data = fixture();
    data.crawl = null;
    data.pageMetrics = [];
    data.pageQueryMetrics = [];
    data.ga4 = [];
    for (let page = 0; page < 100; page++)
      for (let day = 0; day < 14; day++) {
        const url = `https://example.test/fa/articles/page-${page}`;
        const date = shiftDate("2026-09-28", -day);
        const row = {
          id: `page-${page}-${day}`,
          syncRunId: "page-sync",
          date,
          url,
          pageId: `page-${page}`,
          queryId: null,
          query: null,
          clicks: 2,
          impressions: 100 + page * 10,
          position: 4 + (page % 6),
        };
        data.pageMetrics.push(row);
        if (day < 7)
          data.pageQueryMetrics.push({
            ...row,
            id: `pair-${page}-${day}`,
            queryId: `query-${page}`,
            query: `query-${page}`,
          });
      }
    const baseline = detectOpportunities(data, config);
    expect(baseline.statistics.counts.QUICK_WIN).toBe(100);
    expect(baseline.statistics.counts.CTR).toBe(100);
    expect(baseline.statistics.counts.DECAY).toBe(0);
    const impactOnly = configSchema.parse({
      ...config,
      weights: {
        searchDemand: 0,
        impact: 100,
        confidence: 0,
        effort: 0,
        businessValue: 0,
      },
    });
    const sensitivity = detectOpportunities(data, impactOnly);
    expect(sensitivity.candidates.map((c) => c.key)).not.toEqual(
      baseline.candidates.map((c) => c.key),
    );
    expect(
      sensitivity.candidates.every(
        (c) => c.score === Math.round(c.components.impact * 100) / 100,
      ),
    ).toBe(true);
    const prior = { ...data, endDate: "2026-09-21" };
    prior.pageQueryMetrics = data.pageQueryMetrics.map((r) => ({
      ...r,
      date: shiftDate(r.date, -7),
    }));
    prior.coverage = [
      ...data.coverage,
      {
        id: "previous-pairs",
        dimensionSet: "PAGE_QUERY",
        startDate: "2026-09-15",
        endDate: "2026-09-21",
      },
    ];
    const backtest = detectOpportunities(prior, config);
    expect(backtest.statistics.counts.QUICK_WIN).toBe(100);
    expect(backtest.statistics.counts.DECAY).toBe(0);
    expect(
      backtest.statistics.insufficient.PREVIOUS_PAGE_WINDOW_INCOMPLETE,
    ).toBe(1);
  });
});

describe("decay evidence integrity", () => {
  it("detects severe decline below the current demand gate using an adequate baseline", () => {
    const data = fixture();
    for (const row of data.pageMetrics)
      if (row.pageId === "target" && row.date >= "2026-09-22") {
        row.impressions = 1;
        row.clicks = 0;
      }
    const result = detectOpportunities(data, config);
    expect(result.candidates.some((c) => c.type === "DECAY")).toBe(true);
    expect(
      result.candidates.find((c) => c.type === "DECAY")!.evidence,
    ).toMatchObject({ baselineImpressions: 1400 });
  });
  it("does not compare unequal observed date sets even when both meet minimum ratios", () => {
    const data = fixture();
    data.pageMetrics = data.pageMetrics.filter(
      (r) => !(r.pageId === "target" && r.date === "2026-09-28"),
    );
    const result = detectOpportunities(data, config);
    expect(result.candidates.some((c) => c.type === "DECAY")).toBe(false);
    expect(
      result.statistics.insufficient.DECAY_PREVIOUS_EVIDENCE_MISSING,
    ).toBeGreaterThan(0);
  });
});
