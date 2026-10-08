import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Evidence } from "../components/evidence";
import { MeasurementView } from "../components/measurement";
describe("operator evidence rendering", () => {
  it("escapes untrusted text and distinguishes scores from confidence ratios", () => {
    const html = renderToStaticMarkup(
      createElement(Evidence, {
        value: {
          components: { confidence: 80 },
          confidence: 0.8,
          proposal: "<script>untrusted</script>",
        },
      }),
    );
    expect(html).toContain("80%");
    expect(html).not.toContain("8,000%");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("renders backend result states and before/after metrics without classifying them", () => {
    const html = renderToStaticMarkup(
      createElement(MeasurementView, {
        data: {
          baselines: [],
          plans: [{ horizon: 30, readyAt: "2026-10-01T00:00:00Z" }],
          history: {
            results: [
              {
                plan: { horizon: 30 },
                result: {
                  state: "POSITIVE",
                  outcome: {
                    primary: "GSC_CTR",
                    before: 0.02,
                    after: 0.04,
                    reasons: [],
                    warnings: ["Association does not prove causation."],
                  },
                },
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain("POSITIVE");
    expect(html).toContain("2%");
    expect(html).toContain("4%");
    expect(html).toContain("WAITING FOR MEASUREMENT");
    expect(html).toContain("does not prove causation");
  });
});
