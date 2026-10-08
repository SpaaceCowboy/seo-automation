import {
  AGENT_SCHEMA_VERSION,
  EVIDENCE_VERSION,
  policySchema,
  type AgentType,
  type Analysis,
  type EvidenceBundle,
  type AgentPolicy,
  type WorkflowJournal,
  type CallRecord,
} from "../src/index.js";
import type { GenerationRequest } from "@roco/llm";
export const ids = {
  opportunity: "11111111-1111-4111-8111-111111111111",
  score: "22222222-2222-4222-8222-222222222222",
  site: "33333333-3333-4333-8333-333333333333",
  page: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  query: "66666666-6666-4666-8666-666666666666",
};
export function bundle(type: EvidenceBundle["type"] = "CTR"): EvidenceBundle {
  return {
    version: EVIDENCE_VERSION,
    opportunityId: ids.opportunity,
    scoreId: ids.score,
    siteId: ids.site,
    type,
    sourceConfidence: 0.8,
    quality: 1,
    window: { startDate: "2026-09-01", endDate: "2026-09-28" },
    facts: [
      {
        id: "impressions",
        label: "impressions",
        value: 12400,
        unit: "count",
        source: {
          kind: "OPPORTUNITY_SCORE",
          id: ids.score,
          field: "metrics.impressions",
        },
        untrusted: false,
        redacted: false,
      },
      {
        id: "title",
        label: "title",
        value: "Forex trading guide",
        unit: "text",
        source: { kind: "PAGE_SNAPSHOT", id: ids.score, field: "title" },
        untrusted: true,
        redacted: false,
      },
    ],
    pages: [
      { id: ids.page, displayUrl: "https://example.test/fa/forex" },
      { id: ids.source, displayUrl: "https://example.test/fa/guide" },
    ],
    queryIds: [ids.query],
    linkPairs: [{ sourcePageId: ids.source, targetPageId: ids.page }],
    limitations: ["No competitor evidence supplied."],
  };
}
export function policy(provider = "fixture"): AgentPolicy & {
  routes: Record<AgentType, AgentPolicy["routes"]["SUPERVISOR"]>;
} {
  const route = {
    provider,
    model: "fixture-v1",
    inputNanousdPerToken: 1,
    outputNanousdPerToken: 2,
  };
  const routes = {
    SUPERVISOR: route,
    TECHNICAL: route,
    KEYWORD: route,
    CONTENT: route,
    INTERNAL_LINKING: route,
  };
  return {
    ...policySchema.parse({
      routes,
      requestsPerSecond: 2,
    }),
    routes,
  };
}
export function output(
  agent: AgentType = "SUPERVISOR",
  evidence = bundle(),
): Analysis {
  return {
    schemaVersion: AGENT_SCHEMA_VERSION,
    agent,
    opportunityId: evidence.opportunityId,
    assessment: "SUPPORTED",
    summary: "Observed visibility warrants a cautious review.",
    observations: [
      { factId: evidence.facts[0]!.id, value: evidence.facts[0]!.value },
    ],
    inferences: [
      {
        text: "Observed visibility may indicate a presentation mismatch.",
        evidenceIds: [evidence.facts[0]!.id],
      },
    ],
    actions: [
      {
        type: "OBSERVE",
        targetPageId: evidence.pages[0]?.id ?? null,
        sourcePageId: null,
        rationale: "Review the supplied evidence before proposing a change.",
        proposal: null,
        evidenceIds: [evidence.facts[0]!.id],
      },
    ],
    confidence: 0.95,
    risk: "LOW",
    expectedMetric: "CTR",
    assumptions: ["Search intent requires human review."],
    warnings: ["This draft cannot be executed."],
  };
}
export function respond(request: GenerationRequest): {
  text: string;
  inputTokens: number;
  outputTokens: number;
  providerRequestId: null;
} {
  const input = JSON.parse(request.input) as { evidence: EvidenceBundle };
  const role = request.system.includes("SEO Supervisor")
    ? "SUPERVISOR"
    : request.system.includes("Technical SEO analyst")
      ? "TECHNICAL"
      : request.system.includes("Content analyst")
        ? "CONTENT"
        : request.system.includes("Internal Linking analyst")
          ? "INTERNAL_LINKING"
          : "KEYWORD";
  return {
    text: JSON.stringify(output(role, input.evidence)),
    inputTokens: 100,
    outputTokens: 50,
    providerRequestId: null,
  };
}
export function memoryJournal(): {
  journal: WorkflowJournal;
  records: (CallRecord & { agent: AgentType })[];
} {
  const records: (CallRecord & { agent: AgentType })[] = [];
  const journal: WorkflowJournal = {
    calls: (agent) => Promise.resolve(records.filter((r) => r.agent === agent)),
    reserve: (input) => {
      const id = `call-${records.length}`;
      records.push({
        id,
        agent: input.agent,
        attempt: input.attempt,
        status: "RUNNING",
        reservedNanousd: input.reservedNanousd,
        costNanousd: null,
        output: null,
        retryable: null,
      });
      return Promise.resolve(id);
    },
    settle: (id, input) => {
      const record = records.find((r) => r.id === id)!;
      record.status = input.errorCode === null ? "SUCCEEDED" : "FAILED";
      record.output = input.output;
      record.costNanousd = input.costNanousd;
      record.retryable = input.retryable;
      return Promise.resolve();
    },
  };
  return { journal, records };
}
