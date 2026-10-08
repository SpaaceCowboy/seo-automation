import { configSchema, detectOpportunities } from "@roco/opportunities";
import {
  config as opportunityConfig,
  fixture as opportunityFixture,
} from "../../opportunities/test/fixtures.js";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCrawlRepository,
  createIntegrationRepository,
  createOpportunityRepository,
  type OpportunityRepository,
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
          "opportunities",
          "opportunity_events",
          "opportunity_runs",
          "opportunity_scores",
          "scoring_configs",
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
      "opportunities",
      "opportunity_events",
      "opportunity_runs",
      "opportunity_scores",
      "page_metrics",
      "page_snapshots",
      "pages",
      "pagespeed_snapshots",
      "redirect_hops",
      "robots_observations",
      "scoring_configs",
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

    const key: string = randomUUID();
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

// Phase 4 uses the same isolated database and test file so the existing truncation
// cannot race a second integration suite.
describe("Phase 4 historical opportunities", () => {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "roco-phase4-test",
  });
  let repository: OpportunityRepository;
  beforeAll(async () => {
    await migrateDatabase(pool);
    repository = createOpportunityRepository(drizzle(pool, { schema }));
  });
  afterAll(async () => {
    await pool.end();
  });
  async function seed() {
    const siteId = randomUUID();
    const data = opportunityFixture();
    const origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Phase 4 fixture',$2,'UTC')",
      [siteId, origin],
    );
    const pageIds = new Map<string, string>();
    for (const p of data.crawl!.pages) {
      const id = randomUUID();
      pageIds.set(p.id, id);
      const url = p.url.replace("https://example.test", origin);
      const mapping = mapGoogleUrl(url, {
        canonicalOrigin: origin,
        allowedHosts: [
          { host: new URL(origin).hostname, includeSubdomains: false },
        ],
      });
      await pool.query(
        "insert into pages(id,site_id,normalized_url,normalized_url_hash,normalization_version) values($1,$2,$3,$4,'url-v1')",
        [id, siteId, url, mapping.normalizedUrlHash],
      );
    }
    const queryIds = new Map<string, string>();
    for (const key of ["forex", "gap"]) {
      const id = randomUUID();
      queryIds.set(key, id);
      await pool.query(
        "insert into search_queries(id,site_id,display_query,normalized_query,query_hash) values($1,$2,$3,$3,$4)",
        [id, siteId, key, randomUUID()],
      );
    }
    const pageSync = randomUUID();
    const pairSync = randomUUID();
    for (const [id, dimension] of [
      [pageSync, "PAGE"],
      [pairSync, "PAGE_QUERY"],
    ])
      await pool.query(
        "insert into integration_sync_runs(id,site_id,provider,job_type,dimension_set,start_date,end_date,status,idempotency_key) values($1,$2,'GSC','sync-gsc',$3,'2026-09-15','2026-09-28','SUCCEEDED',$4)",
        [id, siteId, dimension, randomUUID()],
      );
    for (const row of data.pageMetrics) {
      const url = row.url.replace("https://example.test", origin);
      await pool.query(
        "insert into gsc_page_daily(site_id,sync_run_id,page_id,date,observed_url,normalized_url,normalized_url_hash,normalization_version,clicks,impressions,ctr,position) values($1,$2,$3,$4,$5,$5,$6,'url-v1',$7,$8,$9,$10)",
        [
          siteId,
          pageSync,
          pageIds.get(row.pageId!),
          row.date,
          url,
          mapGoogleUrl(url, {
            canonicalOrigin: origin,
            allowedHosts: [
              { host: new URL(origin).hostname, includeSubdomains: false },
            ],
          }).normalizedUrlHash,
          row.clicks,
          row.impressions,
          row.clicks / row.impressions,
          row.position,
        ],
      );
    }
    for (const row of data.pageQueryMetrics) {
      const url = row.url.replace("https://example.test", origin);
      await pool.query(
        "insert into gsc_page_query_daily(site_id,sync_run_id,page_id,query_id,date,observed_url,normalized_url,normalized_url_hash,normalization_version,clicks,impressions,ctr,position) values($1,$2,$3,$4,$5,$6,$6,$7,'url-v1',$8,$9,$10,$11)",
        [
          siteId,
          pairSync,
          pageIds.get(row.pageId!),
          queryIds.get(row.queryId!),
          row.date,
          url,
          mapGoogleUrl(url, {
            canonicalOrigin: origin,
            allowedHosts: [
              { host: new URL(origin).hostname, includeSubdomains: false },
            ],
          }).normalizedUrlHash,
          row.clicks,
          row.impressions,
          row.clicks / row.impressions,
          row.position,
        ],
      );
    }
    const crawlId = randomUUID();
    await pool.query(
      "insert into crawl_runs(id,site_id,status,start_url,idempotency_key,config_snapshot,finished_at) values($1,$2,'SUCCEEDED',$3,$4,'{}','2026-09-28T10:00:00Z')",
      [crawlId, siteId, origin, randomUUID()],
    );
    for (const p of data.crawl!.pages) {
      const pageId = pageIds.get(p.id)!;
      await pool.query(
        "insert into page_snapshots(crawl_run_id,page_id,observed_url,http_status,fetch_status,response_ms,robots_allowed,is_indexable,indexability_reason,crawl_depth,parser_version,fetched_at) values($1,$2,$3,200,'SUCCESS',10,true,true,'INDEXABLE',$4,'cheerio-v1','2026-09-28T10:00:00Z')",
        [
          crawlId,
          pageId,
          p.url.replace("https://example.test", origin),
          p.depth,
        ],
      );
      await pool.query(
        "insert into page_metrics(crawl_run_id,page_id,crawl_depth,incoming_internal_links,outgoing_internal_links,is_orphan) values($1,$2,$3,$4,0,$5)",
        [crawlId, pageId, p.depth, p.incoming, p.orphan],
      );
    }
    return { siteId, origin, pageIds, pageSync };
  }
  const command = (siteId: string, key: string = randomUUID()) => ({
    siteId,
    endDate: "2026-09-28",
    config: opportunityConfig,
    idempotencyKey: key,
    correlationId: "phase4-integration",
  });
  it("previews source data in a read-only transaction without creating configuration or runs", async () => {
    const { siteId } = await seed();
    const input = await repository.previewInput(
      siteId,
      "2026-09-28",
      opportunityConfig,
    );
    expect(
      detectOpportunities(input, opportunityConfig).candidates,
    ).toHaveLength(8);
    const counts = await pool.query<{ runs: number; configs: number }>(
      "select (select count(*)::int from opportunity_runs where site_id=$1) runs,(select count(*)::int from scoring_configs where site_id=$1) configs",
      [siteId],
    );
    expect(counts.rows[0]).toEqual({ runs: 0, configs: 0 });
  });
  it("freezes source evidence across retries and enforces immutable configurations and results", async () => {
    const { siteId } = await seed();
    const run = await repository.createRun(command(siteId));
    const capture = (await repository.captureInput(run.id))!;
    expect(capture.input.pageMetrics).toHaveLength(42);
    expect(capture.input.pageQueryMetrics).toHaveLength(28);
    await pool.query(
      "update gsc_page_daily set clicks=clicks+1 where site_id=$1",
      [siteId],
    );
    const retried = (await repository.captureInput(run.id))!;
    expect(retried.input).toEqual(capture.input);
    const result = detectOpportunities(capture.input, capture.config);
    await repository.persistResult(run.id, result, 10);
    await repository.persistResult(run.id, result, 10);
    expect((await repository.getRun(run.id))?.statistics).toMatchObject({
      created: 8,
      updated: 0,
    });
    await expect(
      pool.query(
        "update scoring_configs set version='changed' where site_id=$1",
        [siteId],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query(
        "update opportunity_runs set input_snapshot='{}' where id=$1",
        [run.id],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("delete from opportunity_scores where run_id=$1", [run.id]),
    ).rejects.toThrow("immutable");
  });
  it("deduplicates repeated runs, preserves acknowledgement/dismissal and records resolution/reopen history", async () => {
    const { siteId } = await seed();
    const first = await repository.createRun(command(siteId));
    const capture = (await repository.captureInput(first.id))!;
    const result = detectOpportunities(capture.input, capture.config);
    await repository.persistResult(first.id, result, 1);
    const actorId = randomUUID();
    await pool.query(
      "insert into actors(id,type,display_name) values($1,'HUMAN','Fixture operator')",
      [actorId],
    );
    const editable = await pool.query<{ id: string; type: string }>(
      "select id,type from opportunities where site_id=$1 and type in ('CTR','QUICK_WIN')",
      [siteId],
    );
    for (const o of editable.rows)
      await repository.changeStatus({
        siteId,
        id: o.id,
        actorId,
        correlationId: "operator",
        expectedStatus: "OPEN",
        status: o.type === "CTR" ? "DISMISSED" : "ACKNOWLEDGED",
        reason: "Fixture review",
      });
    expect(
      (
        await pool.query(
          "select count(*)::int as count from audit_events where actor_id=$1",
          [actorId],
        )
      ).rows[0].count,
    ).toBe(3);
    await expect(
      repository.changeStatus({
        siteId,
        id: editable.rows[0]!.id,
        actorId: randomUUID(),
        correlationId: "forged",
        expectedStatus: "OPEN",
        status: "DISMISSED",
        reason: "Unattributed",
      }),
    ).rejects.toThrow("active configured operator");
    const second = await repository.createRun(command(siteId));
    await repository.captureInput(second.id);
    await repository.persistResult(second.id, result, 1);
    const counts = await pool.query(
      "select (select count(*)::int from opportunities where site_id=$1) opportunities,(select count(*)::int from opportunity_scores where run_id=any($2::uuid[])) scores",
      [siteId, [first.id, second.id]],
    );
    expect(counts.rows[0]).toEqual({ opportunities: 8, scores: 16 });
    const statuses = await pool.query(
      "select type,status from opportunities where site_id=$1",
      [siteId],
    );
    expect(
      statuses.rows
        .filter((r) => r.type === "QUICK_WIN")
        .every((r) => r.status === "ACKNOWLEDGED"),
    ).toBe(true);
    expect(statuses.rows.find((r) => r.type === "CTR").status).toBe(
      "DISMISSED",
    );
    const third = await repository.createRun(command(siteId));
    await repository.captureInput(third.id);
    await repository.persistResult(third.id, { ...result, candidates: [] }, 1);
    expect((await repository.getRun(third.id))!.statistics!.resolved).toBe(7);
    const fourth = await repository.createRun(command(siteId));
    await repository.captureInput(fourth.id);
    await repository.persistResult(fourth.id, result, 1);
    expect((await repository.getRun(fourth.id))!.statistics!.created).toBe(0);
    const detail = (await repository.detail(
      siteId,
      (
        await pool.query<{ id: string }>(
          "select id from opportunities where site_id=$1 and type='DECAY'",
          [siteId],
        )
      ).rows[0]!.id,
    )) as { events: unknown[] };
    expect(detail.events).toHaveLength(3);
    expect(
      await repository.detail(
        randomUUID(),
        (
          await pool.query<{ id: string }>(
            "select id from opportunities where site_id=$1 limit 1",
            [siteId],
          )
        ).rows[0]!.id,
      ),
    ).toBeNull();
  });
  it("handles concurrent duplicate delivery and prevents older runs replacing current state", async () => {
    const { siteId } = await seed();
    const old = await repository.createRun(command(siteId));
    const capture = (await repository.captureInput(old.id))!;
    const result = detectOpportunities(capture.input, capture.config);
    const current = await repository.createRun(command(siteId));
    await repository.captureInput(current.id);
    await Promise.all([
      repository.persistResult(current.id, result, 1),
      repository.persistResult(current.id, result, 1),
    ]);
    await repository.persistResult(old.id, result, 1);
    expect(
      (await repository.getRun(old.id))!.statistics!.projectionSkipped,
    ).toBe(true);
    const last = await pool.query(
      "select distinct last_run_id from opportunities where site_id=$1",
      [siteId],
    );
    expect(last.rows).toEqual([{ last_run_id: current.id }]);
    await expect(
      repository.createRun({
        ...command(siteId, old.idempotencyKey),
        config: configSchema.parse({
          ...opportunityConfig,
          minImpressions: 999,
        }),
      }),
    ).rejects.toThrow("different detection command");
  });
  it("does not close opportunities for missing imports and marks expired evidence stale", async () => {
    const { siteId, pageSync } = await seed();
    const first = await repository.createRun(command(siteId));
    const capture = (await repository.captureInput(first.id))!;
    await repository.persistResult(
      first.id,
      detectOpportunities(capture.input, capture.config),
      1,
    );
    await pool.query(
      "update integration_sync_runs set status='FAILED' where site_id=$1",
      [siteId],
    );
    const second = await repository.createRun(command(siteId));
    const missing = (await repository.captureInput(second.id))!;
    const result = detectOpportunities(missing.input, missing.config);
    expect(result.candidates).toEqual([]);
    await repository.persistResult(second.id, result, 1);
    expect((await repository.getRun(second.id))!.statistics!.resolved).toBe(0);
    await pool.query(
      "update opportunities set last_detected_at='2020-01-01' where site_id=$1",
      [siteId],
    );
    const third = await repository.createRun(command(siteId));
    await repository.captureInput(third.id);
    await repository.persistResult(third.id, result, 1);
    expect((await repository.getRun(third.id))!.statistics!.staled).toBe(8);
    expect(pageSync).toBeDefined();
  });
});
