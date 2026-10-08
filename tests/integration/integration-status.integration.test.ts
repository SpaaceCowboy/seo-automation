import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import {
  createDatabase,
  migrateDatabase,
  createIntegrationStatusRepository,
} from "../../packages/db/src/index.js";
import { statusSnapshot } from "../../packages/shared/test/integration-fixture.js";
import type { Principal } from "../../packages/workflow/src/index.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL required");
describe("integration availability persistence", () => {
  const database = createDatabase(url);
  let now = new Date("2080-01-01T12:00:00Z"),
    instance = randomUUID();
  const repository = createIntegrationStatusRepository(
    database.pool,
    () => new Date(now),
  );
  const actorId = randomUUID(),
    siteId = randomUUID();
  const operator: Principal = {
    actorId,
    roles: ["OPERATOR"],
    correlationId: "metadata-test",
  };
  const viewer = { ...operator, roles: ["VIEWER"] } as Principal;
  beforeAll(async () => {
    await migrateDatabase(database.pool);
    await database.pool.query(
      "delete from agent_budget_months where month='2080-01'",
    );
    await database.pool.query(
      "insert into actors(id,type,display_name) values($1,'HUMAN','Status fixture')",
      [actorId],
    );
    await database.pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Status fixture',$2,'UTC')",
      [siteId, `https://${siteId}.example.test`],
    );
  });
  beforeEach(async () => {
    now = new Date("2080-01-01T12:00:00Z");
    instance = randomUUID();
    await repository.publish(instance, statusSnapshot());
  });
  afterAll(async () => {
    await database.close();
  });
  it("shows activation before the first analysis, with known zero bookings and missing Google setup", async () => {
    const status = await repository.read(siteId, viewer);
    expect(status.worker.state).toBe("ONLINE");
    expect(status.agents.filter((a) => a.enabled).map((a) => a.code)).toEqual([
      "SUPERVISOR",
    ]);
    expect(status.openai.status).toBe("NOT_CHECKED");
    expect(status.openai.canCheck).toBe(false);
    expect(status.budget.limitNanousd).toBe("20000000000");
    expect(status.budget.bookedNanousd).toBe("0");
    expect(status.google.every((g) => g.configured === false)).toBe(true);
  });
  it("coalesces concurrent/manual/scheduled checks and preserves terminal history", async () => {
    const tickets = await Promise.all([
      repository.request("MANUAL", operator),
      repository.request("SCHEDULED"),
      repository.request("STARTUP"),
    ]);
    expect(new Set(tickets.map((t) => t.id)).size).toBe(1);
    expect(tickets.filter((t) => t.enqueue)).toHaveLength(1);
    const check = tickets[0];
    expect(await repository.claim(check.id, instance)).not.toBeNull();
    await repository.finish(check.id, {
      status: "VERIFIED",
      errorCode: null,
      httpStatus: 200,
      durationMs: 12,
    });
    expect((await repository.read(siteId, operator)).openai).toMatchObject({
      status: "VERIFIED",
      canCheck: false,
      cooldownSeconds: 60,
    });
    expect((await repository.request("MANUAL", operator)).enqueue).toBe(false);
    await expect(
      database.pool.query(
        "update integration_connection_checks set http_status=500 where id=$1",
        [check.id],
      ),
    ).rejects.toThrow("immutable");
    now = new Date(now.getTime() + 61000);
    await repository.heartbeat(instance, true);
    expect((await repository.request("MANUAL", operator)).id).not.toBe(
      check.id,
    );
  });
  it("invalidates earlier credentials/configuration on restart and fences late completions", async () => {
    const check = await repository.request("STARTUP");
    await repository.claim(check.id, instance);
    instance = randomUUID();
    await repository.publish(instance, statusSnapshot());
    await repository.finish(check.id, {
      status: "VERIFIED",
      errorCode: null,
      httpStatus: 200,
      durationMs: 1,
    });
    expect((await repository.read(siteId, operator)).openai.status).toBe(
      "NOT_CHECKED",
    );
    expect(
      (
        await database.pool.query(
          "select status from integration_connection_checks where id=$1",
          [check.id],
        )
      ).rows[0].status,
    ).toBe("SUPERSEDED");
  });
  it("degrades stale telemetry, denies manual checks to viewers and uses the tighter shared budget", async () => {
    await expect(repository.request("MANUAL", viewer)).rejects.toThrow(
      "FORBIDDEN",
    );
    await database.pool.query(
      "insert into agent_budget_months(month,limit_nanousd,booked_nanousd) values('2080-01',10000000000,7000000000) on conflict(month) do update set limit_nanousd=excluded.limit_nanousd,booked_nanousd=excluded.booked_nanousd",
    );
    expect((await repository.read(siteId, viewer)).budget).toMatchObject({
      limitNanousd: "10000000000",
      remainingNanousd: "3000000000",
    });
    now = new Date(now.getTime() + 46000);
    expect((await repository.read(siteId, viewer)).worker.state).toBe(
      "OFFLINE",
    );
    expect(
      (await repository.read(siteId, viewer)).agents.every(
        (a) => a.enabled === null,
      ),
    ).toBe(true);
    await expect(repository.request("MANUAL", operator)).rejects.toThrow(
      "WORKER_UNAVAILABLE",
    );
  });
  it("reconciles interrupted checks and reports stale provider verification independently of worker health", async () => {
    const first = await repository.request("STARTUP");
    await repository.claim(first.id, instance);
    now = new Date(now.getTime() + 61000);
    await repository.heartbeat(instance, true);
    await repository.request("SCHEDULED");
    expect(
      (
        await database.pool.query(
          "select status from integration_connection_checks where id=$1",
          [first.id],
        )
      ).rows[0].status,
    ).toBe("SUPERSEDED");
    const latest = await repository.request("SCHEDULED");
    await repository.claim(latest.id, instance);
    await repository.finish(latest.id, {
      status: "VERIFIED",
      errorCode: null,
      httpStatus: 200,
      durationMs: 1,
    });
    now = new Date(now.getTime() + 1200001);
    await repository.heartbeat(instance, true);
    expect((await repository.read(siteId, viewer)).openai.status).toBe("STALE");
  });
  it("keeps Google configuration separate from history, scoped to the selected site", async () => {
    const id = randomUUID();
    await database.pool.query(
      "insert into integration_sync_runs(id,site_id,provider,job_type,status,idempotency_key,error_code) values($1,$2,'PAGESPEED','sync-pagespeed','FAILED',$3,'GOOGLE_API_ERROR')",
      [id, siteId, randomUUID()],
    );
    const status = await repository.read(siteId, viewer);
    expect(status.google.find((g) => g.provider === "PAGESPEED")).toMatchObject(
      {
        configured: false,
        lastSuccess: null,
        latestAttempt: { status: "FAILED", errorCode: "GOOGLE_API_ERROR" },
      },
    );
  });
});
