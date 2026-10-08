import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "../../packages/config/src/index.js";
import { createLogger } from "../../packages/shared/src/index.js";
import { createWorkerRuntime } from "../../apps/worker/src/runtime.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const logger = createLogger({
  service: "restart-test",
  environment: "test",
  level: "silent",
});

describe("production queue recovery", () => {
  it("preserves delayed work and removes disabled schedules across a worker restart", async () => {
    const settings = {
      NODE_ENV: "test",
      DATABASE_URL: url,
      WORKER_HEALTH_JOB_ENABLED: "false",
      WORKFLOW_SCHEDULES_ENABLED: "false",
      GOOGLE_SITE_ID: randomUUID(),
      GOOGLE_CREDENTIALS_FILE: "/unused/test-credentials.json",
      GSC_PROPERTY: "sc-domain:example.com",
      GA4_PROPERTY_ID: "123456",
      GSC_SYNC_SCHEDULE: "0 0 1 1 *",
      GA4_SYNC_SCHEDULE: "0 0 1 1 *",
      PAGESPEED_SYNC_SCHEDULE: "0 0 1 1 *",
    };
    const queue = "phase75.restart." + randomUUID();
    const startAfter = new Date(Date.now() + 3600000);
    const first = createWorkerRuntime(
      parseWorkerConfig({ ...settings, GOOGLE_SCHEDULES_ENABLED: "true" }),
      logger,
    );
    let jobId: string | null;
    let plans: unknown[];
    try {
      await first.start();
      plans = (
        await first.database.pool.query(
          "select id,horizon,ready_at,completed_at from measurement_plans order by id",
        )
      ).rows;
      const schedules = await first.database.pool.query(
        "select key from pgboss.schedule where name = 'google.sync.dispatch'",
      );
      expect(schedules.rows).toHaveLength(3);
      await first.boss.createQueue(queue, { retryLimit: 2 });
      jobId = await first.boss.send(
        queue,
        { correlationId: "restart-proof" },
        { startAfter },
      );
      expect(jobId).not.toBeNull();
    } finally {
      await first.stop();
    }
    const second = createWorkerRuntime(
      parseWorkerConfig({ ...settings, GOOGLE_SCHEDULES_ENABLED: "false" }),
      logger,
    );
    try {
      await second.start();
      const schedules = await second.database.pool.query(
        "select key from pgboss.schedule where name = 'google.sync.dispatch'",
      );
      expect(schedules.rows).toHaveLength(0);
      expect(
        (
          await second.database.pool.query(
            "select id,horizon,ready_at,completed_at from measurement_plans order by id",
          )
        ).rows,
      ).toEqual(plans);
      const job = await second.boss.getJobById(queue, jobId!);
      expect(job?.state).toBe("created");
      expect(job?.retryLimit).toBe(2);
      expect(new Date(job!.startAfter).getTime()).toBe(startAfter.getTime());
      await second.boss.deleteQueue(queue);
    } finally {
      await second.stop();
    }
  }, 30000);
});
