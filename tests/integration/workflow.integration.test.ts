import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createWorkerRuntime } from "../../apps/worker/src/runtime.js";
import {
  createMeasurementHandler,
  createMeasurementDispatcher,
} from "../../apps/worker/src/jobs/measure-change.js";
import { parseWorkerConfig } from "../../packages/config/src/index.js";
import {
  createWorkflowRepository,
  createMeasurementRepository,
} from "../../packages/db/src/index.js";
import {
  defaultRule,
  windowsForChange,
  type Principal,
} from "../../packages/workflow/src/index.js";
import {
  createLogger,
  CHANGE_MEASUREMENT_QUEUE,
} from "../../packages/shared/src/index.js";
import { output } from "../../packages/agents/test/fixtures.js";
import { fixture, config } from "../../packages/opportunities/test/fixtures.js";
import {
  detectOpportunities,
  configSchema,
} from "../../packages/opportunities/src/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
type MeasurementJob = Parameters<
  ReturnType<typeof createMeasurementHandler>
>[0][number];
describe("Phase 6 human workflow and virtual-time measurement", () => {
  const logger = createLogger({
    service: "workflow-test",
    environment: "test",
    level: "silent",
  });
  const runtime = createWorkerRuntime(
    parseWorkerConfig({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      WORKER_HEALTH_JOB_ENABLED: "false",
    }),
    logger,
  );
  let time = new Date("2026-10-07T12:00:00Z");
  const clock = () => new Date(time);
  const workflow = createWorkflowRepository(runtime.database.db, clock),
    measurements = createMeasurementRepository(runtime.database.db, clock);
  const pool = runtime.database.pool;
  beforeAll(async () => {
    await runtime.start();
    await runtime.boss.createQueue("workflow.fixture", { retryLimit: 0 });
    await runtime.boss.work(
      "workflow.fixture",
      { batchSize: 1, pollingIntervalSeconds: 2 },
      createMeasurementHandler({ repository: measurements, logger }),
    );
  }, 30000);
  afterAll(async () => {
    await runtime.stop();
  });
  async function seed(type: "TITLE" | "CANONICAL" = "TITLE") {
    time = new Date("2026-10-07T12:00:00Z");
    const siteId = randomUUID(),
      pageId = randomUUID(),
      opportunityId = randomUUID(),
      scoreId = randomUUID(),
      opRunId = randomUUID(),
      cfgId = randomUUID(),
      agentRunId = randomUUID(),
      invocationId = randomUUID(),
      agentOutputId = randomUUID(),
      operatorId = randomUUID(),
      reviewerId = randomUUID(),
      specialId = randomUUID(),
      serviceId = randomUUID(),
      origin = `https://${randomUUID()}.example.test`;
    await pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Workflow sandbox',$2,'UTC')",
      [siteId, origin],
    );
    await pool.query("insert into site_hosts(site_id,host) values($1,$2)", [
      siteId,
      new URL(origin).hostname,
    ]);
    for (const [id, kind] of [
      [operatorId, "HUMAN"],
      [reviewerId, "HUMAN"],
      [specialId, "HUMAN"],
      [serviceId, "SERVICE"],
    ])
      await pool.query(
        "insert into actors(id,type,display_name) values($1,$2,'Fixture actor')",
        [id, kind],
      );
    await pool.query(
      "insert into pages(id,site_id,normalized_url,normalized_url_hash,normalization_version) values($1,$2,$3,$4,'url-v1')",
      [pageId, siteId, `${origin}/fa/article`, randomUUID()],
    );
    await pool.query(
      "insert into scoring_configs(id,site_id,content_hash,version,configuration) values($1,$2,$3,'fixture',$4)",
      [cfgId, siteId, randomUUID(), JSON.stringify(configSchema.parse({}))],
    );
    await pool.query(
      "insert into opportunity_runs(id,site_id,config_id,idempotency_key,detector_version,start_date,end_date,status,correlation_id) values($1,$2,$3,$4,'opportunities-v1','2026-09-22','2026-09-28','SUCCEEDED','fixture')",
      [opRunId, siteId, cfgId, randomUUID()],
    );
    const candidate = detectOpportunities(fixture(), config).candidates.find(
      (c) => c.type === "CTR",
    )!;
    candidate.pageId = pageId;
    candidate.url = `${origin}/fa/article`;
    await pool.query(
      "insert into opportunities(id,site_id,fingerprint,type,page_id,url,score,last_run_id) values($1,$2,$3,'CTR',$4,$5,$6,$7)",
      [
        opportunityId,
        siteId,
        randomUUID(),
        pageId,
        candidate.url,
        candidate.score,
        opRunId,
      ],
    );
    await pool.query(
      "insert into opportunity_scores(id,opportunity_id,run_id,config_id,score,observation) values($1,$2,$3,$4,$5,$6)",
      [
        scoreId,
        opportunityId,
        opRunId,
        cfgId,
        candidate.score,
        JSON.stringify(candidate),
      ],
    );
    await pool.query(
      "insert into agent_runs(id,site_id,opportunity_id,score_id,actor_id,idempotency_key,correlation_id,status,prompt_version,schema_version) values($1,$2,$3,$4,$5,$6,'fixture','SUCCEEDED','seo-prompts-v1','seo-agent-v1')",
      [agentRunId, siteId, opportunityId, scoreId, operatorId, randomUUID()],
    );
    await pool.query(
      "insert into agent_invocations(id,run_id,agent_type,budget_month,attempt,provider,model,prompt_version,schema_version,input_hash,status,reserved_nanousd) values($1,$2,'SUPERVISOR','2026-10',0,'fixture','fixture-v1','seo-prompts-v1','seo-agent-v1','fixture','SUCCEEDED',0)",
      [invocationId, agentRunId],
    );
    const analysis = output();
    analysis.opportunityId = opportunityId;
    analysis.actions[0]!.type = type;
    analysis.actions[0]!.targetPageId = pageId;
    analysis.risk = type === "CANONICAL" ? "HIGH" : "MEDIUM";
    await pool.query(
      "insert into agent_outputs(id,run_id,invocation_id,schema_version,analysis,draft) values($1,$2,$3,'seo-agent-v1',$4,$5)",
      [
        agentOutputId,
        agentRunId,
        invocationId,
        JSON.stringify(analysis),
        JSON.stringify({ status: "DRAFT", executable: false, analysis }),
      ],
    );
    const operator: Principal = {
        actorId: operatorId,
        roles: ["OPERATOR"],
        correlationId: "operator",
      },
      reviewer: Principal = {
        actorId: reviewerId,
        roles: ["APPROVER"],
        correlationId: "reviewer",
      },
      special: Principal = {
        actorId: specialId,
        roles: ["SPECIAL_APPROVER"],
        correlationId: "special",
      },
      service: Principal = {
        actorId: serviceId,
        roles: [],
        correlationId: "service",
      };
    const proposal = {
      pageId,
      changeType: type,
      pageType: "article",
      topic: "forex",
      before:
        type === "TITLE"
          ? { title: "Old title" }
          : { canonicalUrl: `${origin}/old` },
      after:
        type === "TITLE"
          ? { title: "Approved title" }
          : { canonicalUrl: `${origin}/new` },
      reason: "Reviewed source evidence",
      rule: defaultRule("CTR"),
    };
    const rec = await workflow.create(
      siteId,
      {
        agentOutputId,
        actionIndex: 0,
        mode: "SANDBOX",
        proposal,
        idempotencyKey: randomUUID(),
      },
      operator,
    );
    return {
      siteId,
      pageId,
      rec,
      proposal,
      operator,
      reviewer,
      special,
      service,
      agentOutputId,
    };
  }
  async function decision(
    x: Awaited<ReturnType<typeof seed>>,
    action: "SUBMIT" | "APPROVE" | "REJECT" | "REQUEST_CHANGES",
    p: Principal = x.reviewer,
  ) {
    const detail = await workflow.detail(x.siteId, x.rec.id, x.operator);
    return workflow.transition(
      x.siteId,
      x.rec.id,
      {
        expectedVersionId: detail!.currentVersionId,
        expectedState: detail!.state,
        action,
        reason: "Fixture review",
      },
      p,
    );
  }
  async function importWindow(
    x: Awaited<ReturnType<typeof seed>>,
    startDate: string,
    endDate: string,
    clicks: number,
  ) {
    const syncId = randomUUID();
    await pool.query(
      "insert into integration_sync_runs(id,site_id,provider,job_type,dimension_set,start_date,end_date,status,idempotency_key) values($1,$2,'GSC','sync-gsc','PAGE',$3,$4,'SUCCEEDED',$5)",
      [syncId, x.siteId, startDate, endDate, randomUUID()],
    );
    let date = new Date(startDate);
    while (date <= new Date(endDate)) {
      const day = date.toISOString().slice(0, 10);
      await pool.query(
        "insert into gsc_page_daily(site_id,sync_run_id,page_id,date,observed_url,normalized_url,normalized_url_hash,normalization_version,clicks,impressions,ctr,position) select $1,$2,$3,$4,normalized_url,normalized_url,normalized_url_hash,'url-v1',$5,100,$6,8 from pages where id=$3 on conflict(site_id,date,normalized_url_hash,country,device,search_type,data_state) do update set clicks=excluded.clicks,impressions=excluded.impressions,ctr=excluded.ctr,sync_run_id=excluded.sync_run_id",
        [x.siteId, syncId, x.pageId, day, clicks, clicks / 100],
      );
      date = new Date(date.getTime() + 86400000);
    }
  }
  async function approvedChange(
    x: Awaited<ReturnType<typeof seed>>,
    withData = true,
  ) {
    await decision(x, "SUBMIT", x.operator);
    await decision(x, "APPROVE", x.reviewer);
    time = new Date("2026-10-08T12:00:00Z");
    const window = windowsForChange(time, x.proposal.rule);
    if (withData) await importWindow(x, window.startDate, window.endDate, 2);
    const request = {
      versionId: x.rec.currentVersionId!,
      implementedAt: time.toISOString(),
      actualBefore: x.proposal.before,
      actualAfter: x.proposal.after,
      notes: "Simulated sandbox application; no production change",
      externalReference: "sandbox:fixture",
      confirmedApplied: true,
      idempotencyKey: randomUUID(),
    };
    const change = await workflow.implement(
      x.siteId,
      x.rec.id,
      request,
      x.operator,
    );
    return { change, request };
  }
  it("keeps approval separate from implementation, binds exact values and captures baseline/plans atomically", async () => {
    const x = await seed();
    await expect(
      workflow.implement(
        x.siteId,
        x.rec.id,
        {
          versionId: x.rec.currentVersionId!,
          implementedAt: time.toISOString(),
          actualBefore: x.proposal.before,
          actualAfter: x.proposal.after,
          notes: "Never applied",
          externalReference: "sandbox",
          confirmedApplied: true,
          idempotencyKey: randomUUID(),
        },
        x.operator,
      ),
    ).rejects.toThrow("APPROVED_CURRENT_VERSION");
    const { change, request } = await approvedChange(x);
    expect(change.mode).toBe("SANDBOX");
    expect(
      (await workflow.implement(x.siteId, x.rec.id, request, x.operator)).id,
    ).toBe(change.id);
    const ledger = await workflow.ledger(x.siteId, change.id, x.operator);
    expect(ledger!.baselines[0]!.sample.gsc.values.GSC_IMPRESSIONS).toBe(2800);
    expect(ledger!.plans.map((p) => p.horizon).sort()).toEqual([30, 60, 90]);
    expect(ledger!.recommendation!.state).toBe("IMPLEMENTED");
    expect(ledger!.approval!.actorId).toBe(x.reviewer.actorId);
    await expect(
      pool.query(
        "update change_ledger_entries set notes='changed' where id=$1",
        [change.id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("serializes concurrent review and records attributable audit events", async () => {
    const x = await seed();
    await decision(x, "SUBMIT", x.operator);
    const body = {
      expectedVersionId: x.rec.currentVersionId!,
      expectedState: "READY_FOR_REVIEW",
      action: "APPROVE",
      reason: "Concurrent review",
    };
    const decisions = await Promise.allSettled([
      workflow.transition(x.siteId, x.rec.id, body, x.reviewer),
      workflow.transition(x.siteId, x.rec.id, body, x.reviewer),
    ]);
    expect(decisions.filter((d) => d.status === "fulfilled")).toHaveLength(1);
    const audits = await pool.query<{ actor_id: string; action: string }>(
      "select actor_id,action from audit_events where subject_id=$1",
      [x.rec.id],
    );
    expect(audits.rows).toEqual(
      expect.arrayContaining([
        {
          actor_id: x.operator.actorId,
          action: "workflow.recommendation.generated",
        },
        {
          actor_id: x.operator.actorId,
          action: "workflow.recommendation.submit",
        },
        {
          actor_id: x.reviewer.actorId,
          action: "workflow.recommendation.approve",
        },
      ]),
    );
    await expect(
      workflow.transition(
        x.siteId,
        x.rec.id,
        { ...body, reviewer: "forged" },
        x.reviewer,
      ),
    ).rejects.toThrow();
    await expect(
      workflow.revise(
        x.siteId,
        x.rec.id,
        { expectedVersionId: x.rec.currentVersionId!, proposal: x.proposal },
        { ...x.operator, roles: ["VIEWER"] },
      ),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("invalidates approval on revision and rejects stale/wrong-after recordings", async () => {
    const x = await seed();
    await decision(x, "SUBMIT", x.operator);
    await decision(x, "APPROVE");
    const next = await workflow.revise(
      x.siteId,
      x.rec.id,
      {
        expectedVersionId: x.rec.currentVersionId!,
        proposal: { ...x.proposal, after: { title: "Revised title" } },
      },
      x.operator,
    );
    expect((await workflow.detail(x.siteId, x.rec.id, x.operator))!.state).toBe(
      "DRAFT",
    );
    expect(next.number).toBe(2);
    await expect(
      workflow.transition(
        x.siteId,
        x.rec.id,
        {
          expectedVersionId: x.rec.currentVersionId!,
          expectedState: "READY_FOR_REVIEW",
          action: "APPROVE",
          reason: "Stale review",
        },
        x.reviewer,
      ),
    ).rejects.toThrow("STALE");
    await expect(
      pool.query("update recommendations set state='APPROVED' where id=$1", [
        x.rec.id,
      ]),
    ).rejects.toThrow("approval");
    await decision(x, "SUBMIT", x.operator);
    await decision(x, "APPROVE");
    time = new Date("2026-10-08");
    await expect(
      workflow.implement(
        x.siteId,
        x.rec.id,
        {
          versionId: next.id,
          implementedAt: time.toISOString(),
          actualBefore: x.proposal.before,
          actualAfter: { title: "Unapproved title" },
          notes: "Sandbox mismatch",
          externalReference: "sandbox",
          confirmedApplied: true,
          idempotencyKey: randomUUID(),
        },
        x.operator,
      ),
    ).rejects.toThrow("DIFFERS_FROM_APPROVAL");
  });
  it("enforces special review and human identity, and preserves rejection/change-request history", async () => {
    const high = await seed("CANONICAL");
    await decision(high, "SUBMIT", high.operator);
    await expect(decision(high, "APPROVE", high.reviewer)).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(
      decision(high, "APPROVE", {
        ...high.service,
        roles: ["SPECIAL_APPROVER"],
      }),
    ).rejects.toThrow("HUMAN");
    await decision(high, "APPROVE", high.special);
    const requested = await seed();
    await decision(requested, "SUBMIT", requested.operator);
    await decision(requested, "REQUEST_CHANGES");
    expect(
      (await workflow.detail(
        requested.siteId,
        requested.rec.id,
        requested.operator,
      ))!.state,
    ).toBe("CHANGES_REQUESTED");
    const rejected = await seed();
    await decision(rejected, "SUBMIT", rejected.operator);
    await decision(rejected, "REJECT");
    expect(
      (await workflow.detail(
        rejected.siteId,
        rejected.rec.id,
        rejected.operator,
      ))!.decisions[0]!.decision,
    ).toBe("REJECTED");
  });
  it("executes 30/60/90 measurements with virtual dates, immutable results and idempotent replay", async () => {
    const x = await seed();
    const { change } = await approvedChange(x);
    for (const horizon of [30, 60, 90] as const) {
      const window = windowsForChange(
        change.implementedAt,
        x.proposal.rule,
        horizon,
      );
      await importWindow(x, window.startDate, window.endDate, 4);
      time = new Date(new Date(window.endDate).getTime() + 5 * 86400000);
      const run = await measurements.createRun(
        x.siteId,
        change.id,
        horizon,
        { idempotencyKey: `fixture:${horizon}` },
        x.operator,
      );
      const result = await measurements.measure(run.id);
      expect(result.state).toBe("POSITIVE");
      expect(result.outcome.causationClaimed).toBe(false);
      expect((await measurements.measure(run.id)).id).toBe(result.id);
      await expect(
        pool.query(
          "update measurement_results set state='NEGATIVE' where id=$1",
          [result.id],
        ),
      ).rejects.toThrow("immutable");
    }
    const history = await measurements.history(x.siteId, change.id, x.operator);
    expect(history!.results).toHaveLength(3);
    expect(
      await measurements.history(randomUUID(), change.id, x.operator),
    ).toBeNull();
  });
  it("preserves missing baselines, supports explicit recapture and records reverts/corrections without writes", async () => {
    const x = await seed();
    const { change } = await approvedChange(x, false);
    const window = windowsForChange(change.implementedAt, x.proposal.rule, 30);
    time = new Date(new Date(window.endDate).getTime() + 5 * 86400000);
    const run = await measurements.createRun(
      x.siteId,
      change.id,
      30,
      { idempotencyKey: "missing-baseline" },
      x.operator,
    );
    expect((await measurements.measure(run.id)).state).toBe(
      "INSUFFICIENT_DATA",
    );
    const before = windowsForChange(change.implementedAt, x.proposal.rule);
    await importWindow(x, before.startDate, before.endDate, 2);
    const recaptured = await workflow.refreshBaseline(
      x.siteId,
      change.id,
      { reason: "Late imported baseline", idempotencyKey: "baseline-late" },
      x.operator,
    );
    expect(recaptured.number).toBe(2);
    expect(
      (await workflow.ledger(x.siteId, change.id, x.operator))!.baselines,
    ).toHaveLength(2);
    await workflow.event(
      x.siteId,
      change.id,
      "CORRECTION",
      {
        reason: "Clarify sandbox note",
        note: "All changes simulated",
        idempotencyKey: "correction-note",
      },
      x.operator,
    );
    await workflow.event(
      x.siteId,
      change.id,
      "REVERT",
      {
        revertedAt: time.toISOString(),
        values: x.proposal.before,
        reason: "Simulated sandbox revert",
        externalReference: "sandbox:revert",
        confirmedApplied: true,
        idempotencyKey: "revert-key",
      },
      x.operator,
    );
    const again = await measurements.createRun(
      x.siteId,
      change.id,
      30,
      { idempotencyKey: "after-revert" },
      x.operator,
    );
    expect((await measurements.measure(again.id)).state).toBe("REVERTED");
    expect(
      (await workflow.ledger(x.siteId, change.id, x.operator))!.events,
    ).toHaveLength(2);
  });
  it("keeps due plans durable and dispatches idempotent pg-boss jobs after maturity", async () => {
    const x = await seed();
    const { change } = await approvedChange(x);
    await expect(
      measurements.createRun(
        x.siteId,
        change.id,
        30,
        { idempotencyKey: "too-early" },
        x.operator,
      ),
    ).rejects.toThrow("NOT_READY");
    const window = windowsForChange(change.implementedAt, x.proposal.rule, 30);
    await importWindow(x, window.startDate, window.endDate, 4);
    time = new Date(new Date(window.endDate).getTime() + 5 * 86400000);
    const send = vi.fn(async () => randomUUID());
    const isolated = {
      ...measurements,
      due: async () =>
        (await measurements.due()).filter(
          (entry) => entry.change.id === change.id,
        ),
      pending: async () =>
        (await measurements.pending()).filter(
          (entry) => entry.siteId === x.siteId,
        ),
    };
    const dispatch = createMeasurementDispatcher({
      repository: isolated,
      boss: { send },
      actorId: x.service.actorId,
      logger,
      clock,
    });
    await dispatch();
    const pending = await isolated.pending();
    expect(pending).toHaveLength(1);
    const run = pending[0]!;
    await dispatch();
    expect((await isolated.pending()).map((r) => r.id)).toEqual([run.id]);
    expect(send).toHaveBeenCalledWith(
      CHANGE_MEASUREMENT_QUEUE,
      expect.objectContaining({ runId: run.id }),
      expect.anything(),
    );
    const jobId = await runtime.boss.send("workflow.fixture", {
      runId: run.id,
      siteId: x.siteId,
      correlationId: run.correlationId,
    });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await measurements.getRun(run.id);
      if (result?.status === "SUCCEEDED") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await measurements.getRun(run.id))!.status).toBe("SUCCEEDED");
    expect(jobId).not.toBeNull();
    const ids = await pool.query<{ id: string }>(
      "select id from measurement_results where run_id=$1",
      [run.id],
    );
    await createMeasurementHandler({ repository: measurements, logger })([
      {
        id: "replay",
        data: {
          runId: run.id,
          siteId: x.siteId,
          correlationId: run.correlationId,
        },
      } as MeasurementJob,
    ]);
    expect(
      (
        await pool.query(
          "select count(*)::int count from measurement_results where run_id=$1",
          [run.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(ids.rows).toHaveLength(1);
  }, 15000);
});
