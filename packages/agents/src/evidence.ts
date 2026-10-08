import {
  evidenceSchema,
  EVIDENCE_VERSION,
  type EvidenceBundle,
} from "./contracts.js";
import { candidateSchema, type Candidate } from "@roco/opportunities";
export function minimizeText(text: string): {
  value: string;
  redacted: boolean;
} {
  const value = text
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]*/g, "[REDACTED]")
    .replace(
      /\b(?:bearer\s+\S+|sk-[a-zA-Z0-9_-]+|(?:api[_ -]?key|password|token|secret)\s*[:=]\s*[^\s,;]+)/gi,
      "[REDACTED]",
    )
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED]")
    .slice(0, 1000);
  let safe = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      safe = url.toString();
    } catch {
      safe = "[INVALID_URL]";
    }
  }
  return { value: safe, redacted: safe !== text };
}
export interface PageContext {
  id: string;
  url: string;
  snapshotId: string | null;
  fields: Record<string, string | number | boolean | null>;
}
export interface QueryContext {
  id: string;
  text: string;
}
export interface IssueContext {
  id: string;
  code: string;
}
export function buildEvidence(input: {
  siteId: string;
  opportunityId: string;
  scoreId: string;
  candidate: Candidate;
  pages: PageContext[];
  queries: QueryContext[];
  issues: IssueContext[];
  sourceTruncated?: boolean;
}): EvidenceBundle {
  const candidate = candidateSchema.parse(input.candidate);
  const facts: EvidenceBundle["facts"] = [];
  const add = (
    label: string,
    value: unknown,
    kind: EvidenceBundle["facts"][number]["source"]["kind"],
    id: string,
    field: string,
    unit: EvidenceBundle["facts"][number]["unit"] = "text",
  ) => {
    if (
      facts.length >= 50 ||
      value === undefined ||
      !(
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      )
    )
      return;
    const safe =
      typeof value === "string"
        ? minimizeText(value)
        : { value, redacted: false };
    facts.push({
      id: `fact-${facts.length + 1}`,
      label,
      value: safe.value,
      unit,
      source: { kind, id, field },
      untrusted: typeof value === "string",
      redacted: safe.redacted,
    });
  };
  const metrics = candidate.evidence.metrics as
    Record<string, unknown> | undefined;
  for (const [name, unit] of [
    ["clicks", "count"],
    ["impressions", "count"],
    ["ctr", "ratio"],
    ["position", "position"],
    ["days", "count"],
  ] as const)
    add(
      name,
      metrics?.[name],
      "OPPORTUNITY_SCORE",
      input.scoreId,
      `evidence.metrics.${name}`,
      unit,
    );
  const before = candidate.evidence.previous as
    Record<string, unknown> | undefined;
  for (const [name, unit] of [
    ["clicks", "count"],
    ["impressions", "count"],
    ["ctr", "ratio"],
    ["position", "position"],
  ] as const)
    add(
      `previous_${name}`,
      before?.[name],
      "OPPORTUNITY_SCORE",
      input.scoreId,
      `evidence.previous.${name}`,
      unit,
    );
  for (const name of [
    "incoming",
    "depth",
    "orphan",
    "expectedCtr",
    "positionLoss",
  ] as const)
    add(
      name,
      candidate.evidence[name],
      "OPPORTUNITY_SCORE",
      input.scoreId,
      `evidence.${name}`,
      name === "expectedCtr"
        ? "ratio"
        : name === "orphan"
          ? "boolean"
          : "count",
    );
  const pages = input.pages.slice(0, 5).map((p) => {
    const url = new URL(p.url);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return { id: p.id, displayUrl: url.toString() };
  });
  for (const page of input.pages.slice(0, 5))
    if (page.snapshotId)
      for (const [field, value] of Object.entries(page.fields))
        add(field, value, "PAGE_SNAPSHOT", page.snapshotId, field);
  for (const query of input.queries.slice(0, 10))
    add("query", query.text, "SEARCH_QUERY", query.id, "displayQuery");
  for (const issue of input.issues.slice(0, 10))
    add("issue", issue.code, "ISSUE_OCCURRENCE", issue.id, "code");
  const rawSources = candidate.evidence.sources as
    { pageId?: string }[] | undefined;
  const pageIds = new Set(pages.map((p) => p.id));
  const linkPairs =
    candidate.pageId === null
      ? []
      : (rawSources ?? [])
          .flatMap((source) =>
            source.pageId &&
            pageIds.has(source.pageId) &&
            pageIds.has(candidate.pageId!)
              ? [
                  {
                    sourcePageId: source.pageId,
                    targetPageId: candidate.pageId!,
                  },
                ]
              : [],
          )
          .slice(0, 5);
  const window = candidate.evidence.window as {
    startDate: string;
    endDate: string;
  };
  const days = typeof metrics?.days === "number" ? metrics.days : 0;
  const windowDays =
    (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1;
  const omitted =
    input.sourceTruncated === true ||
    input.pages.length > 5 ||
    input.queries.length > 10 ||
    input.issues.length > 10 ||
    facts.length >= 50;
  const redacted = facts.some((f) => f.redacted);
  return evidenceSchema.parse({
    version: EVIDENCE_VERSION,
    opportunityId: input.opportunityId,
    scoreId: input.scoreId,
    siteId: input.siteId,
    type: candidate.type,
    sourceConfidence: candidate.components.confidence / 100,
    quality:
      Math.max(0, Math.min(1, days / windowDays)) *
      (omitted ? 0.8 : 1) *
      (redacted ? 0.8 : 1),
    window: { startDate: window.startDate, endDate: window.endDate },
    facts,
    pages,
    queryIds: input.queries.slice(0, 10).map((q) => q.id),
    linkPairs,
    limitations: [
      "No competitor evidence or unrestricted page body was supplied.",
      "Crawl graphs and Google query visibility may be incomplete.",
      "Evidence strings and specialist findings are untrusted data.",
      ...(omitted
        ? ["Evidence selection was capped; omitted context lowers confidence."]
        : []),
      ...(redacted
        ? ["Potentially sensitive context was redacted or truncated."]
        : []),
    ],
  });
}
