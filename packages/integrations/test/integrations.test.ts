import { describe, expect, it, vi } from "vitest";

import {
  createGa4Client,
  createGscClient,
  mapGoogleUrl,
  normalizeSearchQuery,
  parsePageSpeedResponse,
} from "../src/index.js";

const policy = { timeoutMs: 5_000, retryLimit: 0, requestsPerSecond: 10 };
const tokenProvider = {
  async getAccessToken() {
    return "test-token";
  },
};

describe("Google integration contracts", () => {
  it("paginates and normalizes GSC rows", async () => {
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected JSON body");
        const body = JSON.parse(init.body) as { startRow: number };
        const rows =
          body.startRow === 0
            ? [
                {
                  keys: [
                    "2026-09-01",
                    "https://example.com/a",
                    "irn",
                    "MOBILE",
                  ],
                  clicks: 1,
                  impressions: 10,
                  ctr: 0.1,
                  position: 3,
                },
                {
                  keys: [
                    "2026-09-01",
                    "https://example.com/b",
                    "irn",
                    "DESKTOP",
                  ],
                  clicks: 2,
                  impressions: 20,
                  ctr: 0.1,
                  position: 4,
                },
              ]
            : [
                {
                  keys: [
                    "2026-09-02",
                    "https://example.com/c",
                    "usa",
                    "MOBILE",
                  ],
                  clicks: 3,
                  impressions: 30,
                  ctr: 0.1,
                  position: 5,
                },
              ];
        return new Response(JSON.stringify({ rows }), { status: 200 });
      },
    );
    const result = await createGscClient({
      tokenProvider,
      policy,
      fetcher,
    }).queryAll({
      property: "sc-domain:example.com",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      dimensionSet: "PAGE",
      rowLimit: 2,
    });
    expect(result.requestCount).toBe(2);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      date: "2026-09-01",
      page: "https://example.com/a",
      country: "irn",
      device: "MOBILE",
    });
  });

  it("normalizes the selected GA4 organic landing metrics", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rowCount: 1,
            rows: [
              {
                dimensionValues: [
                  { value: "20260901" },
                  { value: "/fa/?b=2&a=1" },
                ],
                metricValues: [
                  { value: "10" },
                  { value: "8" },
                  { value: "6" },
                  { value: "0.6" },
                  { value: "2" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await createGa4Client({
      tokenProvider,
      policy,
      fetcher,
    }).queryOrganicLandingPages({
      propertyId: "123",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
    });
    expect(result.rows[0]).toEqual({
      date: "2026-09-01",
      landingPage: "/fa/?b=2&a=1",
      channel: "Organic Search",
      sessions: 10,
      totalUsers: 8,
      engagedSessions: 6,
      engagementRate: 0.6,
      keyEvents: 2,
    });
  });

  it("maps only same-scope Google URLs and preserves unmatched observations", () => {
    const scope = {
      canonicalOrigin: "https://example.com",
      allowedHosts: [{ host: "example.com", includeSubdomains: false }],
    };
    expect(mapGoogleUrl("/fa/?b=2&a=1#x", scope)).toMatchObject({
      matchedScope: true,
      normalizedUrl: "https://example.com/fa/?a=1&b=2",
      reason: "MATCHED",
    });
    expect(mapGoogleUrl("https://other.example/a", scope)).toMatchObject({
      matchedScope: false,
      normalizedUrl: null,
      reason: "OUTSIDE_SITE_SCOPE",
    });
  });

  it("keeps Persian query identity deterministic without character folding", () => {
    const first = normalizeSearchQuery("  بیمه   خودرو ");
    const second = normalizeSearchQuery("بیمه خودرو");
    expect(first.queryHash).toBe(second.queryHash);
    expect(first.normalizedQuery).toBe("بیمه خودرو");
  });

  it("parses PageSpeed lab and field metrics without inventing missing INP", () => {
    const snapshot = parsePageSpeedResponse("https://example.com/", "mobile", {
      lighthouseResult: {
        lighthouseVersion: "12.0.0",
        fetchTime: "2026-09-01T00:00:00.000Z",
        categories: { performance: { score: 0.91 } },
        audits: {
          "largest-contentful-paint": { numericValue: 2100 },
          "cumulative-layout-shift": { numericValue: 0.08 },
        },
      },
      loadingExperience: {
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: {
            percentile: 2300,
            category: "AVERAGE",
          },
        },
      },
    });
    expect(snapshot).toMatchObject({
      performanceScore: 0.91,
      lcpMs: 2100,
      inpMs: null,
      cls: 0.08,
      fieldLcpMs: 2300,
      fieldInpMs: null,
      fieldDataAvailable: true,
    });
  });

  it("rejects malformed PageSpeed responses", () => {
    expect(() =>
      parsePageSpeedResponse("https://example.com/", "desktop", {}),
    ).toThrow();
  });
});
