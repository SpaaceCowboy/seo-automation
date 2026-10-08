import { z } from "zod";
import {
  AgentError,
  analysisSchema,
  type AgentType,
  type Analysis,
  type EvidenceBundle,
  type ActionType,
} from "./contracts.js";
const allowedActions: Record<AgentType, ActionType[]> = {
  SUPERVISOR: [
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
  ],
  TECHNICAL: [
    "OBSERVE",
    "SCHEMA",
    "CANONICAL",
    "REDIRECT",
    "URL_CHANGE",
    "DELETE",
  ],
  KEYWORD: [
    "OBSERVE",
    "TITLE",
    "META_DESCRIPTION",
    "CONTENT_BRIEF",
    "URL_CHANGE",
    "REDIRECT",
    "MAJOR_REWRITE",
  ],
  CONTENT: [
    "OBSERVE",
    "TITLE",
    "META_DESCRIPTION",
    "HEADINGS",
    "CONTENT_BRIEF",
    "FAQ",
    "MAJOR_REWRITE",
  ],
  INTERNAL_LINKING: ["OBSERVE", "INTERNAL_LINK"],
};
const levels = ["LOW", "MEDIUM", "HIGH", "SPECIAL_APPROVAL"] as const;
export function classifyRisk(output: Analysis): Analysis["risk"] {
  let level = levels.indexOf(output.risk);
  for (const action of output.actions) {
    if (
      action.type === "INTERNAL_LINK" &&
      action.proposal &&
      action.proposal.length > 120
    )
      throw new AgentError("ANCHOR_CONCEPT_TOO_LARGE", true);
    const minimum = [
      "URL_CHANGE",
      "REDIRECT",
      "DELETE",
      "MAJOR_REWRITE",
    ].includes(action.type)
      ? 3
      : action.type === "CANONICAL"
        ? 2
        : action.type === "OBSERVE"
          ? 0
          : 1;
    level = Math.max(level, minimum);
  }
  return levels[level]!;
}
export function validateAnalysis(
  raw: unknown,
  agent: AgentType,
  bundle: EvidenceBundle,
  specialists: Analysis[] = [],
): Analysis {
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) throw new AgentError("INVALID_AGENT_SCHEMA", true);
  const output = parsed.data;
  if (output.agent !== agent || output.opportunityId !== bundle.opportunityId)
    throw new AgentError("AGENT_CONTEXT_MISMATCH", true);
  const facts = new Map(bundle.facts.map((f) => [f.id, f]));
  const pages = new Set(bundle.pages.map((p) => p.id));
  for (const observation of output.observations)
    if (
      !facts.has(observation.factId) ||
      !Object.is(facts.get(observation.factId)!.value, observation.value)
    )
      throw new AgentError("UNGROUNDED_OBSERVATION", true);
  if (
    new Set(output.observations.map((o) => o.factId)).size !==
    output.observations.length
  )
    throw new AgentError("DUPLICATE_OBSERVATION", true);
  const refs = [...output.inferences, ...output.actions];
  for (const item of refs)
    if (item.evidenceIds.some((id) => !facts.has(id)))
      throw new AgentError("UNKNOWN_EVIDENCE_REFERENCE", true);
  const prose = [
    output.summary,
    ...output.inferences.map((i) => i.text),
    ...output.actions.map((a) => a.rationale),
    ...output.assumptions,
    ...output.warnings,
  ];
  if (prose.some((text) => /\p{Nd}/u.test(text)))
    throw new AgentError("NUMERIC_CLAIM_OUTSIDE_OBSERVATION", true);
  if (
    prose.some((text) =>
      /\b(competitors? (?:have|rank|use)|guaranteed?|automatically approve|already (?:executed|published)|google will)\b/i.test(
        text,
      ),
    )
  )
    throw new AgentError("UNSUPPORTED_EXTERNAL_OR_EXECUTION_CLAIM", true);
  const textDigits = new Set(
    bundle.facts
      .filter((f) => typeof f.value === "string")
      .flatMap((f) => String(f.value).match(/\p{Nd}+/gu) ?? []),
  );
  for (const action of output.actions) {
    if (
      action.type === "INTERNAL_LINK" &&
      action.proposal &&
      action.proposal.length > 120
    )
      throw new AgentError("ANCHOR_CONCEPT_TOO_LARGE", true);
    if (!allowedActions[agent].includes(action.type))
      throw new AgentError("ACTION_OUTSIDE_AGENT_CONTRACT", true);
    for (const pageId of [action.targetPageId, action.sourcePageId])
      if (pageId !== null && !pages.has(pageId))
        throw new AgentError("UNKNOWN_PAGE_TARGET", true);
    if (action.type !== "OBSERVE" && action.targetPageId === null)
      throw new AgentError("MISSING_PAGE_TARGET", true);
    if (
      action.type === "INTERNAL_LINK" &&
      !bundle.linkPairs.some(
        (p) =>
          p.sourcePageId === action.sourcePageId &&
          p.targetPageId === action.targetPageId,
      )
    )
      throw new AgentError("UNSUPPORTED_LINK_PAIR", true);
    if (action.type !== "INTERNAL_LINK" && action.sourcePageId !== null)
      throw new AgentError("UNEXPECTED_SOURCE_PAGE", true);
    if (
      action.proposal &&
      (action.proposal.match(/\p{Nd}+/gu) ?? []).some((v) => !textDigits.has(v))
    )
      throw new AgentError("INVENTED_PROPOSAL_NUMERIC_VALUE", true);
    if (
      action.proposal &&
      ((action.type === "TITLE" && action.proposal.length > 80) ||
        (action.type === "META_DESCRIPTION" && action.proposal.length > 180))
    )
      throw new AgentError("PROPOSAL_TOO_LARGE", true);
  }
  if (
    output.assessment === "INSUFFICIENT_EVIDENCE" &&
    (output.actions.length > 0 || output.confidence !== 0)
  )
    throw new AgentError("INSUFFICIENT_EVIDENCE_POLICY_VIOLATION", true);
  if (
    output.assessment === "SUPPORTED" &&
    (output.observations.length === 0 || bundle.facts.length < 2)
  )
    throw new AgentError("MISSING_GROUNDING", true);
  const cap = specialists.length
    ? Math.min(...specialists.map((s) => s.confidence))
    : 1;
  const confidence =
    Math.floor(
      Math.min(
        Math.min(output.confidence, bundle.sourceConfidence) * bundle.quality,
        cap,
      ) * 10000,
    ) / 10000;
  const risk =
    levels[
      Math.max(
        levels.indexOf(classifyRisk(output)),
        ...specialists.map((s) => levels.indexOf(s.risk)),
      )
    ];
  return { ...output, confidence, risk: risk ?? classifyRisk(output) };
}
// Keep the remote JSON schema within the common strict subset; local Zod retains all bounds.
export function remoteAnalysisSchema(): Record<string, unknown> {
  const allowed = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "enum",
    "items",
    "anyOf",
  ]);
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value !== null && typeof value === "object") {
      const object: Record<string, unknown> = value as Record<string, unknown>;
      const normalized: Record<string, unknown> = {
        ...object,
        ...("const" in object ? { enum: [object.const] } : {}),
      };
      return Object.fromEntries(
        Object.entries(normalized)
          .filter(([key]) => allowed.has(key))
          .map(([key, v]) => [
            key,
            key === "properties"
              ? Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).map(
                    ([name, child]) => [name, clean(child)],
                  ),
                )
              : clean(v),
          ]),
      );
    }
    return value;
  };
  return clean(z.toJSONSchema(analysisSchema)) as Record<string, unknown>;
}
