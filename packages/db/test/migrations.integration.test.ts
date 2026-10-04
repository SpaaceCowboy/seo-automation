import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCrawlRepository,
  createIntegrationRepository,
  migrateDatabase,
} from "../src/index.js";
import { mapGoogleUrl } from "@roco/integrations";
import * as schema from "../src/schema.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    "TEST_DATABASE_URL is required to run the database integration tests.",
  );
}

describe("foundation migrations", () => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "roco-seo-migration-test",
  });

  beforeAll(async () => {
    await migrateDatabase(pool);
    await pool.query(
      "truncate table issue_definitions, audit_events, jobs, site_hosts, actors, sites restart identity cascade",
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the Phase 1 and Phase 2 tables", async () => {
    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
      [
        [
          "actors",
          "analysis_runs",
          "audit_events",
          "crawl_runs",
          "heading_observations",
          "image_observations",
          "issue_definitions",
          "issue_occurrences",
          "jobs",
          "integration_accounts",
          "integration_sync_runs",
          "integration_unmatched_urls",
          "gsc_page_daily",
          "gsc_query_daily",
          "gsc_page_query_daily",
          "ga4_page_daily",
          "pagespeed_snapshots",
          "search_queries",
          "link_edges",
          "page_metrics",
          "page_snapshots",
          "pages",
          "redirect_hops",
          "robots_observations",
          "site_hosts",
          "sitemap_entries",
          "sitemap_fetches",
          "sites",
          "structured_data_observations",
        ],
      ],
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "actors",
      "analysis_runs",
      "audit_events",
      "crawl_runs",
      "ga4_page_daily",
      "gsc_page_daily",
      "gsc_page_query_daily",
      "gsc_query_daily",
      "heading_observations",
      "image_observations",
      "integration_accounts",
      "integration_sync_runs",
      "integration_unmatched_urls",
      "issue_definitions",
      "issue_occurrences",
      "jobs",
      "link_edges",
      "page_metrics",
      "page_snapshots",
      "pages",
      "pagespeed_snapshots",
      "redirect_hops",
      "robots_observations",
      "search_queries",
      "site_hosts",
      "sitemap_entries",
      "sitemap_fetches",
      "sites",
      "structured_data_observations",
    ]);
  });

  it("preserves snapshots and link graphs independently across crawl runs", async () => {
    const siteId = randomUUID();
    const pageId = randomUUID();
    const firstRun = randomUUID();
    const secondRun = randomUUID();
    const origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites (id, name, canonical_origin, timezone) values ($1, $2, $3, $4)",
      [siteId, "History", origin, "UTC"],
    );
    await pool.query(
      "insert into pages (id, site_id, normalized_url, normalized_url_hash, normalization_version) values ($1, $2, $3, $4, $5)",
      [pageId, siteId, `${origin}/`, randomUUID(), "url-v1"],
    );
    for (const [runId, key, title] of [
      [firstRun, randomUUID(), "Before"],
      [secondRun, randomUUID(), "After"],
    ] as const) {
      await pool.query(
        "insert into crawl_runs (id, site_id, status, start_url, idempotency_key, config_snapshot) values ($1, $2, 'SUCCEEDED', $3, $4, '{}'::jsonb)",
        [runId, siteId, `${origin}/`, key],
      );
      await pool.query(
        "insert into page_snapshots (crawl_run_id, page_id, observed_url, http_status, fetch_status, response_ms, robots_allowed, is_indexable, indexability_reason, title, crawl_depth, parser_version, fetched_at) values ($1, $2, $3, 200, 'SUCCESS', 10, true, true, 'INDEXABLE', $4, 0, 'cheerio-v1', now())",
        [runId, pageId, `${origin}/`, title],
      );
    }
    const result = await pool.query<{ count: string }>(
      "select count(*)::text as count from page_snapshots where page_id = $1",
      [pageId],
    );
    expect(result.rows[0]?.count).toBe("2");
  });

  it("persists logical crawl retries idempotently while retaining separate run history", async () => {
    const repository = createCrawlRepository(drizzle(pool, { schema }));
    const siteId = randomUUID();
    const origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites (id, name, canonical_origin, timezone) values ($1, $2, $3, 'UTC')",
      [siteId, "Repository history", origin],
    );
    await pool.query("insert into site_hosts (site_id, host) values ($1, $2)", [
      siteId,
      new URL(origin).hostname,
    ]);
    const configuration = {
      startUrl: `${origin}/`,
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
    const first = await repository.createRun({
      siteId,
      idempotencyKey: randomUUID(),
      trigger: "MANUAL",
      configuration,
    });
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const makeOutput = (title: string, hash: string) => ({
      startedAt: timestamp,
      finishedAt: timestamp,
      pages: [
        {
          observedUrl: `${origin}/`,
          normalizedUrl: `${origin}/`,
          normalizedUrlHash: hash,
          normalizationVersion: "url-v1",
          finalUrl: `${origin}/`,
          httpStatus: 200,
          fetchStatus: "SUCCESS" as const,
          contentType: "text/html",
          responseMs: 10,
          redirectHops: [],
          canonicalUrl: `${origin}/`,
          metaRobots: [],
          xRobotsTag: [],
          robotsAllowed: true,
          isIndexable: true,
          indexabilityReason: "INDEXABLE",
          title,
          metaDescription: "Description",
          headings: [{ level: 1 as const, position: 0, text: "Heading" }],
          schemaTypes: [],
          hasBreadcrumbs: false,
          images: [],
          links: [
            {
              normalizedUrl: `${origin}/next`,
              anchorText: "Next",
              rel: null,
              isInternal: true,
            },
          ],
          wordCount: 120,
          contentHash: hash,
          htmlHash: hash,
          depth: 0,
          inSitemap: true,
          errorCode: null,
          errorMessage: null,
        },
      ],
      robots: {
        url: `${origin}/robots.txt`,
        status: 200,
        contentHash: hash,
        fetchedAt: timestamp,
        sitemaps: [],
        crawlDelaySeconds: null,
        errorCode: null,
        errorMessage: null,
      },
      sitemaps: [],
      issues: [
        {
          code: "TEST_ISSUE",
          severity: "INFO" as const,
          ruleVersion: "technical-v1",
          pageUrl: `${origin}/`,
          evidence: { title },
          remediation: "Test remediation",
          fingerprint: hash,
        },
      ],
      pageMetrics: [
        {
          pageUrl: `${origin}/`,
          crawlDepth: 0,
          incomingInternalLinks: 0,
          outgoingInternalLinks: 1,
          isOrphan: false,
        },
      ],
      summary: { urlsCrawled: 1 },
    });
    const firstOutput = makeOutput("Before", randomUUID().replaceAll("-", ""));
    await repository.persistResult(first.id, siteId, firstOutput);
    await repository.persistResult(first.id, siteId, firstOutput);

    const second = await repository.createRun({
      siteId,
      idempotencyKey: randomUUID(),
      trigger: "MANUAL",
      configuration,
    });
    await repository.persistResult(
      second.id,
      siteId,
      makeOutput("After", firstOutput.pages[0]!.normalizedUrlHash),
    );

    const counts = await pool.query<{
      snapshots: string;
      edges: string;
      issues: string;
    }>(
      `select
        (select count(*) from page_snapshots ps join pages p on p.id = ps.page_id where p.site_id = $1)::text as snapshots,
        (select count(*) from link_edges le join pages p on p.id = le.source_page_id where p.site_id = $1)::text as edges,
        (select count(*) from issue_occurrences io join analysis_runs ar on ar.id = io.analysis_run_id join crawl_runs cr on cr.id = ar.crawl_run_id where cr.site_id = $1)::text as issues`,
      [siteId],
    );
    expect(counts.rows[0]).toEqual({ snapshots: "2", edges: "2", issues: "2" });
  });

  it("enforces canonical-origin and job-idempotency uniqueness", async () => {
    const origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites (name, canonical_origin, timezone) values ($1, $2, $3)",
      ["Test", origin, "UTC"],
    );
    await expect(
      pool.query(
        "insert into sites (name, canonical_origin, timezone) values ($1, $2, $3)",
        ["Duplicate", origin, "UTC"],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    const key = randomUUID();
    await pool.query(
      "insert into jobs (job_type, idempotency_key, correlation_id) values ($1, $2, $3)",
      ["foundation.noop", key, randomUUID()],
    );
    await expect(
      pool.query(
        "insert into jobs (job_type, idempotency_key, correlation_id) values ($1, $2, $3)",
        ["foundation.noop", key, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("upserts repeated GSC daily imports without duplicating records", async () => {
    const repository = createIntegrationRepository(drizzle(pool, { schema }));
    const siteId = randomUUID();
    const origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites (id, name, canonical_origin, timezone) values ($1, 'Google import', $2, 'UTC')",
      [siteId, origin],
    );
    await pool.query("insert into site_hosts (site_id, host) values ($1, $2)", [
      siteId,
      new URL(origin).hostname,
    ]);
    const accountId = await repository.ensureAccount({
      siteId,
      provider: "GSC",
      propertyIdentifier: `sc-domain:${new URL(origin).hostname}`,
    });
    const run = await repository.createSyncRun({
      siteId,
      accountId,
      provider: "GSC",
      jobType: "sync-gsc",
      dimensionSet: "PAGE",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      idempotencyKey: randomUUID(),
    });
    const mapping = mapGoogleUrl(`${origin}/fa`, {
      canonicalOrigin: origin,
      allowedHosts: [
        { host: new URL(origin).hostname, includeSubdomains: false },
      ],
    });
    const row = {
      dimensionSet: "PAGE" as const,
      date: "2026-09-01",
      page: `${origin}/fa`,
      query: null,
      country: "irn",
      device: "MOBILE",
      searchType: "web",
      dataState: "final",
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 3,
      urlMapping: mapping,
    };
    await repository.persistGscRows(run.id, siteId, [row]);
    await repository.persistGscRows(run.id, siteId, [{ ...row, clicks: 2 }]);
    const result = await pool.query<{ count: string; clicks: number }>(
      "select count(*)::text as count, max(clicks) as clicks from gsc_page_daily where site_id = $1",
      [siteId],
    );
    expect(result.rows[0]).toEqual({ count: "1", clicks: 2 });
  });
});
