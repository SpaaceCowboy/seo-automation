import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerRuntime } from "../../apps/worker/src/runtime.js";
import { createAnalysisHandler } from "../../apps/worker/src/jobs/analyze-opportunity.js";
import { parseWorkerConfig } from "../../packages/config/src/index.js";
import { createAgentRepository } from "../../packages/db/src/index.js";
import { createFakeProvider } from "../../packages/llm/src/index.js";
import {
  configSchema,
  detectOpportunities,
} from "../../packages/opportunities/src/index.js";
import { fixture, config } from "../../packages/opportunities/test/fixtures.js";
import { policy, respond } from "../../packages/agents/test/fixtures.js";
import {
  policySchema,
  PROMPT_VERSION,
} from "../../packages/agents/src/index.js";
import { createLogger } from "../../packages/shared/src/index.js";
type AgentQueueJob = Parameters<
  ReturnType<typeof createAnalysisHandler>
>[0][number];
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
describe("Phase 5 persisted workflow and durable queue", () => {
  const logger = createLogger({
    service: "agent-integration",
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
  const repository = createAgentRepository(
    runtime.database.db,
    runtime.database.pool,
  );
  const provider = createFakeProvider(respond);
  const handler = createAnalysisHandler({
    repository,
    policy: policy(),
    providers: new Map([[provider.name, provider]]),
    logger,
  });
  beforeAll(async () => {
    await runtime.start();
    await runtime.database.pool.query("truncate table agent_budget_months");
    await runtime.boss.createQueue("agents.fixture", { retryLimit: 0 });
    await runtime.boss.work(
      "agents.fixture",
      { batchSize: 1, pollingIntervalSeconds: 2 },
      handler,
    );
  }, 30000);
  afterAll(async () => {
    await runtime.stop();
  });
  async function seed() {
    const siteId = randomUUID(),
      actorId = randomUUID(),
      pageId = randomUUID(),
      opportunityId = randomUUID(),
      scoreId = randomUUID(),
      runId = randomUUID(),
      configId = randomUUID(),
      origin = `https://${randomUUID()}.example.test`;
    const candidate = detectOpportunities(fixture(), config).candidates.find(
      (c) => c.type === "CTR",
    )!;
    candidate.pageId = pageId;
    candidate.url = `${origin}/fa/forex`;
    const pool = runtime.database.pool;
    await pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Agent fixture',$2,'UTC')",
      [siteId, origin],
    );
    await pool.query(
      "insert into actors(id,type,display_name) values($1,'HUMAN','Fixture operator')",
      [actorId],
    );
    await pool.query(
      "insert into pages(id,site_id,normalized_url,normalized_url_hash,normalization_version) values($1,$2,$3,$4,'url-v1')",
      [pageId, siteId, candidate.url, randomUUID()],
    );
    await pool.query(
      "insert into scoring_configs(id,site_id,content_hash,version,configuration) values($1,$2,$3,'fixture',$4)",
      [configId, siteId, randomUUID(), JSON.stringify(configSchema.parse({}))],
    );
    await pool.query(
      "insert into opportunity_runs(id,site_id,config_id,idempotency_key,detector_version,start_date,end_date,status,correlation_id) values($1,$2,$3,$4,'opportunities-v1','2026-09-22','2026-09-28','SUCCEEDED','fixture')",
      [runId, siteId, configId, randomUUID()],
    );
    await pool.query(
      "insert into opportunities(id,site_id,fingerprint,type,page_id,url,score,last_run_id) values($1,$2,$3,'CTR',$4,$5,$6,$7)",
      [
        opportunityId,
        siteId,
        randomUUID(),
        pageId,
        candidate.url,
        candidate.score,
        runId,
      ],
    );
    await pool.query(
      "insert into opportunity_scores(id,opportunity_id,run_id,config_id,score,observation) values($1,$2,$3,$4,$5,$6)",
      [
        scoreId,
        opportunityId,
        runId,
        configId,
        candidate.score,
        JSON.stringify(candidate),
      ],
    );
    return { siteId, actorId, opportunityId, scoreId };
  }
  async function deliver(run: {
    id: string;
    siteId: string;
    correlationId: string;
  }) {
    const jobId = await runtime.boss.send("agents.fixture", {
      runId: run.id,
      siteId: run.siteId,
      correlationId: run.correlationId,
    });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const job = await runtime.database.pool.query<{ state: string }>(
        "select state from pgboss.job where id=$1",
        [jobId],
      );
      if (job.rows[0]?.state === "completed") return;
      if (job.rows[0]?.state === "failed")
        throw new Error("Agent queue fixture failed.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Agent queue fixture timed out.");
  }
  it("deduplicates triggers, captures immutable evidence and produces one validated draft through pg-boss", async () => {
    const source = await seed();
    const command = {
      ...source,
      correlationId: "agent-fixture",
      idempotencyKey: randomUUID(),
    };
    const [run, duplicate] = await Promise.all([
      repository.createRun(command),
      repository.createRun(command),
    ]);
    expect(run.id).toBe(duplicate.id);
    await deliver(run);
    const done = await repository.getRun(run.id);
    expect(done).toMatchObject({
      status: "SUCCEEDED",
      invocationCount: 3,
      outcome: "DRAFT_CREATED",
    });
    const draft = await repository.draft(source.siteId, run.id);
    expect(draft).toMatchObject({ status: "DRAFT", executable: false });
    expect(draft!.analysis.confidence).toBeLessThanOrEqual(0.35);
    await deliver(run);
    expect((await repository.getRun(run.id))?.invocationCount).toBe(3);
    const stored = await runtime.database.pool.query<{ count: number }>(
      "select count(*)::int count from agent_outputs where run_id=$1",
      [run.id],
    );
    expect(stored.rows[0]?.count).toBe(3);
    expect(await repository.draft(randomUUID(), run.id)).toBeNull();
    await expect(
      runtime.database.pool.query(
        "update agent_evidence set bundle='{}' where run_id=$1",
        [run.id],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      runtime.database.pool.query(
        "update agent_outputs set analysis='{}' where run_id=$1",
        [run.id],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      runtime.database.pool.query("delete from agent_runs where id=$1", [
        run.id,
      ]),
    ).rejects.toThrow("immutable");
  }, 25000);
  it("records malformed output failures without drafts and permits bounded resume only", async () => {
    const source = await seed();
    const run = await repository.createRun({
      ...source,
      correlationId: "invalid-output",
    });
    const bad = createFakeProvider(() => ({
      text: '{"execute":true}',
      providerRequestId: null,
      inputTokens: 100,
      outputTokens: 50,
    }));
    const invalid = createAnalysisHandler({
      repository,
      policy: policy(),
      providers: new Map([[bad.name, bad]]),
      logger,
    });
    await expect(
      invalid([
        {
          id: "bad",
          data: {
            runId: run.id,
            siteId: run.siteId,
            correlationId: run.correlationId,
          },
        } as AgentQueueJob,
      ]),
    ).rejects.toThrow("INVALID_AGENT_SCHEMA");
    expect(await repository.draft(source.siteId, run.id)).toBeNull();
    expect((await repository.getRun(run.id))?.invocationCount).toBe(2);
    const outputs = await runtime.database.pool.query<{ count: number }>(
      "select count(*)::int count from agent_outputs where run_id=$1",
      [run.id],
    );
    expect(outputs.rows[0]?.count).toBe(0);
    await expect(
      handler([
        {
          id: "retry",
          data: {
            runId: run.id,
            siteId: run.siteId,
            correlationId: run.correlationId,
          },
        } as AgentQueueJob,
      ]),
    ).rejects.toThrow("ATTEMPTS_EXHAUSTED");
    expect((await repository.getRun(run.id))?.invocationCount).toBe(2);
  });
  it("refuses budgets and inactive actors before paid calls and serializes duplicate workflows", async () => {
    const source = await seed();
    const run = await repository.createRun({
      ...source,
      correlationId: "budget",
    });
    const tiny = createAnalysisHandler({
      repository,
      policy: { ...policy(), runBudgetNanousd: 1 },
      providers: new Map([[provider.name, provider]]),
      logger,
    });
    await expect(
      tiny([
        {
          id: "budget",
          data: {
            runId: run.id,
            siteId: run.siteId,
            correlationId: run.correlationId,
          },
        } as AgentQueueJob,
      ]),
    ).rejects.toThrow("BUDGET");
    expect((await repository.getRun(run.id))?.invocationCount).toBe(0);
    let executions = 0;
    const hold = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          executions++;
          resolve();
        }, 50),
      );
    const locks = await Promise.all([
      repository.withRunLock(run.id, hold),
      repository.withRunLock(run.id, hold),
    ]);
    expect(locks.filter(Boolean)).toHaveLength(1);
    expect(executions).toBe(1);
    await runtime.database.pool.query(
      "update actors set disabled_at=now() where id=$1",
      [source.actorId],
    );
    await expect(
      repository.createRun({
        ...source,
        correlationId: "disabled",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("ACTIVE_OPERATOR_REQUIRED");
  });
  it("persists Supervisor-only output and independently blocks specialist reservations", async () => {
    const source = await seed();
    const run = await repository.createRun({
      ...source,
      correlationId: "supervisor-only",
    });
    const solo = policySchema.parse({
      ...policy(),
      executionMode: "SUPERVISOR_ONLY",
      routes: {
        SUPERVISOR: policy().routes.SUPERVISOR,
        TECHNICAL: policy().routes.TECHNICAL,
      },
      maxSpecialists: 0,
      maxInvocations: 1,
      retryLimit: 0,
    });
    await repository.start(run.id, solo);
    await expect(
      repository.journal(run.id).reserve({
        agent: "TECHNICAL",
        attempt: 0,
        provider: "fixture",
        model: "fixture-v1",
        promptVersion: PROMPT_VERSION,
        inputHash: "forged-specialist",
        reservedNanousd: "1",
      }),
    ).rejects.toThrow("OUTSIDE_SUPERVISOR_PLAN");
    const soloHandler = createAnalysisHandler({
      repository,
      policy: solo,
      providers: new Map([[provider.name, provider]]),
      logger,
    });
    const job = {
      id: "solo",
      data: {
        runId: run.id,
        siteId: run.siteId,
        correlationId: run.correlationId,
      },
    } as AgentQueueJob;
    await soloHandler([job]);
    await soloHandler([job]);
    expect((await repository.getRun(run.id))?.invocationCount).toBe(1);
    const outputs = await runtime.database.pool.query(
      "select analysis->>'agent' as agent from agent_outputs where run_id=$1",
      [run.id],
    );
    expect(outputs.rows).toEqual([{ agent: "SUPERVISOR" }]);
    expect(await repository.draft(source.siteId, run.id)).toMatchObject({
      executable: false,
    });
  });
  it("refuses low-priority sources and changed frozen execution mode before spending", async () => {
    const source = await seed();
    const run = await repository.createRun({
      ...source,
      correlationId: "priority",
    });
    await expect(
      repository.start(run.id, { ...policy(), minOpportunityScore: 100 }),
    ).rejects.toThrow("BELOW_AI_PRIORITY_THRESHOLD");
    expect((await repository.getRun(run.id))?.invocationCount).toBe(0);
    await repository.start(run.id, policy());
    await expect(
      repository.start(run.id, {
        ...policy(),
        executionMode: "SUPERVISOR_ONLY",
      }),
    ).rejects.toThrow("EXECUTION_MODE_CHANGED");
    expect((await repository.getRun(run.id))?.invocationCount).toBe(0);
  });
  it("enforces shared monthly reservations transactionally", async () => {
    const source = await seed();
    const run = await repository.createRun({
      ...source,
      correlationId: "monthly",
    });
    await repository.start(run.id, { ...policy(), monthlyBudgetNanousd: 1 });
    const journal = repository.journal(run.id);
    await expect(
      journal.reserve({
        agent: "KEYWORD",
        attempt: 0,
        provider: "fixture",
        model: "fixture-v1",
        promptVersion: PROMPT_VERSION,
        inputHash: "fixture",
        reservedNanousd: "10",
      }),
    ).rejects.toThrow("BUDGET");
    expect((await repository.getRun(run.id))?.invocationCount).toBe(0);
    await expect(
      journal.reserve({
        agent: "INTERNAL_LINKING",
        attempt: 0,
        provider: "fixture",
        model: "fixture-v1",
        promptVersion: PROMPT_VERSION,
        inputHash: "fixture",
        reservedNanousd: "0",
      }),
    ).rejects.toThrow("OUTSIDE_SUPERVISOR_PLAN");
  });
});
