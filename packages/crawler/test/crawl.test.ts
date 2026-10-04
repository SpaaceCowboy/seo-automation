import { describe, expect, it, vi } from "vitest";

import { crawlSite, type CrawlPolicy } from "../src/index.js";

function response(
  body: string,
  contentType = "text/html",
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

const policy: CrawlPolicy = {
  startUrl: "https://example.com/",
  scope: {
    canonicalOrigin: "https://example.com",
    allowedHosts: [{ host: "example.com", includeSubdomains: false }],
  },
  userAgent: "RocoSEO/1.0 fixture",
  maxPages: 4,
  maxDepth: 3,
  concurrency: 2,
  requestsPerSecond: 10,
  requestTimeoutMs: 1_000,
  maxResponseBytes: 10_000,
  maxRedirects: 3,
  retryLimit: 0,
  respectRobots: true,
  allowPrivateNetworks: true,
  ignoredQueryParameters: [],
};

describe("crawl workflow", () => {
  it("discovers from links and sitemap, respects robots, persists safe failures, and honors page budget", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/robots.txt"))
        return response(
          "User-agent: *\nDisallow: /blocked\nSitemap: https://example.com/sitemap.xml",
          "text/plain",
        );
      if (url.endsWith("/sitemap.xml"))
        return response(
          "<urlset><url><loc>https://example.com/orphan</loc></url><url><loc>https://example.com/blocked</loc></url></urlset>",
          "application/xml",
        );
      if (url === "https://example.com/")
        return response(
          `<title>Home page title</title><meta name="description" content="Home description"><link rel="canonical" href="/"><h1>Home</h1><p>${"word ".repeat(120)}</p><a href="/broken">Broken</a>`,
        );
      if (url.endsWith("/orphan"))
        return response(
          `<title>Orphan page title</title><meta name="description" content="Orphan description"><link rel="canonical" href="/orphan"><h1>Orphan</h1><p>${"word ".repeat(120)}</p>`,
        );
      if (url.endsWith("/broken"))
        return response("not found", "text/html", 404);
      return response("missing", "text/html", 404);
    });
    const output = await crawlSite(policy, {
      fetch: fetchMock,
      sleep: async () => undefined,
    });
    expect(output.pages).toHaveLength(4);
    expect(output.summary.urlsCrawled).toBe(4);
    expect(output.pages.some((page) => page.fetchStatus === "BLOCKED")).toBe(
      true,
    );
    expect(output.issues.map((item) => item.code)).toContain("ORPHAN_PAGE");
    expect(output.sitemaps[0]?.documentType).toBe("URLSET");
  });

  it("checks cancellation between bounded batches", async () => {
    let cancellationChecks = 0;
    const output = await crawlSite(
      { ...policy, maxPages: 10 },
      {
        sleep: async () => undefined,
        isCancelled: async () => ++cancellationChecks > 1,
        fetch: vi.fn(async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : input.toString();
          if (url.endsWith("robots.txt"))
            return response("User-agent: *", "text/plain");
          if (url.endsWith("sitemap.xml"))
            return response("<urlset></urlset>", "application/xml");
          return response(
            `<title>Page title here</title><meta name="description" content="Description"><link rel="canonical" href="/"><h1>Page</h1><a href="/next">Next</a>`,
          );
        }),
      },
    );
    expect(output.pages).toHaveLength(1);
    expect(cancellationChecks).toBe(2);
  });
});
