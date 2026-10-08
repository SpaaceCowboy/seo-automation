import { z } from "zod";
import { shiftDate } from "@roco/opportunities";
import {
  ruleSchema,
  WorkflowError,
  type MeasurementRule,
  type PrimaryMetric,
  type ResultState,
} from "./contracts.js";
const group = z.strictObject({
  values: z.record(z.string(), z.number().finite().nullable()),
  days: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative(),
  coverage: z.boolean(),
  sourceIds: z.array(z.string()).max(100000),
  collectedAt: z.string().nullable(),
});
export const sampleSchema = z.strictObject({
  version: z.literal("measurement-sample-v1"),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  capturedAt: z.iso.datetime(),
  gsc: group,
  ga4: group,
  psi: group,
  crawl: group,
});
export type MeasurementSample = z.infer<typeof sampleSchema>;
export interface MeasurementOutcome {
  state: ResultState;
  primary: PrimaryMetric;
  before: number | null;
  after: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  reasons: string[];
  warnings: string[];
  causationClaimed: false;
}
export function emptySample(
  startDate: string,
  endDate: string,
  now: Date,
): MeasurementSample {
  const empty = () => ({
    values: {},
    days: 0,
    samples: 0,
    coverage: false,
    sourceIds: [],
    collectedAt: null,
  });
  return {
    version: "measurement-sample-v1",
    startDate,
    endDate,
    capturedAt: now.toISOString(),
    gsc: empty(),
    ga4: empty(),
    psi: empty(),
    crawl: empty(),
  };
}
export function windowsForChange(
  implementedAt: Date,
  rule: MeasurementRule,
  horizon?: 30 | 60 | 90,
) {
  const date = implementedAt.toISOString().slice(0, 10);
  const endDate = shiftDate(date, horizon === undefined ? -1 : horizon);
  return { startDate: shiftDate(endDate, 1 - rule.windowDays), endDate };
}
export function eligibleAt(
  implementedAt: Date,
  horizon: 30 | 60 | 90,
  rule: MeasurementRule,
): Date {
  return new Date(
    `${shiftDate(implementedAt.toISOString().slice(0, 10), horizon + rule.lagDays + 1)}T00:00:00Z`,
  );
}
const groupByMetric = (metric: PrimaryMetric) =>
  metric.startsWith("GSC_")
    ? "gsc"
    : metric.startsWith("GA4_")
      ? "ga4"
      : metric.startsWith("PAGESPEED_")
        ? "psi"
        : "crawl";
