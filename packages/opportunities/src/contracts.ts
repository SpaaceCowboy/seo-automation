import { z } from "zod";

export const DETECTOR_VERSION = "opportunities-v1";
export const opportunityTypeSchema = z.enum([
  "QUICK_WIN",
  "CTR",
  "DECAY",
  "CANNIBALIZATION_CANDIDATE",
  "INTERNAL_LINK",
  "CONTENT_GAP_CANDIDATE",
]);
export const opportunityStatusSchema = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "DISMISSED",
  "STALE",
]);
export type OpportunityType = z.infer<typeof opportunityTypeSchema>;
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;
const percentage = z.number().finite().min(0).max(1);
const component = z.number().finite().min(0).max(100);
export const configSchema = z
  .strictObject({
    version: z.string().min(1).max(100).default("default-v1"),
    windowDays: z
      .union([z.literal(7), z.literal(28), z.literal(90)])
      .default(28),
    lagDays: z.number().int().min(3).max(30).default(3),
    minObservedDaysRatio: percentage.default(0.7),
    minImpressions: z.number().positive().default(200),
    quickWin: z
      .strictObject({
        minPosition: z.number().min(1).default(4),
        maxPosition: z.number().min(1).default(20),
      })
      .default({ minPosition: 4, maxPosition: 20 }),
    ctr: z
      .strictObject({
        maxRatio: percentage.default(0.6),
        bands: z
          .array(
            z.strictObject({
              maxPosition: z.number().min(1),
              expectedCtr: percentage,
            }),
          )
          .min(1)
          .max(20)
          .default([
            { maxPosition: 3, expectedCtr: 0.12 },
            { maxPosition: 5, expectedCtr: 0.06 },
            { maxPosition: 10, expectedCtr: 0.03 },
          ]),
      })
      .default({
        maxRatio: 0.6,
        bands: [
          { maxPosition: 3, expectedCtr: 0.12 },
          { maxPosition: 5, expectedCtr: 0.06 },
          { maxPosition: 10, expectedCtr: 0.03 },
        ],
      }),
    decay: z
      .strictObject({
        relativeDrop: percentage.default(0.3),
        minClickLoss: z.number().positive().default(20),
        minImpressionLoss: z.number().positive().default(100),
        minCtrLoss: percentage.default(0.01),
        minPositionLoss: z.number().positive().default(3),
      })
      .default({
        relativeDrop: 0.3,
        minClickLoss: 20,
        minImpressionLoss: 100,
        minCtrLoss: 0.01,
        minPositionLoss: 3,
      }),
    cannibalization: z
      .strictObject({
        minPageShare: percentage.default(0.2),
        minPageImpressions: z.number().positive().default(100),
        minSharedQueries: z.number().int().min(2).default(3),
        minJaccard: percentage.default(0.5),
      })
      .default({
        minPageShare: 0.2,
        minPageImpressions: 100,
        minSharedQueries: 3,
        minJaccard: 0.5,
      }),
    contentGap: z
      .strictObject({ minPosition: z.number().min(1).default(20) })
      .default({ minPosition: 20 }),
    links: z
      .strictObject({
        maxIncoming: z.number().int().min(0).default(2),
        excessiveDepth: z.number().int().min(1).default(4),
        minSourceClicks: z.number().min(0).default(20),
        maxSources: z.number().int().min(1).max(20).default(5),
        crawlMaxAgeDays: z.number().int().min(1).max(90).default(30),
      })
      .default({
        maxIncoming: 2,
        excessiveDepth: 4,
        minSourceClicks: 20,
        maxSources: 5,
        crawlMaxAgeDays: 30,
      }),
    demandSaturation: z.number().positive().default(10000),
    confidenceSaturation: z.number().positive().default(2000),
    staleAfterDays: z.number().int().min(1).max(365).default(90),
    businessRules: z
      .array(
        z.strictObject({
          pathPrefix: z.string().startsWith("/").max(500),
          value: component,
        }),
      )
      .max(100)
      .default([]),
    excludedPathPrefixes: z
      .array(z.string().startsWith("/"))
      .max(100)
      .default(["/login", "/logout", "/account"]),
    excludedQueryPatterns: z
      .array(z.string().min(1).max(100))
      .max(100)
      .default([]),
    effortByType: z
      .strictObject({
        QUICK_WIN: component.default(40),
        CTR: component.default(20),
        DECAY: component.default(50),
        CANNIBALIZATION_CANDIDATE: component.default(70),
        INTERNAL_LINK: component.default(30),
        CONTENT_GAP_CANDIDATE: component.default(80),
      })
      .default({
        QUICK_WIN: 40,
        CTR: 20,
        DECAY: 50,
        CANNIBALIZATION_CANDIDATE: 70,
        INTERNAL_LINK: 30,
        CONTENT_GAP_CANDIDATE: 80,
      }),
    weights: z
      .strictObject({
        searchDemand: component.default(25),
        impact: component.default(30),
        confidence: component.default(20),
        effort: component.default(15),
        businessValue: component.default(10),
      })
      .default({
        searchDemand: 25,
        impact: 30,
        confidence: 20,
        effort: 15,
        businessValue: 10,
      }),
  })
  .superRefine((c, ctx) => {
    if (c.quickWin.minPosition > c.quickWin.maxPosition)
      ctx.addIssue({
        code: "custom",
        message: "Invalid quick-win position range",
      });
    if (Object.values(c.weights).reduce((a, b) => a + b, 0) <= 0)
      ctx.addIssue({
        code: "custom",
        message: "At least one weight must be positive",
      });
    if (
      c.ctr.bands.some(
        (b, i) => i > 0 && b.maxPosition <= c.ctr.bands[i - 1]!.maxPosition,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "CTR bands must be ordered by increasing position",
      });
    if (c.minObservedDaysRatio === 0)
      ctx.addIssue({
        code: "custom",
        message: "Observed day ratio must be positive",
      });
  });
