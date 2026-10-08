import { describe, expect, it } from "vitest";
import {
  nextRecommendationState,
  requireRole,
  approvalRole,
  validateProposal,
  validateActualAfter,
  defaultRule,
  ruleSchema,
  emptySample,
  windowsForChange,
  eligibleAt,
  classifyMeasurement,
  implementSchema,
  type Principal,
  type MeasurementSample,
  type PrimaryMetric,
} from "../src/index.js";
const actor = "11111111-1111-4111-8111-111111111111";
const p = (roles: Principal["roles"]): Principal => ({
  actorId: actor,
  roles,
  correlationId: "test",
});
function sample(metric: PrimaryMetric, value: number): MeasurementSample {
  const s = emptySample("2026-10-01", "2026-10-28", new Date("2026-11-05"));
  for (const group of [s.gsc, s.ga4, s.psi, s.crawl]) {
    group.coverage = true;
    group.days = 28;
    group.samples = 3;
    group.values[metric] = value;
  }
  s.gsc.values.GSC_IMPRESSIONS = 1000;
  s.gsc.values.GSC_CLICKS = 100;
  s.ga4.values.GA4_SESSIONS = 100;
  return s;
}
describe("review lifecycle and risk", () => {
  it("accepts explicit review paths and rejects execution/cancel bypasses", () => {
    expect(nextRecommendationState("DRAFT", "SUBMIT")).toBe("READY_FOR_REVIEW");
    expect(nextRecommendationState("READY_FOR_REVIEW", "APPROVE")).toBe(
      "APPROVED",
    );
    expect(nextRecommendationState("READY_FOR_REVIEW", "REJECT")).toBe(
      "REJECTED",
    );
    expect(nextRecommendationState("READY_FOR_REVIEW", "REQUEST_CHANGES")).toBe(
      "CHANGES_REQUESTED",
    );
    expect(() => nextRecommendationState("DRAFT", "APPROVE")).toThrow();
    expect(() => nextRecommendationState("IMPLEMENTED", "CANCEL")).toThrow();
  });
  it("requires explicit business roles rather than admin privilege or model claims", () => {
    expect(() => requireRole(p(["ADMIN"]), "APPROVER")).toThrow();
    expect(() => requireRole(p(["VIEWER"]), "OPERATOR")).toThrow();
    expect(approvalRole("MEDIUM")).toBe("APPROVER");
    expect(approvalRole("HIGH")).toBe("SPECIAL_APPROVER");
    expect(approvalRole("SPECIAL_APPROVAL")).toBe("SPECIAL_APPROVER");
    expect(() => requireRole(p(["APPROVER"]), "SPECIAL_APPROVER")).toThrow();
  });
  it("requires concrete typed values and exact approved actual values", () => {
    const proposal = {
      pageId: actor,
      changeType: "TITLE" as const,
      pageType: "article",
      topic: null,
      before: { title: "Old" },
      after: { title: "New" },
      reason: "Improve intent",
      rule: defaultRule("CTR"),
    };
    expect(() => validateProposal(proposal)).not.toThrow();
    expect(() =>
      validateProposal({ ...proposal, after: { note: "unrelated" } }),
    ).toThrow();
    expect(() =>
      validateActualAfter({ title: "New" }, { title: "Unapproved" }),
    ).toThrow();
    expect(() => implementSchema.parse({ reviewer: "anybody" })).toThrow();
  });
  it("maps every Phase 5 expected metric without inventing a primary", () => {
    expect(defaultRule("CTR").primary).toBe("GSC_CTR");
    expect(defaultRule("POSITION").primary).toBe("GSC_POSITION");
    expect(defaultRule("INDEXABILITY").primary).toBe("CRAWL_INDEXABILITY");
    expect(defaultRule("INCOMING_LINKS").primary).toBe("CRAWL_INCOMING_LINKS");
    expect(defaultRule("NONE").primary).toBe("NONE");
  });
});
describe("deterministic measurement", () => {
  it.each([30, 60, 90] as const)(
    "creates matured %i-day windows without including pre-change days",
    (horizon) => {
      const implemented = new Date("2026-10-07T12:00:00Z"),
        rule = defaultRule("CTR");
      const baseline = windowsForChange(implemented, rule);
      const after = windowsForChange(implemented, rule, horizon);
      expect(baseline.endDate).toBe("2026-10-06");
      expect(after.startDate > "2026-10-07").toBe(true);
      expect(
        (Date.parse(after.endDate) - Date.parse(after.startDate)) / 86400000 +
          1,
      ).toBe(28);
      expect(
        eligibleAt(implemented, horizon, rule) > new Date(after.endDate),
      ).toBe(true);
    },
  );
  it("classifies meaningful improvement, decline and neutral fluctuation", () => {
    const rule = defaultRule("CTR");
    const classify = (after: number) =>
      classifyMeasurement({
        baseline: sample("GSC_CTR", 0.02),
        comparison: sample("GSC_CTR", after),
        rule,
        overlapIds: [],
        reverted: false,
      });
    expect(classify(0.04).state).toBe("POSITIVE");
    expect(classify(0.005).state).toBe("NEGATIVE");
    expect(classify(0.0201).state).toBe("NEUTRAL");
    expect(classify(0.04).causationClaimed).toBe(false);
  });
  it("recognizes lower-is-better position/performance and indexability", () => {
    expect(
      classifyMeasurement({
        baseline: sample("GSC_POSITION", 8),
        comparison: sample("GSC_POSITION", 6),
        rule: defaultRule("POSITION"),
        overlapIds: [],
        reverted: false,
      }).state,
    ).toBe("POSITIVE");
    expect(
      classifyMeasurement({
        baseline: sample("CRAWL_INDEXABILITY", 0),
        comparison: sample("CRAWL_INDEXABILITY", 1),
        rule: defaultRule("INDEXABILITY"),
        overlapIds: [],
        reverted: false,
      }).state,
    ).toBe("POSITIVE");
  });
  it("uses insufficient data for thin, partial, missing or overlapping evidence", () => {
    const before = sample("GSC_CTR", 0.02),
      after = sample("GSC_CTR", 0.001);
    after.gsc.values.GSC_IMPRESSIONS = 1;
    const args = {
      baseline: before,
      comparison: after,
      rule: defaultRule("CTR"),
      overlapIds: [],
      reverted: false,
    };
    expect(classifyMeasurement(args).state).toBe("INSUFFICIENT_DATA");
    after.gsc.values.GSC_IMPRESSIONS = 1000;
    after.gsc.coverage = false;
    expect(classifyMeasurement(args).reasons).toContain(
      "IMPORT_WINDOW_INCOMPLETE",
    );
    after.gsc.coverage = true;
    expect(
      classifyMeasurement({ ...args, overlapIds: ["other"] }).reasons,
    ).toContain("OVERLAPPING_CHANGES");
    expect(
      classifyMeasurement({
        ...args,
        rule: ruleSchema.parse({ primary: "NONE" }),
      }).state,
    ).toBe("INSUFFICIENT_DATA");
  });
  it("requires sufficient PageSpeed sampling and never claims causation", () => {
    const args = {
      baseline: sample("PAGESPEED_PERFORMANCE", 0.5),
      comparison: sample("PAGESPEED_PERFORMANCE", 0.9),
      rule: ruleSchema.parse({ primary: "PAGESPEED_PERFORMANCE" }),
      overlapIds: [],
      reverted: false,
    };
    args.comparison.psi.samples = 1;
    expect(classifyMeasurement(args).state).toBe("INSUFFICIENT_DATA");
    args.comparison.psi.samples = 3;
    expect(classifyMeasurement(args)).toMatchObject({
      state: "POSITIVE",
      causationClaimed: false,
    });
  });
  it("preserves manual revert outcomes even when data is missing", () => {
    const args = {
      baseline: emptySample("2026-10-01", "2026-10-28", new Date()),
      comparison: emptySample("2026-11-01", "2026-11-28", new Date()),
      rule: defaultRule("CTR"),
      overlapIds: [],
      reverted: true,
    };
    expect(classifyMeasurement(args).state).toBe("REVERTED");
  });
  it("protects changed URL identity against misleading old-page comparison", () => {
    expect(
      classifyMeasurement({
        baseline: sample("GSC_CLICKS", 10),
        comparison: sample("GSC_CLICKS", 1000),
        rule: defaultRule("CLICKS"),
        overlapIds: [],
        reverted: false,
        identityChanged: true,
      }).state,
    ).toBe("INSUFFICIENT_DATA");
  });
});

it("does not misclassify missing daily observations as performance decline", () => {
  const baseline = sample("GSC_CLICKS", 100),
    comparison = sample("GSC_CLICKS", 80);
  comparison.gsc.days = 23;
  expect(
    classifyMeasurement({
      baseline,
      comparison,
      rule: defaultRule("CLICKS"),
      overlapIds: [],
      reverted: false,
    }).reasons,
  ).toContain("OBSERVED_DAY_COUNTS_DIFFER");
});
