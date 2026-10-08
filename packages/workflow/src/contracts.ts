import { z } from "zod";
import { actionTypeSchema, riskSchema } from "@roco/agents/contracts";
export const RULE_VERSION = "measurement-v1";
export const stateSchema = z.enum([
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "CHANGES_REQUESTED",
  "IMPLEMENTED",
  "CANCELLED",
]);
export type RecommendationState = z.infer<typeof stateSchema>;
export const roleSchema = z.enum([
  "VIEWER",
  "OPERATOR",
  "APPROVER",
  "SPECIAL_APPROVER",
  "ADMIN",
]);
export type Role = z.infer<typeof roleSchema>;
export interface Principal {
  actorId: string;
  roles: Role[];
  correlationId: string;
}
export const accessSchema = z
  .array(
    z.strictObject({
      token: z.string().min(32).max(256),
      actorId: z.string().uuid(),
      roles: z.array(roleSchema).min(1).max(5),
    }),
  )
  .max(50)
  .superRefine((items, ctx) => {
    if (new Set(items.map((i) => i.token)).size !== items.length)
      ctx.addIssue({ code: "custom", message: "Duplicate credentials" });
  });
export const primaryMetricSchema = z.enum([
  "GSC_CLICKS",
  "GSC_IMPRESSIONS",
  "GSC_CTR",
  "GSC_POSITION",
  "GA4_SESSIONS",
  "GA4_DAILY_USERS",
  "GA4_ENGAGEMENT_RATE",
  "GA4_KEY_EVENTS",
  "PAGESPEED_PERFORMANCE",
  "PAGESPEED_LCP",
  "PAGESPEED_INP",
  "PAGESPEED_CLS",
  "CRAWL_INDEXABILITY",
  "CRAWL_DEPTH",
  "CRAWL_INCOMING_LINKS",
  "TECHNICAL_ISSUES",
  "NONE",
]);
export type PrimaryMetric = z.infer<typeof primaryMetricSchema>;
export const ruleSchema = z.strictObject({
  version: z.literal(RULE_VERSION).default(RULE_VERSION),
  primary: primaryMetricSchema,
  windowDays: z.union([z.literal(7), z.literal(14), z.literal(28)]).default(28),
  lagDays: z.number().int().min(3).max(30).default(3),
  minDaysRatio: z.number().positive().max(1).default(0.8),
  minImpressions: z.number().positive().default(200),
  minClicks: z.number().nonnegative().default(20),
  minSessions: z.number().positive().default(20),
  minPageSpeedSamples: z.number().int().min(1).max(20).default(3),
  relativeThreshold: z.number().min(0).max(1).default(0.1),
  absoluteThreshold: z.number().nonnegative().optional(),
  overlapPolicy: z.enum(["insufficient", "warn"]).default("insufficient"),
  retryWindowDays: z.number().int().min(0).max(30).default(14),
  strategy: z.enum(["mobile", "desktop"]).default("mobile"),
});
export type MeasurementRule = z.infer<typeof ruleSchema>;
export const valuesSchema = z.strictObject({
  title: z.string().max(300).nullable().optional(),
  metaDescription: z.string().max(1000).nullable().optional(),
  headings: z
    .array(
      z.strictObject({
        level: z.union([z.literal(1), z.literal(2)]),
        text: z.string().max(500),
      }),
    )
    .max(30)
    .optional(),
  canonicalUrl: z.string().url().nullable().optional(),
  contentReference: z.string().min(1).max(500).optional(),
  structuredDataReference: z.string().min(1).max(500).optional(),
  internalLinks: z
    .array(
      z.strictObject({
        sourcePageId: z.string().uuid(),
        targetPageId: z.string().uuid(),
        anchorConcept: z.string().max(200),
      }),
    )
    .max(20)
    .optional(),
  url: z.string().url().optional(),
  redirectTarget: z.string().url().nullable().optional(),
  deleted: z.boolean().optional(),
  note: z.string().max(1000).optional(),
});
export type ChangeValues = z.infer<typeof valuesSchema>;
export const proposalSchema = z.strictObject({
  pageId: z.string().uuid(),
  changeType: actionTypeSchema,
  pageType: z.string().min(1).max(100),
  topic: z.string().max(300).nullable(),
  before: valuesSchema,
  after: valuesSchema,
  reason: z.string().min(3).max(1000),
  rule: ruleSchema,
});
export type Proposal = z.infer<typeof proposalSchema>;
export const createRecommendationSchema = z.strictObject({
  agentOutputId: z.string().uuid(),
  actionIndex: z.number().int().min(0).max(4),
  mode: z.enum(["SANDBOX", "PRODUCTION"]),
  proposal: proposalSchema,
  idempotencyKey: z.string().min(8).max(256),
});
export const versionSchema = z.strictObject({
  expectedVersionId: z.string().uuid(),
  proposal: proposalSchema,
});
export const transitionSchema = z.strictObject({
  expectedVersionId: z.string().uuid(),
  expectedState: stateSchema,
  action: z.enum(["SUBMIT", "APPROVE", "REJECT", "REQUEST_CHANGES", "CANCEL"]),
  reason: z.string().min(3).max(1000),
});
export const implementSchema = z.strictObject({
  versionId: z.string().uuid(),
  implementedAt: z.iso.datetime(),
  actualBefore: valuesSchema,
  actualAfter: valuesSchema,
  notes: z.string().min(3).max(1000),
  externalReference: z.string().min(1).max(500),
  confirmedApplied: z.literal(true),
  idempotencyKey: z.string().min(8).max(256),
});
export const revertSchema = z.strictObject({
  revertedAt: z.iso.datetime(),
  values: valuesSchema,
  reason: z.string().min(3).max(1000),
  externalReference: z.string().min(1).max(500),
  confirmedApplied: z.literal(true),
  idempotencyKey: z.string().min(8).max(256),
});
export const correctionSchema = z.strictObject({
  reason: z.string().min(3).max(1000),
  note: z.string().min(3).max(1000),
  idempotencyKey: z.string().min(8).max(256),
});
export const remeasureSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(256),
});
export const baselineRefreshSchema = z.strictObject({
  reason: z.string().min(3).max(1000),
  idempotencyKey: z.string().min(8).max(256),
});
export const listSchema = z.strictObject({
  state: stateSchema.optional(),
  risk: riskSchema.optional(),
  pageId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const measurementJobSchema = z.strictObject({
  runId: z.string().uuid(),
  siteId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});
export const resultSchema = z.enum([
  "POSITIVE",
  "NEUTRAL",
  "NEGATIVE",
  "INSUFFICIENT_DATA",
  "REVERTED",
]);
export type ResultState = z.infer<typeof resultSchema>;
export class WorkflowError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WorkflowError";
  }
}
