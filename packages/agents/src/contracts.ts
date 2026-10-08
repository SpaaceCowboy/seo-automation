import { z } from "zod";
import { opportunityTypeSchema } from "@roco/opportunities";
export const AGENT_SCHEMA_VERSION = "seo-agent-v1";
export const EVIDENCE_VERSION = "agent-evidence-v1";
export const POLICY_VERSION = "agent-policy-v1";
export const agentTypeSchema = z.enum([
  "SUPERVISOR",
  "TECHNICAL",
  "KEYWORD",
  "CONTENT",
  "INTERNAL_LINKING",
]);
export type AgentType = z.infer<typeof agentTypeSchema>;
export const riskSchema = z.enum(["LOW", "MEDIUM", "HIGH", "SPECIAL_APPROVAL"]);
export const actionTypeSchema = z.enum([
  "OBSERVE",
  "TITLE",
  "META_DESCRIPTION",
  "HEADINGS",
  "CONTENT_BRIEF",
  "FAQ",
  "INTERNAL_LINK",
  "SCHEMA",
  "CANONICAL",
  "REDIRECT",
  "URL_CHANGE",
  "DELETE",
  "MAJOR_REWRITE",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;
const scalar = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const factSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string().max(100),
  value: scalar,
  unit: z.enum([
    "count",
    "ratio",
    "position",
    "milliseconds",
    "text",
    "boolean",
  ]),
  source: z.strictObject({
    kind: z.enum([
      "OPPORTUNITY_SCORE",
      "PAGE_SNAPSHOT",
      "ISSUE_OCCURRENCE",
      "SEARCH_QUERY",
    ]),
    id: z.string().uuid(),
    field: z.string().max(200),
  }),
  untrusted: z.boolean(),
  redacted: z.boolean(),
});
export const evidenceSchema = z.strictObject({
  version: z.literal(EVIDENCE_VERSION),
  opportunityId: z.string().uuid(),
  scoreId: z.string().uuid(),
  siteId: z.string().uuid(),
  type: opportunityTypeSchema,
  sourceConfidence: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  window: z.strictObject({ startDate: z.iso.date(), endDate: z.iso.date() }),
  facts: z.array(factSchema).max(50),
  pages: z
    .array(
      z.strictObject({ id: z.string().uuid(), displayUrl: z.string().url() }),
    )
    .max(5),
  queryIds: z.array(z.string().uuid()).max(10),
  linkPairs: z
    .array(
      z.strictObject({
        sourcePageId: z.string().uuid(),
        targetPageId: z.string().uuid(),
      }),
    )
    .max(5),
  limitations: z.array(z.string().max(300)).max(15),
});
export type EvidenceBundle = z.infer<typeof evidenceSchema>;
const references = z.array(z.string().min(1).max(100)).min(1).max(10);
export const analysisSchema = z.strictObject({
  schemaVersion: z.literal(AGENT_SCHEMA_VERSION),
  agent: agentTypeSchema,
  opportunityId: z.string().uuid(),
  assessment: z.enum(["SUPPORTED", "INSUFFICIENT_EVIDENCE"]),
  summary: z.string().min(3).max(600),
  observations: z
    .array(z.strictObject({ factId: z.string(), value: scalar }))
    .max(10),
  inferences: z
    .array(
      z.strictObject({
        text: z.string().min(3).max(400),
        evidenceIds: references,
      }),
    )
    .max(5),
  actions: z
    .array(
      z.strictObject({
        type: actionTypeSchema,
        targetPageId: z.string().uuid().nullable(),
        sourcePageId: z.string().uuid().nullable(),
        rationale: z.string().min(3).max(400),
        proposal: z.string().max(1000).nullable(),
        evidenceIds: references,
      }),
    )
    .max(5),
  confidence: z.number().finite().min(0).max(1),
  risk: riskSchema,
  expectedMetric: z.enum([
    "CLICKS",
    "IMPRESSIONS",
    "CTR",
    "POSITION",
    "INCOMING_LINKS",
    "INDEXABILITY",
    "NONE",
  ]),
  assumptions: z.array(z.string().max(300)).max(5),
  warnings: z.array(z.string().max(300)).max(5),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const draftSchema = z.strictObject({
  status: z.literal("DRAFT"),
  executable: z.literal(false),
  analysis: analysisSchema,
});
export type Draft = z.infer<typeof draftSchema>;
const routeSchema = z.strictObject({
  provider: z.string().min(1).max(50),
  model: z.string().min(1).max(100),
  inputNanousdPerToken: z.number().int().min(0).max(1000000000),
  outputNanousdPerToken: z.number().int().min(0).max(1000000000),
  temperature: z.number().min(0).max(2).optional(),
  reasoningEffort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    .optional(),
});
export const policySchema = z
  .strictObject({
    version: z.literal(POLICY_VERSION).default(POLICY_VERSION),
    executionMode: z
      .enum(["SUPERVISOR_ONLY", "SPECIALISTS"])
      .default("SPECIALISTS"),
    routes: z.strictObject({
      SUPERVISOR: routeSchema,
      TECHNICAL: routeSchema.optional(),
      KEYWORD: routeSchema.optional(),
      CONTENT: routeSchema.optional(),
      INTERNAL_LINKING: routeSchema.optional(),
    }),
    maxInputBytes: z.number().int().min(2048).max(32000).default(20000),
    minOpportunityScore: z.number().min(0).max(100).default(0),
    maxOutputTokens: z.number().int().min(100).max(4096).default(1500),
    maxInvocations: z.number().int().min(1).max(12).default(8),
    maxSpecialists: z.number().int().min(0).max(3).default(3),
    retryLimit: z.number().int().min(0).max(2).default(1),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    requestsPerSecond: z.number().positive().max(2).default(0.5),
    runBudgetNanousd: z
      .number()
      .int()
      .min(1)
      .max(1000000000000)
      .default(1000000000),
    monthlyBudgetNanousd: z
      .number()
      .int()
      .min(1)
      .max(1000000000000000)
      .default(100000000000),
  })
  .superRefine((policy, ctx) => {
    if (policy.executionMode === "SPECIALISTS") {
      for (const agent of [
        "TECHNICAL",
        "KEYWORD",
        "CONTENT",
        "INTERNAL_LINKING",
      ] as const)
        if (!policy.routes[agent])
          ctx.addIssue({
            code: "custom",
            path: ["routes", agent],
            message: "Specialist mode requires this route",
          });
      if (policy.maxSpecialists === 0)
        ctx.addIssue({
          code: "custom",
          path: ["maxSpecialists"],
          message: "Specialist mode requires a positive limit",
        });
    }
  });
export type AgentPolicy = z.infer<typeof policySchema>;
export function getAgentRoute(policy: AgentPolicy, agent: AgentType) {
  const route = policy.routes[agent];
  if (!route) throw new AgentError("AGENT_ROUTE_NOT_CONFIGURED");
  return route;
}
export const triggerAnalysisSchema = z.strictObject({
  idempotencyKey: z.string().min(8).max(256).optional(),
});
export const agentJobSchema = z.strictObject({
  runId: z.string().uuid(),
  siteId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});
export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "AgentError";
  }
}
