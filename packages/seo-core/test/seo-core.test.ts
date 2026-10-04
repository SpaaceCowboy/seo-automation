import { describe, expect, it } from "vitest";

import {
  analyzeTechnicalIssues,
  compareSnapshots,
  evaluateIndexability,
  isInternalUrl,
  isPrivateIpAddress,
  normalizeUrl,
  type AnalyzedPage,
} from "../src/index.js";

function page(overrides: Partial<AnalyzedPage> = {}): AnalyzedPage {
  return {
    normalizedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    httpStatus: 200,
    fetchStatus: "SUCCESS",
    isIndexable: true,
    indexabilityReason: "INDEXABLE",
    canonicalUrl: "https://example.com/",
    title: "A useful unique page title",
    metaDescription: "A useful unique page description.",
    headings: [{ level: 1, text: "Heading" }],
    imageCount: 0,
    missingAltCount: 0,
    wordCount: 200,
    redirectCount: 0,
    redirectLoop: false,
    depth: 0,
    inSitemap: false,
    internalTargets: [],
    ...overrides,
  };
}

describe("URL normalization and scope", () => {
  it("normalizes fragments, default ports, query order, and Unicode without dropping parameters", () => {
    const normalized = normalizeUrl(
      "HTTPS://EXAMPLE.com:443/مسیر/?b=2&a=1#section",
    );
    expect(normalized.normalizedUrl).toBe(
      "https://example.com/%D9%85%D8%B3%DB%8C%D8%B1/?a=1&b=2",
    );
    expect(normalizeUrl("https://example.com/path").normalizedUrl).not.toBe(
      normalizeUrl("https://example.com/path/").normalizedUrl,
    );
  });

  it("classifies allowed subdomains and rejects external hosts", () => {
    const scope = {
      canonicalOrigin: "https://example.com",
      allowedHosts: [{ host: "example.com", includeSubdomains: true }],
    };
    expect(isInternalUrl("https://shop.example.com/a", scope)).toBe(true);
    expect(isInternalUrl("https://example.net/a", scope)).toBe(false);
  });

  it("identifies private, loopback, and metadata-network addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
  });
});

describe("technical analysis", () => {
  it("evaluates robots, meta, X-Robots, status, and canonical indexability", () => {
    const base = {
      httpStatus: 200,
      contentType: "text/html",
      metaRobots: [] as string[],
      xRobotsTag: [] as string[],
      robotsAllowed: true,
      normalizedUrl: "https://example.com/",
      canonicalUrl: "https://example.com/",
    };
    expect(evaluateIndexability(base)).toEqual({
      isIndexable: true,
      reason: "INDEXABLE",
    });
    expect(
      evaluateIndexability({ ...base, xRobotsTag: ["noindex"] }).reason,
    ).toBe("NOINDEX");
    expect(evaluateIndexability({ ...base, robotsAllowed: false }).reason).toBe(
      "ROBOTS_DISALLOWED",
    );
    expect(
      evaluateIndexability({
        ...base,
        canonicalUrl: "https://example.com/other",
      }).reason,
    ).toBe("CANONICAL_TO_OTHER_URL");
    expect(evaluateIndexability({ ...base, httpStatus: 500 }).reason).toBe(
      "HTTP_500",
    );
  });

  it("finds deterministic page, link, duplicate, depth, and orphan issues", () => {
    const pages = [
      page({
        internalTargets: ["https://example.com/broken"],
        title: "Duplicate page title",
      }),
      page({
        normalizedUrl: "https://example.com/server-error",
        finalUrl: "https://example.com/server-error",
        httpStatus: 500,
      }),
      page({
        normalizedUrl: "https://example.com/broken",
        finalUrl: "https://example.com/broken",
        httpStatus: 404,
        title: "Duplicate page title",
        depth: 5,
        inSitemap: true,
      }),
      page({
        normalizedUrl: "https://example.com/orphan",
        finalUrl: "https://example.com/orphan",
        inSitemap: true,
        title: "Duplicate page title",
      }),
    ];
    const result = analyzeTechnicalIssues(pages, "https://example.com/");
    const codes = result.issues.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "HTTP_4XX",
        "HTTP_5XX",
        "BROKEN_INTERNAL_LINK",
        "TITLE_DUPLICATE",
        "CRAWL_DEPTH_EXCESSIVE",
        "ORPHAN_PAGE",
      ]),
    );
  });

  it("compares metadata, indexability, content, status, and links", () => {
    const changes = compareSnapshots(
      [
        {
          normalizedUrl: "https://example.com/",
          httpStatus: 200,
          title: "Before",
          canonicalUrl: null,
          isIndexable: true,
          contentHash: "a",
          internalTargets: ["https://example.com/old"],
        },
      ],
      [
        {
          normalizedUrl: "https://example.com/",
          httpStatus: 301,
          title: "After",
          canonicalUrl: "https://example.com/new",
          isIndexable: false,
          contentHash: "b",
          internalTargets: ["https://example.com/new"],
        },
      ],
    );
    expect(changes[0]?.changedFields).toEqual([
      "httpStatus",
      "title",
      "canonicalUrl",
      "isIndexable",
      "contentHash",
    ]);
    expect(changes[0]?.addedLinks).toEqual(["https://example.com/new"]);
    expect(changes[0]?.removedLinks).toEqual(["https://example.com/old"]);
  });
});
