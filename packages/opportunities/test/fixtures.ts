import {
  configSchema,
  shiftDate,
  type EngineInput,
  type Metric,
} from "../src/index.js";
export const config = configSchema.parse({ windowDays: 7 });
export function fixture(): EngineInput {
  const pageMetrics: Metric[] = [];
  const pageQueryMetrics: Metric[] = [];
  for (let day = 0; day < 14; day++) {
    const date = shiftDate("2026-09-28", -day);
    const current = day < 7;
    for (const [pageId, path, clicks, impressions, position] of [
      [
        "target",
        "/fa/blog/forex",
        current ? 1 : 40,
        current ? 100 : 200,
        current ? 6 : 2,
      ],
      ["other", "/fa/blog/trading", 10, 100, 8],
      ["source", "/fa/blog/guide", 50, 100, 2],
    ] as const)
      pageMetrics.push({
        id: `${pageId}-${day}`,
        syncRunId: "page-sync",
        date,
        url: `https://example.test${path}`,
        pageId,
        queryId: null,
        query: null,
        clicks,
        impressions,
        position,
      });
    if (current)
      for (const [pageId, path, queryId, position] of [
        ["target", "/fa/blog/forex", "forex", 6],
        ["other", "/fa/blog/trading", "forex", 8],
        ["target", "/fa/blog/forex", "gap", 25],
        ["other", "/fa/blog/trading", "gap", 26],
      ] as const)
        pageQueryMetrics.push({
          id: `${pageId}-${queryId}-${day}`,
          syncRunId: "pair-sync",
          date,
          url: `https://example.test${path}`,
          pageId,
          queryId,
          query: queryId,
          clicks: 1,
          impressions: 100,
          position,
        });
  }
  return {
    endDate: "2026-09-28",
    pageMetrics,
    pageQueryMetrics,
    coverage: [
      {
        id: "page-sync",
        dimensionSet: "PAGE",
        startDate: "2026-09-15",
        endDate: "2026-09-28",
      },
      {
        id: "pair-sync",
        dimensionSet: "PAGE_QUERY",
        startDate: "2026-09-22",
        endDate: "2026-09-28",
      },
    ],
    crawl: {
      id: "crawl",
      finishedAt: "2026-09-28T10:00:00Z",
      pages: [
        {
          id: "target",
          snapshotId: "target-snapshot",
          metricId: "target-graph",
          url: "https://example.test/fa/blog/forex",
          indexable: true,
          incoming: 0,
          depth: 5,
          orphan: true,
        },
        {
          id: "other",
          snapshotId: "other-snapshot",
          metricId: "other-graph",
          url: "https://example.test/fa/blog/trading",
          indexable: true,
          incoming: 5,
          depth: 2,
          orphan: false,
        },
        {
          id: "source",
          snapshotId: "source-snapshot",
          metricId: "source-graph",
          url: "https://example.test/fa/blog/guide",
          indexable: true,
          incoming: 10,
          depth: 1,
          orphan: false,
        },
      ],
      edges: [],
    },
    ga4: [
      {
        id: "ga4",
        pageId: "target",
        sessions: 70,
        engagedSessions: 40,
        keyEvents: 3,
      },
    ],
    pageSpeed: [],
  };
}
