import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  migrateDatabase,
  createControlRepository,
} from "../../packages/db/src/index.js";
import { controlListSchema } from "../../packages/shared/src/control.js";
import { seedControl } from "../e2e/fixture.js";
import type { Principal } from "../../packages/workflow/src/index.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
describe("Phase 7 bounded database read models", () => {
  const database = createDatabase(url),
    repo = createControlRepository(database.db);
  let data: Awaited<ReturnType<typeof seedControl>>, p: Principal;
  beforeAll(async () => {
    await migrateDatabase(database.pool);
    data = await seedControl(database.pool);
    p = {
      actorId: data.operatorId,
      roles: ["VIEWER"],
      correlationId: "control-read-test",
    };
  });
  afterAll(async () => {
    await database.close();
  });
  it("reads every dashboard area with source provenance and safe empty data", async () => {
    for (const section of [
      "overview",
      "crawls",
      "issues",
      "performance",
      "opportunities",
      "agents",
      "recommendations",
      "changes",
      "measurements",
      "freshness",
      "signals",
    ] as const) {
      const result = controlListSchema.parse(
        await repo.read(data.siteId, section, { limit: 2 }, p),
      );
      expect(result.items.length).toBeLessThanOrEqual(
        section === "overview" || section === "freshness" ? 8 : 2,
      );
    }
    const performance = controlListSchema.parse(
      await repo.read(data.siteId, "performance", {}, p),
    );
    expect(performance.summary.metrics).toMatchObject({
      clicks: 56,
      impressions: 2800,
      ctr: 0.02,
      position: 7,
      observedDays: 28,
    });
    const queries = controlListSchema.parse(
      await repo.read(data.siteId, "performance", { dataset: "QUERY" }, p),
    );
    expect(queries.items).toHaveLength(0);
    expect(queries.summary.metrics).toMatchObject({
      clicks: null,
      impressions: null,
    });
    const ga4 = controlListSchema.parse(
      await repo.read(data.siteId, "performance", { dataset: "GA4" }, p),
    );
    expect(ga4.summary.metrics).toMatchObject({
      sessions: 10,
      dailyUsersSum: 6,
      engagementRate: 0.7,
      keyEvents: 2,
      observedDays: 1,
    });
    const psi = controlListSchema.parse(
      await repo.read(data.siteId, "performance", { dataset: "PAGESPEED" }, p),
    );
    expect(psi.items[0]?.data).toMatchObject({
      performanceScore: 0.91,
      labLcpMs: 1100,
      fieldAvailable: false,
      fieldLcpMs: null,
    });
  });
  it("paginates with stable ordering and applies status/URL/score filters", async () => {
    for (let i = 0; i < 5; i++)
      await database.pool.query(
        "insert into crawl_runs(site_id,start_url,idempotency_key,config_snapshot,status,error_code,finished_at) values($1,$2,$3,'{}','FAILED','FIXTURE_FAILURE',now())",
        [data.siteId, data.url, randomUUID()],
      );
    const first = controlListSchema.parse(
        await repo.read(
          data.siteId,
          "crawls",
          { limit: 2, status: "FAILED" },
          p,
        ),
      ),
      second = controlListSchema.parse(
        await repo.read(
          data.siteId,
          "crawls",
          { limit: 2, offset: 2, status: "FAILED" },
          p,
        ),
      );
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(2);
    expect(
      first.items
        .map((r) => r.id)
        .some((id) => second.items.some((r) => r.id === id)),
    ).toBe(false);
    expect(
      controlListSchema.parse(
        await repo.read(data.siteId, "opportunities", { pageUrl: data.url }, p),
      ).items,
    ).toHaveLength(1);
    expect(
      controlListSchema.parse(
        await repo.read(data.siteId, "opportunities", { minScore: 100 }, p),
      ).items,
    ).toHaveLength(0);
  });
  it("keeps details scoped and actor revocation authoritative", async () => {
    expect(
      await repo.detail(randomUUID(), "opportunities", data.opportunityId, p),
    ).toBeNull();
    expect(
      await repo.detail(data.siteId, "opportunities", data.opportunityId, p),
    ).toHaveProperty("observations");
    expect(
      await repo.detail(data.siteId, "agents", data.agentRunId, p),
    ).toHaveProperty("ruleHints");
    expect(
      await repo.detail(data.siteId, "crawls", data.crawlId, p),
    ).toHaveProperty("status", "SUCCEEDED");
    expect(await repo.read(randomUUID(), "overview", {}, p)).toBeNull();
    await database.pool.query(
      "update actors set disabled_at=now() where id=$1",
      [p.actorId],
    );
    await expect(repo.sites(p)).rejects.toThrow("HUMAN_ACTOR_REQUIRED");
  });
  it("shows empty sites as unavailable crawl data instead of zeros", async () => {
    const siteId = randomUUID();
    await database.pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Empty control site',$2,'UTC')",
      [siteId, `https://${randomUUID()}.example.test`],
    );
    const actorId = data.reviewerId;
    const result = controlListSchema.parse(
      await repo.read(siteId, "overview", {}, { ...p, actorId }),
    );
    expect(result.summary).toMatchObject({
      pages: null,
      indexable: null,
      critical: null,
      latestCrawl: null,
      opportunities: 0,
      reviews: 0,
      measuring: 0,
    });
  });
});
