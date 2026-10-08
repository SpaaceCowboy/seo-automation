import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkerRuntime } from "../../apps/worker/src/runtime.js";
import { parseWorkerConfig } from "../../packages/config/src/index.js";
import { createOpportunityRepository } from "../../packages/db/src/index.js";
import { configSchema } from "../../packages/opportunities/src/index.js";
import {
  createLogger,
  OPPORTUNITY_DETECTION_QUEUE,
} from "../../packages/shared/src/index.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL is required for queue integration tests.");
describe("actual opportunity queue delivery", () => {
  const runtime = createWorkerRuntime(
    parseWorkerConfig({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "test",
      WORKER_HEALTH_JOB_ENABLED: "false",
    }),
    createLogger({
      service: "queue-test",
      environment: "test",
      level: "silent",
    }),
  );
  const repository = createOpportunityRepository(runtime.database.db);
  beforeAll(async () => {
    await runtime.start();
  }, 30000);
  afterAll(async () => {
    await runtime.stop();
  });
  it("executes a durable command, reports insufficient data, and skips successful redelivery", async () => {
    const siteId = randomUUID();
    await runtime.database.pool.query(
      "insert into sites(id,name,canonical_origin,timezone) values($1,'Queue fixture',$2,'UTC')",
      [siteId, `https://${randomUUID()}.example.test`],
    );
    const run = await repository.createRun({
      siteId,
      endDate: "2026-09-28",
      config: configSchema.parse({ windowDays: 7 }),
      idempotencyKey: randomUUID(),
      correlationId: "queue-integration",
    });
    const command = { runId: run.id, siteId, correlationId: run.correlationId };
    async function deliver() {
      const jobId = await runtime.boss.send(
        OPPORTUNITY_DETECTION_QUEUE,
        command,
      );
      expect(jobId).not.toBeNull();
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const job = await runtime.database.pool.query<{ state: string }>(
          "select state from pgboss.job where id=$1",
          [jobId],
        );
        if (job.rows[0]?.state === "completed") return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Opportunity queue did not complete the command.");
    }
    await deliver();
    const result = await repository.getRun(run.id);
    expect(result?.status).toBe("SUCCEEDED");
    expect(result?.attemptCount).toBe(1);
    expect(result?.statistics).toMatchObject({
      created: 0,
      updated: 0,
      resolved: 0,
      insufficient: {
        PAGE_WINDOW_INCOMPLETE: 1,
        PAGE_QUERY_WINDOW_INCOMPLETE: 1,
      },
    });
    await deliver();
    expect((await repository.getRun(run.id))?.attemptCount).toBe(1);
  }, 25000);
});