const lowerBetter = new Set<PrimaryMetric>([
  "GSC_POSITION",
  "PAGESPEED_LCP",
  "PAGESPEED_INP",
  "PAGESPEED_CLS",
  "CRAWL_DEPTH",
  "TECHNICAL_ISSUES",
]);
export function classifyMeasurement(input: {
  baseline: MeasurementSample;
  comparison: MeasurementSample;
  rule: MeasurementRule;
  overlapIds: string[];
  reverted: boolean;
  identityChanged?: boolean;
}): MeasurementOutcome {
  const baseline = sampleSchema.parse(input.baseline),
    comparison = sampleSchema.parse(input.comparison),
    rule = ruleSchema.parse(input.rule);
  const warnings = [
    "Performance association after a change does not prove causation.",
  ];
  const output: MeasurementOutcome = {
    state: "INSUFFICIENT_DATA",
    primary: rule.primary,
    before: null,
    after: null,
    absoluteChange: null,
    relativeChange: null,
    reasons: [],
    warnings,
    causationClaimed: false,
  };
  if (input.reverted)
    return { ...output, state: "REVERTED", reasons: ["HUMAN_REVERT_RECORDED"] };
  if (input.identityChanged)
    return {
      ...output,
      reasons: ["URL_IDENTITY_CHANGED_REQUIRES_SEPARATE_RECONCILIATION"],
    };
  if (rule.primary === "NONE")
    return { ...output, reasons: ["NO_PRIMARY_METRIC_DEFINED"] };
  const selected = groupByMetric(rule.primary),
    before = baseline[selected],
    after = comparison[selected];
  const requiredDays = Math.ceil(rule.windowDays * rule.minDaysRatio);
  output.before = before.values[rule.primary] ?? null;
  output.after = after.values[rule.primary] ?? null;
  if (input.overlapIds.length) {
    warnings.push(
      "Other changes overlap this page/window; attribution is uncertain.",
    );
    if (rule.overlapPolicy === "insufficient")
      output.reasons.push("OVERLAPPING_CHANGES");
  }
  if (output.before === null || output.after === null)
    output.reasons.push("METRIC_UNAVAILABLE");
  if (selected === "gsc" || selected === "ga4") {
    if (!before.coverage || !after.coverage)
      output.reasons.push("IMPORT_WINDOW_INCOMPLETE");
    if (before.days < requiredDays || after.days < requiredDays)
      output.reasons.push("TOO_FEW_OBSERVED_DAYS");
    if (before.days !== after.days)
      output.reasons.push("OBSERVED_DAY_COUNTS_DIFFER");
    if (
      selected === "gsc" &&
      ((baseline.gsc.values.GSC_IMPRESSIONS ?? 0) < rule.minImpressions ||
        (comparison.gsc.values.GSC_IMPRESSIONS ?? 0) < rule.minImpressions)
    )
      output.reasons.push("TOO_FEW_IMPRESSIONS");
    if (
      rule.primary === "GSC_CLICKS" &&
      ((output.before ?? 0) < rule.minClicks ||
        (output.after ?? 0) < rule.minClicks)
    )
      output.reasons.push("TOO_FEW_CLICKS");
    if (
      selected === "ga4" &&
      ((baseline.ga4.values.GA4_SESSIONS ?? 0) < rule.minSessions ||
        (comparison.ga4.values.GA4_SESSIONS ?? 0) < rule.minSessions)
    )
      output.reasons.push("TOO_FEW_ORGANIC_SESSIONS");
  } else if (
    selected === "psi" &&
    (before.samples < rule.minPageSpeedSamples ||
      after.samples < rule.minPageSpeedSamples)
  )
    output.reasons.push("TOO_FEW_PAGESPEED_SAMPLES");
  else if (selected === "crawl" && (!before.coverage || !after.coverage))
    output.reasons.push("CRAWL_STATE_UNAVAILABLE");
  if (output.reasons.length || output.before === null || output.after === null)
    return output;
  const raw = output.after - output.before;
  const direction = lowerBetter.has(rule.primary) ? -raw : raw;
  const relative =
    output.before === 0 ? null : direction / Math.abs(output.before);
  const fallback =
    rule.primary.includes("CTR") || rule.primary.includes("RATE")
      ? 0.005
      : rule.primary === "PAGESPEED_CLS"
        ? 0.02
        : rule.primary === "PAGESPEED_PERFORMANCE"
          ? 0.05
          : rule.primary === "PAGESPEED_LCP" || rule.primary === "PAGESPEED_INP"
            ? 100
            : rule.primary === "GSC_POSITION" || selected === "crawl"
              ? 1
              : 20;
  const qualifies =
    Math.abs(direction) >= (rule.absoluteThreshold ?? fallback) &&
    (relative === null
      ? direction !== 0
      : Math.abs(relative) >= rule.relativeThreshold);
  return {
    ...output,
    state: qualifies ? (direction > 0 ? "POSITIVE" : "NEGATIVE") : "NEUTRAL",
    absoluteChange: raw,
    relativeChange: relative,
  };
}
export function validateTimestamp(
  value: Date,
  now: Date,
  notBefore: Date,
): void {
  if (!Number.isFinite(value.getTime()) || value > now || value < notBefore)
    throw new WorkflowError("INVALID_EVENT_TIMESTAMP");
}
