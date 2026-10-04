import { describe, expect, it, vi } from "vitest";

import type { CrawlOutput } from "@roco/crawler";
import type { CrawlRepository } from "@roco/db";
import { createLogger } from "@roco/shared";
import type { Job } from "pg-boss";

import { createCrawlSiteHandler } from "../src/jobs/crawl-site.js";

const logger = createLogger({
  service: "crawl-worker-test",
  environment: "test",
  level: "silent",
});
const runId = "11111111-1111-4111-8111-111111111111";
const siteId = "22222222-2222-4222-8222-222222222222";
const configuration = {
  startUrl: "https://example.com/",
  userAgent: "RocoSEO/1.0 test",
  maxPages: 10,
  maxDepth: 3,
  concurrency: 1,
  requestsPerSecond: 1,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1_000_000,
  maxRedirects: 5,
  retryLimit: 1,
  respectRobots: true,
  ignoredQueryParameters: [],
};

function output(): CrawlOutput {
  const timestamp = new Date("2026-01-01T00:00:00Z");
  return {
    startedAt: timestamp,
    finishedAt: timestamp,
    pages: [],
    robots: {
      url: "https://example.com/robots.txt",
      status: 200,
      contentHash: "a",
      fetchedAt: timestamp,
      sitemaps: [],
      crawlDelaySeconds: null,
      errorCode: null,
      errorMessage: null,
    },
    sitemaps: [],
    issues: [],
    pageMetrics: [],
    summary: {
      urlsDiscovered: 0,
      urlsCrawled: 0,
      successfulPages: 0,
      indexablePages: 0,
      redirects: 0,
      http4xx: 0,
      http5xx: 0,
      noindex: 0,
      canonicalIssues: 0,
      missingTitles: 0,
      duplicateTitles: 0,
      missingDescriptions: 0,
      orphanPages: 0,
      maximumCrawlDepth: 0,
      brokenInternalLinks: 0,
      issueCount: 0,
      durationMs: 0,
    },
  };
}

describe("crawl worker job", () => {
  it("runs and persists a queued crawl", async () => {
    const persistResult = vi.fn(async () => undefined);
    const repository = {
      getRun: vi.fn(async () => ({
        id: runId,
        siteId,
        status: "QUEUED",
        startUrl: configuration.startUrl,
        configSnapshot: configuration,
        summary: null,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })),
      getSiteScope: vi.fn(async () => ({
        canonicalOrigin: "https://example.com",
        allowedHosts: [{ host: "example.com", includeSubdomains: false }],
      })),
      markRunning: vi.fn(async () => true),
      isCancelled: vi.fn(async () => false),
      persistResult,
      fail: vi.fn(async () => undefined),
    } as unknown as CrawlRepository;
    const crawl = vi.fn(async () => output());
    const handler = createCrawlSiteHandler({ logger, repository, crawl });
    await handler([
      {
        id: "job-1",
        data: { crawlRunId: runId, siteId, correlationId: "correlation-1" },
      } as Job<unknown>,
    ]);
    expect(crawl).toHaveBeenCalledOnce();
    expect(persistResult).toHaveBeenCalledWith(
      runId,
      siteId,
      expect.objectContaining({
        summary: expect.objectContaining({ urlsCrawled: 0 }),
      }),
    );
  });

  it("does not repeat a terminal logical run", async () => {
    const repository = {
      getRun: vi.fn(async () => ({
        id: runId,
        siteId,
        status: "SUCCEEDED",
        startUrl: configuration.startUrl,
        configSnapshot: configuration,
        summary: {},
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
      })),
    } as unknown as CrawlRepository;
    const crawl = vi.fn(async () => output());
    const handler = createCrawlSiteHandler({ logger, repository, crawl });
    await handler([
      {
        id: "job-2",
        data: { crawlRunId: runId, siteId, correlationId: "correlation-2" },
      } as Job<unknown>,
    ]);
    expect(crawl).not.toHaveBeenCalled();
  });
});