export type OpportunityConfig = z.infer<typeof configSchema>;
export const detectionRequestSchema = z.strictObject({
  endDate: z.iso.date().optional(),
  config: configSchema.default(configSchema.parse({})),
  idempotencyKey: z.string().min(8).max(256).optional(),
});
export const listFilterSchema = z.strictObject({
  type: opportunityTypeSchema.optional(),
  status: opportunityStatusSchema.optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  pageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type ListFilter = z.infer<typeof listFilterSchema>;
const metricSchema = z.object({
  id: z.string(),
  syncRunId: z.string(),
  date: z.iso.date(),
  url: z.string().url(),
  pageId: z.string().nullable(),
  queryId: z.string().nullable(),
  query: z.string().nullable(),
  clicks: z.number().finite().nonnegative(),
  impressions: z.number().finite().nonnegative(),
  position: z.number().finite().nonnegative(),
});
export const inputSchema = z.object({
  endDate: z.iso.date(),
  pageMetrics: z.array(metricSchema).max(100000),
  pageQueryMetrics: z.array(metricSchema).max(100000),
  coverage: z
    .array(
      z.object({
        id: z.string(),
        dimensionSet: z.enum(["PAGE", "PAGE_QUERY"]),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
      }),
    )
    .max(10000),
  crawl: z
    .object({
      id: z.string(),
      finishedAt: z.iso.datetime(),
      pages: z
        .array(
          z.object({
            id: z.string(),
            snapshotId: z.string(),
            metricId: z.string(),
            url: z.string().url(),
            indexable: z.boolean(),
            incoming: z.number().int().nonnegative(),
            depth: z.number().int().nonnegative(),
            orphan: z.boolean(),
          }),
        )
        .max(100000),
      edges: z
        .array(
          z.object({ id: z.string(), source: z.string(), target: z.string() }),
        )
        .max(100000),
    })
    .nullable(),
  ga4: z
    .array(
      z.object({
        id: z.string(),
        pageId: z.string().nullable(),
        sessions: z.number().finite().nonnegative(),
        engagedSessions: z.number().finite().nonnegative(),
        keyEvents: z.number().finite().nonnegative(),
      }),
    )
    .max(100000),
  pageSpeed: z
    .array(
      z.object({
        id: z.string(),
        pageId: z.string().nullable(),
        strategy: z.string(),
        collectedAt: z.iso.datetime(),
        performanceScore: z.number().finite().nullable(),
        fieldLcpMs: z.number().finite().nullable(),
        fieldInpMs: z.number().finite().nullable(),
        fieldCls: z.number().finite().nullable(),
      }),
    )
    .max(100000),
});
export type EngineInput = z.infer<typeof inputSchema>;
export type Metric = EngineInput["pageMetrics"][number];
export const componentsSchema = z.object({
  searchDemand: component,
  impact: component,
  confidence: component,
  effort: component,
  businessValue: component.nullable(),
});
export type Components = z.infer<typeof componentsSchema>;
export const candidateSchema = z.object({
  key: z.string(),
  type: opportunityTypeSchema,
  pageId: z.string().nullable(),
  url: z.string().url().nullable(),
  queryId: z.string().nullable(),
  detectorVersion: z.literal(DETECTOR_VERSION),
  candidateOnly: z.boolean(),
  components: componentsSchema,
  score: component,
  evidence: z.record(z.string(), z.unknown()),
});
export type Candidate = z.infer<typeof candidateSchema>;
export interface EngineResult {
  candidates: Candidate[];
  evaluatedKeys: string[];
  statistics: {
    counts: Record<OpportunityType, number>;
    insufficient: Record<string, number>;
    coverage: { page: boolean; pageQuery: boolean; previousPage: boolean };
    detectors: OpportunityType[];
  };
}
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function windows(endDate: string, days: number) {
  const startDate = shiftDate(endDate, 1 - days);
  return {
    startDate,
    endDate,
    previousStart: shiftDate(startDate, -days),
    previousEnd: shiftDate(startDate, -1),
  };
}
export function safeEndDate(now: Date, lagDays: number): string {
  return shiftDate(now.toISOString().slice(0, 10), -lagDays);
}

export const statusChangeSchema = z.strictObject({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "DISMISSED"]),
  expectedStatus: opportunityStatusSchema,
  reason: z.string().trim().min(3).max(500),
});
export type StatusChange = z.infer<typeof statusChangeSchema>;
