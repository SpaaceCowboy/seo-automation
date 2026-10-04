import { describe, expect, it } from "vitest";

import {
  extractHtml,
  parseRobots,
  parseSitemap,
  shouldUsePlaywrightFallback,
} from "../src/index.js";

describe("robots and sitemap parsing", () => {
  it("selects specific user-agent rules, allow precedence, crawl delay, and sitemaps", () => {
    const robots = parseRobots(
      `User-agent: *\nDisallow: /private\nUser-agent: RocoSEO\nDisallow: /admin\nAllow: /admin/help\nCrawl-delay: 2\nSitemap: https://example.com/sitemap.xml`,
      "RocoSEO/1.0",
    );
    expect(robots.isAllowed("https://example.com/admin/page")).toBe(false);
    expect(robots.isAllowed("https://example.com/admin/help/article")).toBe(
      true,
    );
    expect(robots.isAllowed("https://example.com/private")).toBe(true);
    expect(robots.crawlDelaySeconds).toBe(2);
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });

  it("parses URL sets and sitemap indexes and rejects unrelated XML", () => {
    expect(
      parseSitemap(
        `<urlset><url><loc>https://example.com/a</loc><lastmod>2026-01-01</lastmod></url></urlset>`,
      ),
    ).toEqual({
      type: "URLSET",
      entries: [{ url: "https://example.com/a", lastModified: "2026-01-01" }],
    });
    expect(
      parseSitemap(
        `<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>`,
      ),
    ).toEqual({
      type: "INDEX",
      entries: [{ url: "https://example.com/child.xml", lastModified: null }],
    });
    expect(() => parseSitemap("<root />")).toThrow("Unsupported sitemap");
    expect(() => parseSitemap("<urlset><url>")).toThrow(
      "Malformed sitemap XML",
    );
  });
});

describe("HTML extraction", () => {
  it("extracts canonical, robots, headings, JSON-LD, images, text, and scoped links", () => {
    const result = extractHtml(
      `<!doctype html><html><head><title> Example title </title><meta name="description" content="Description"><meta name="robots" content="noindex,follow"><link rel="canonical" href="/canonical"><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></head><body><h1>Main</h1><h2>Sub</h2><p>Hello world</p><img src="a.jpg"><a href="/inside">Inside</a><a href="https://outside.test/">Outside</a></body></html>`,
      "https://example.com/page",
      {
        canonicalOrigin: "https://example.com",
        allowedHosts: [{ host: "example.com", includeSubdomains: false }],
      },
    );
    expect(result.title).toBe("Example title");
    expect(result.canonicalUrl).toBe("https://example.com/canonical");
    expect(result.metaRobots).toEqual(["noindex", "follow"]);
    expect(result.headings.map((heading) => heading.level)).toEqual([1, 2]);
    expect(result.schemaTypes).toContain("BreadcrumbList");
    expect(result.hasBreadcrumbs).toBe(true);
    expect(result.images[0]?.hasAltAttribute).toBe(false);
    expect(result.links.map((link) => link.isInternal)).toEqual([true, false]);
  });

  it("does not invoke browser rendering for ordinary static pages", () => {
    expect(
      shouldUsePlaywrightFallback(
        {
          url: "https://example.com/",
          httpStatus: 200,
          contentType: "text/html",
          extractedWordCount: 200,
          hasMeaningfulLinks: true,
        },
        {
          enabled: true,
          allowedUrlPatterns: [/example\.com/u],
          maximumRenderedPages: 2,
        },
        0,
      ),
    ).toBe(false);
    expect(
      shouldUsePlaywrightFallback(
        {
          url: "https://example.com/app",
          httpStatus: 200,
          contentType: "text/html",
          extractedWordCount: 0,
          hasMeaningfulLinks: false,
        },
        {
          enabled: false,
          allowedUrlPatterns: [/example\.com/u],
          maximumRenderedPages: 2,
        },
        0,
      ),
    ).toBe(false);
  });

  it("extracts useful observations from malformed HTML", () => {
    const result = extractHtml(
      "<html><head><title>Broken markup</title><body><h1>Still visible<a href='/next'>Next",
      "https://example.com/",
      {
        canonicalOrigin: "https://example.com",
        allowedHosts: [{ host: "example.com", includeSubdomains: false }],
      },
    );
    expect(result.title).toContain("Broken markup");
    expect(result.headings[0]?.text).toContain("Still visible");
    expect(result.links[0]?.normalizedUrl).toBe("https://example.com/next");
  });
});
