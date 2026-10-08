import { createHash } from "node:crypto";

import {
  analyzeTechnicalIssues,
  evaluateIndexability,
  isInternalUrl,
  normalizeUrl,
  type AnalyzedPage,
} from "@roco/seo-core";

import { extractHtml } from "./extract.js";
import { createHttpFetcher } from "./fetcher.js";
import { parseRobots, type ParsedRobots } from "./robots.js";
import { parseSitemap } from "./sitemap.js";
import type {
  CrawlDependencies,
  CrawlOutput,
  CrawlPolicy,
  CrawledPage,
  ExtractedPage,
  RobotsObservation,
  SitemapObservation,
} from "./types.js";

const EMPTY_EXTRACTION: ExtractedPage = {
  title: null,
  metaDescription: null,
  canonicalUrl: null,
  metaRobots: [],
  headings: [],
  schemaTypes: [],
  hasBreadcrumbs: false,
  images: [],
  links: [],
  wordCount: 0,
  contentHash: "",
  htmlHash: "",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseHeaderDirectives(value: string | null): string[] {
  return (value ?? "")
    .split(/[;,]/u)
    .map((part) =>
      part
        .trim()
        .toLowerCase()
        .replace(/^[a-z0-9_-]+:\s*/u, ""),
    )
    .filter(Boolean);
}

async function fetchRobots(
  policy: CrawlPolicy,
  fetcher: ReturnType<typeof createHttpFetcher>,
): Promise<{ observation: RobotsObservation; policy: ParsedRobots }> {
  const robotsUrl = new URL(
    "/robots.txt",
    policy.scope.canonicalOrigin,
  ).toString();
  const result = await fetcher.fetch(robotsUrl);
  const fetchedAt = new Date();
  if (result.body === null || result.status === null || result.status >= 400) {
    return {
      observation: {
        url: robotsUrl,
        status: result.status,
        contentHash: result.body === null ? null : sha256(result.body),
        fetchedAt,
        sitemaps: [],
        crawlDelaySeconds: null,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
      policy: parseRobots("", policy.userAgent),
    };
  }
  const parsed = parseRobots(result.body, policy.userAgent);
  if (parsed.crawlDelaySeconds !== null)
    fetcher.setMinimumDelay(parsed.crawlDelaySeconds * 1_000);
  return {
    observation: {
      url: robotsUrl,
      status: result.status,
      contentHash: sha256(result.body),
      fetchedAt,
      sitemaps: parsed.sitemaps,
      crawlDelaySeconds: parsed.crawlDelaySeconds,
      errorCode: null,
      errorMessage: null,
    },
    policy: parsed,
  };
}

async function fetchSitemaps(
  policy: CrawlPolicy,
  fetcher: ReturnType<typeof createHttpFetcher>,
  initialUrls: readonly string[],
): Promise<{ observations: SitemapObservation[]; pageUrls: Set<string> }> {
  const queue = [...new Set(initialUrls)];
  const visited = new Set<string>();
  const observations: SitemapObservation[] = [];
  const pageUrls = new Set<string>();
  const parentByUrl = new Map<string, string | null>(
    queue.map((url) => [url, null]),
  );

  while (queue.length > 0 && visited.size < 20) {
    const candidate = queue.shift();
    if (candidate === undefined) break;
    let normalized: string;
    try {
      normalized = normalizeUrl(candidate, policy.scope.canonicalOrigin, {
        ignoredQueryParameters: policy.ignoredQueryParameters,
      }).normalizedUrl;
    } catch {
      continue;
    }
    if (visited.has(normalized) || !isInternalUrl(normalized, policy.scope))
      continue;
    visited.add(normalized);
    const result = await fetcher.fetch(normalized);
    if (
      result.body === null ||
      result.status === null ||
      result.status >= 400
    ) {
      observations.push({
        url: normalized,
        parentUrl: parentByUrl.get(candidate) ?? null,
        status: result.status,
        contentHash: result.body === null ? null : sha256(result.body),
        documentType: "INVALID",
        entries: [],
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      });
      continue;
    }
    try {
      const parsed = parseSitemap(result.body);
      const entries = parsed.entries.flatMap((entry) => {
        try {
          const entryUrl = normalizeUrl(entry.url, normalized, {
            ignoredQueryParameters: policy.ignoredQueryParameters,
          }).normalizedUrl;
          if (!isInternalUrl(entryUrl, policy.scope)) return [];
          return [{ url: entryUrl, lastModified: entry.lastModified }];
        } catch {
          return [];
        }
      });
      observations.push({
        url: normalized,
        parentUrl: parentByUrl.get(candidate) ?? null,
        status: result.status,
        contentHash: sha256(result.body),
        documentType: parsed.type,
        entries,
        errorCode: null,
        errorMessage: null,
      });
      if (parsed.type === "INDEX") {
        for (const entry of entries) {
          if (!visited.has(entry.url)) {
            parentByUrl.set(entry.url, normalized);
            queue.push(entry.url);
          }
        }
      } else {
        for (const entry of entries) pageUrls.add(entry.url);
      }
    } catch {
      observations.push({
        url: normalized,
        parentUrl: parentByUrl.get(candidate) ?? null,
        status: result.status,
        contentHash: sha256(result.body),
        documentType: "INVALID",
        entries: [],
        errorCode: "SITEMAP_PARSE_ERROR",
        errorMessage: "Sitemap could not be parsed",
      });
    }
  }
  return { observations, pageUrls };
}

export async function crawlSite(
  policy: CrawlPolicy,
  dependencies: CrawlDependencies = {},
): Promise<CrawlOutput> {
  const now = dependencies.now ?? Date.now;
  const startedMs = now();
  const startedAt = new Date(startedMs);
  const fetcher = createHttpFetcher(policy, dependencies);
  const robotsResult = await fetchRobots(policy, fetcher);
  const defaultSitemap = new URL(
    "/sitemap.xml",
    policy.scope.canonicalOrigin,
  ).toString();
  const sitemapResult = await fetchSitemaps(policy, fetcher, [
    ...robotsResult.observation.sitemaps,
    defaultSitemap,
  ]);

  const start = normalizeUrl(policy.startUrl, undefined, {
    ignoredQueryParameters: policy.ignoredQueryParameters,
  });
  const frontier = new Map<
    string,
    { observedUrl: string; depth: number; priority: 0 | 1 }
  >();
  frontier.set(start.normalizedUrl, {
    observedUrl: policy.startUrl,
    depth: 0,
    priority: 0,
  });
  for (const url of sitemapResult.pageUrls) {
    if (frontier.size >= policy.maxPages * 5) break;
    if (!frontier.has(url))
      frontier.set(url, { observedUrl: url, depth: 0, priority: 1 });
  }
  const queued = new Set(frontier.keys());
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  async function processPage(
    normalizedUrl: string,
    entry: { observedUrl: string; depth: number; priority: 0 | 1 },
  ): Promise<CrawledPage> {
    const normalized = normalizeUrl(normalizedUrl, undefined, {
      ignoredQueryParameters: policy.ignoredQueryParameters,
    });
    const robotsAllowed =
      !policy.respectRobots ||
      robotsResult.policy.isAllowed(normalized.normalizedUrl);
    if (!robotsAllowed) {
      return {
        observedUrl: entry.observedUrl,
        normalizedUrl: normalized.normalizedUrl,
        normalizedUrlHash: normalized.normalizedUrlHash,
        normalizationVersion: normalized.version,
        finalUrl: null,
        httpStatus: null,
        fetchStatus: "BLOCKED",
        contentType: null,
        responseMs: 0,
        redirectHops: [],
        canonicalUrl: null,
        metaRobots: [],
        xRobotsTag: [],
        robotsAllowed: false,
        isIndexable: false,
        indexabilityReason: "ROBOTS_DISALLOWED",
        title: null,
        metaDescription: null,
        headings: [],
        schemaTypes: [],
        hasBreadcrumbs: false,
        images: [],
        links: [],
        wordCount: 0,
        contentHash: null,
        htmlHash: null,
        depth: entry.depth,
        inSitemap: sitemapResult.pageUrls.has(normalized.normalizedUrl),
        errorCode: "ROBOTS_DISALLOWED",
        errorMessage: "URL is disallowed by robots.txt",
      };
    }

    const fetched = await fetcher.fetch(normalized.normalizedUrl);
    const contentType =
      fetched.headers["content-type"]?.split(";", 1)[0]?.trim() ?? null;
    const html =
      fetched.body !== null &&
      (contentType ?? "").toLowerCase().includes("text/html")
        ? extractHtml(
            fetched.body,
            fetched.finalUrl ?? normalized.normalizedUrl,
            policy.scope,
            policy.ignoredQueryParameters,
          )
        : EMPTY_EXTRACTION;
    const xRobotsTag = parseHeaderDirectives(
      fetched.headers["x-robots-tag"] ?? null,
    );
    const indexability = evaluateIndexability({
      httpStatus: fetched.status,
      contentType,
      metaRobots: html.metaRobots,
      xRobotsTag,
      robotsAllowed,
      normalizedUrl: normalized.normalizedUrl,
      canonicalUrl: html.canonicalUrl,
    });
    return {
      observedUrl: entry.observedUrl,
      normalizedUrl: normalized.normalizedUrl,
      normalizedUrlHash: normalized.normalizedUrlHash,
      normalizationVersion: normalized.version,
      finalUrl: fetched.finalUrl,
      httpStatus: fetched.status,
      fetchStatus: fetched.fetchStatus,
      contentType,
      responseMs: fetched.responseMs,
      redirectHops: fetched.redirectHops,
      canonicalUrl: html.canonicalUrl,
      metaRobots: html.metaRobots,
      xRobotsTag,
      robotsAllowed,
      isIndexable: indexability.isIndexable,
      indexabilityReason: indexability.reason,
      title: html.title,
      metaDescription: html.metaDescription,
      headings: html.headings,
      schemaTypes: html.schemaTypes,
      hasBreadcrumbs: html.hasBreadcrumbs,
      images: html.images,
      links: html.links,
      wordCount: html.wordCount,
      contentHash: html.contentHash === "" ? null : html.contentHash,
      htmlHash: html.htmlHash === "" ? null : html.htmlHash,
      depth: entry.depth,
      inSitemap: sitemapResult.pageUrls.has(normalized.normalizedUrl),
      errorCode: fetched.errorCode,
      errorMessage: fetched.errorMessage,
    };
  }

  while (frontier.size > 0 && pages.length < policy.maxPages) {
    if (await dependencies.isCancelled?.()) break;
    const batch = [...frontier.entries()]
      .sort(([, left], [, right]) =>
        left.priority === right.priority
          ? left.depth - right.depth
          : left.priority - right.priority,
      )
      .slice(0, Math.min(policy.concurrency, policy.maxPages - pages.length));
    for (const [url] of batch) frontier.delete(url);
    const results = await Promise.all(
      batch.map(async ([url, entry]) => ({
        url,
        entry,
        page: await processPage(url, entry),
      })),
    );
    for (const { url, entry, page } of results) {
      visited.add(url);
      pages.push(page);
      if (entry.depth >= policy.maxDepth) continue;
      for (const link of page.links) {
        if (
          !link.isInternal ||
          visited.has(link.normalizedUrl) ||
          queued.has(link.normalizedUrl)
        )
          continue;
        queued.add(link.normalizedUrl);
        frontier.set(link.normalizedUrl, {
          observedUrl: link.observedUrl,
          depth: entry.depth + 1,
          priority: 0,
        });
      }
    }
  }

  const analyzedPages: AnalyzedPage[] = pages.map((page) => ({
    normalizedUrl: page.normalizedUrl,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    fetchStatus: page.fetchStatus,
    isIndexable: page.isIndexable,
    indexabilityReason: page.indexabilityReason,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    metaDescription: page.metaDescription,
    headings: page.headings,
    imageCount: page.images.length,
    missingAltCount: page.images.filter((image) => !image.hasAltAttribute)
      .length,
    wordCount: page.wordCount,
    redirectCount: page.redirectHops.length,
    redirectLoop: page.fetchStatus === "REDIRECT_LOOP",
    depth: page.depth,
    inSitemap: page.inSitemap,
    internalTargets: page.links
      .filter((link) => link.isInternal)
      .map((link) => link.normalizedUrl),
  }));
  const analysis = analyzeTechnicalIssues(analyzedPages, start.normalizedUrl);
  const finishedMs = now();
  const codes = analysis.issues.map((item) => item.code);
  const summary = {
    urlsDiscovered: queued.size,
    urlsCrawled: pages.length,
    successfulPages: pages.filter(
      (page) =>
        page.httpStatus !== null &&
        page.httpStatus >= 200 &&
        page.httpStatus < 300,
    ).length,
    indexablePages: pages.filter((page) => page.isIndexable).length,
    redirects: pages.filter((page) => page.redirectHops.length > 0).length,
    http4xx: pages.filter(
      (page) =>
        page.httpStatus !== null &&
        page.httpStatus >= 400 &&
        page.httpStatus < 500,
    ).length,
    http5xx: pages.filter(
      (page) => page.httpStatus !== null && page.httpStatus >= 500,
    ).length,
    noindex: pages.filter((page) => page.indexabilityReason === "NOINDEX")
      .length,
    canonicalIssues: codes.filter((code) => code.startsWith("CANONICAL_"))
      .length,
    missingTitles: codes.filter((code) => code === "TITLE_MISSING").length,
    duplicateTitles: codes.filter((code) => code === "TITLE_DUPLICATE").length,
    missingDescriptions: codes.filter(
      (code) => code === "META_DESCRIPTION_MISSING",
    ).length,
    orphanPages: codes.filter((code) => code === "ORPHAN_PAGE").length,
    maximumCrawlDepth: Math.max(0, ...pages.map((page) => page.depth)),
    brokenInternalLinks: codes.filter((code) => code === "BROKEN_INTERNAL_LINK")
      .length,
    issueCount: analysis.issues.length,
    durationMs: finishedMs - startedMs,
  };

  return {
    startedAt,
    finishedAt: new Date(finishedMs),
    pages,
    robots: robotsResult.observation,
    sitemaps: sitemapResult.observations,
    issues: analysis.issues,
    pageMetrics: analysis.metrics,
    summary,
  };
}
