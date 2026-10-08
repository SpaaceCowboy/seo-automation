import { isDeepStrictEqual } from "node:util";
import { classifyRisk, type Analysis } from "@roco/agents";
import {
  WorkflowError,
  valuesSchema,
  type Principal,
  type Proposal,
  type RecommendationState,
  type ChangeValues,
  type MeasurementRule,
  ruleSchema,
} from "./contracts.js";
export function requireRole(
  principal: Principal,
  role: "READ" | "OPERATOR" | "APPROVER" | "SPECIAL_APPROVER",
): void {
  const allowed =
    role === "READ"
      ? principal.roles.length > 0
      : role === "OPERATOR"
        ? principal.roles.includes("OPERATOR")
        : role === "SPECIAL_APPROVER"
          ? principal.roles.includes("SPECIAL_APPROVER")
          : principal.roles.includes("APPROVER") ||
            principal.roles.includes("SPECIAL_APPROVER");
  if (!allowed) throw new WorkflowError("WORKFLOW_FORBIDDEN");
}
export function approvalRole(
  risk: Analysis["risk"],
): "APPROVER" | "SPECIAL_APPROVER" {
  return risk === "HIGH" || risk === "SPECIAL_APPROVAL"
    ? "SPECIAL_APPROVER"
    : "APPROVER";
}
export function nextRecommendationState(
  state: RecommendationState,
  action: "SUBMIT" | "APPROVE" | "REJECT" | "REQUEST_CHANGES" | "CANCEL",
): RecommendationState {
  if (
    action === "CANCEL" &&
    ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "CHANGES_REQUESTED"].includes(
      state,
    )
  )
    return "CANCELLED";
  if (action === "SUBMIT" && state === "DRAFT") return "READY_FOR_REVIEW";
  if (state === "READY_FOR_REVIEW") {
    if (action === "APPROVE") return "APPROVED";
    if (action === "REJECT") return "REJECTED";
    if (action === "REQUEST_CHANGES") return "CHANGES_REQUESTED";
  }
  throw new WorkflowError("INVALID_RECOMMENDATION_TRANSITION");
}
const fields: Record<Proposal["changeType"], keyof ChangeValues> = {
  OBSERVE: "note",
  TITLE: "title",
  META_DESCRIPTION: "metaDescription",
  HEADINGS: "headings",
  CONTENT_BRIEF: "contentReference",
  FAQ: "contentReference",
  INTERNAL_LINK: "internalLinks",
  SCHEMA: "structuredDataReference",
  CANONICAL: "canonicalUrl",
  REDIRECT: "redirectTarget",
  URL_CHANGE: "url",
  DELETE: "deleted",
  MAJOR_REWRITE: "contentReference",
};
export function validateProposal(proposal: Proposal): void {
  const key = fields[proposal.changeType];
  for (const value of [proposal.before, proposal.after]) {
    const parsed = valuesSchema.parse(value);
    if (
      Object.keys(parsed).length !== 1 ||
      !(key in parsed) ||
      parsed[key] === undefined
    )
      throw new WorkflowError("CHANGE_FIELDS_DO_NOT_MATCH_TYPE");
  }
  if (isDeepStrictEqual(proposal.before, proposal.after))
    throw new WorkflowError("UNCHANGED_PROPOSAL");
}
export function validateActualAfter(
  approved: ChangeValues,
  actual: ChangeValues,
): void {
  if (
    !isDeepStrictEqual(valuesSchema.parse(approved), valuesSchema.parse(actual))
  )
    throw new WorkflowError("IMPLEMENTATION_DIFFERS_FROM_APPROVAL");
}
export function proposalRisk(
  analysis: Analysis,
  changeType: Proposal["changeType"],
): Analysis["risk"] {
  return classifyRisk({
    ...analysis,
    actions: [
      {
        type: changeType,
        targetPageId: null,
        sourcePageId: null,
        rationale: "Risk policy",
        proposal: null,
        evidenceIds: ["policy"],
      },
    ],
  });
}
export function defaultRule(
  expected: Analysis["expectedMetric"],
): MeasurementRule {
  const map = {
    CLICKS: "GSC_CLICKS",
    IMPRESSIONS: "GSC_IMPRESSIONS",
    CTR: "GSC_CTR",
    POSITION: "GSC_POSITION",
    INCOMING_LINKS: "CRAWL_INCOMING_LINKS",
    INDEXABILITY: "CRAWL_INDEXABILITY",
    NONE: "NONE",
  } as const;
  return ruleSchema.parse({ primary: map[expected] });
}
