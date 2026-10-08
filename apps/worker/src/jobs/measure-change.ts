import type { Job, PgBoss } from "pg-boss";
import type { MeasurementRepository } from "@roco/db";
import {
  measurementJobSchema,
  WorkflowError,
  type Principal,
} from "@roco/workflow";
import { CHANGE_MEASUREMENT_QUEUE, type Logger } from "@roco/shared";
function safeJobError(error: unknown): Error {
  const code =
    error instanceof WorkflowError ? error.code : "MEASUREMENT_FAILED";
  return new Error(code, { cause: new WorkflowError(code) });
}
export function createMeasurementHandler(deps: {
  repository: MeasurementRepository;
  logger: Logger;
}) {
  return async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const data = measurementJobSchema.parse(job.data);
      const run = await deps.repository.getRun(data.runId);
      if (
        !run ||
        run.siteId !== data.siteId ||
        run.correlationId !== data.correlationId
      )
        throw new Error("Invalid persisted measurement command.");
      if (run.status === "SUCCEEDED") continue;
      const started = Date.now();
      deps.logger.info(
        {
          runId: run.id,
          siteId: run.siteId,
          jobId: job.id,
          correlationId: run.correlationId,
        },
        "change measurement started",
      );
      try {
        const result = await deps.repository.measure(run.id);
        deps.logger.info(
          {
            runId: run.id,
            resultId: result.id,
            state: result.state,
            siteId: run.siteId,
            jobId: job.id,
            correlationId: run.correlationId,
            durationMs: Date.now() - started,
          },
          "change measurement completed",
        );
      } catch (error) {
        const code =
          error instanceof WorkflowError ? error.code : "MEASUREMENT_FAILED";
        await deps.repository.fail(run.id, code);
        deps.logger.error(
          {
            runId: run.id,
            siteId: run.siteId,
            jobId: job.id,
            correlationId: run.correlationId,
            errorCode: code,
            durationMs: Date.now() - started,
          },
          "change measurement failed",
        );
        throw safeJobError(error);
      }
    }
  };
}
export function createMeasurementDispatcher(deps: {
  repository: MeasurementRepository;
  boss: Pick<PgBoss, "send">;
  actorId: string | undefined;
  logger: Logger;
  clock?: () => Date;
}) {
  return async () => {
    if (!deps.actorId)
      throw new Error("A measurement service actor is required.");
    const now = deps.clock?.() ?? new Date();
    const p: Principal = {
      actorId: deps.actorId,
      roles: [],
      correlationId: `measurement-dispatch:${now.toISOString().slice(0, 10)}`,
    };
    const due = await deps.repository.due();
    for (const entry of due)
      await deps.repository.createRun(
        entry.change.siteId,
        entry.change.id,
        entry.plan.horizon as 30 | 60 | 90,
        { idempotencyKey: `daily:${now.toISOString().slice(0, 10)}` },
        p,
        true,
      );
    const pending = await deps.repository.pending();
    for (const run of pending)
      await deps.boss.send(
        CHANGE_MEASUREMENT_QUEUE,
        { runId: run.id, siteId: run.siteId, correlationId: run.correlationId },
        { singletonKey: run.id },
      );
    deps.logger.info(
      {
        duePlans: due.length,
        queuedCommands: pending.length,
        actorId: deps.actorId,
        correlationId: p.correlationId,
      },
      "measurement dispatch completed",
    );
  };
}
