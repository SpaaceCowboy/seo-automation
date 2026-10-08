import { z } from "zod";
import type { Job } from "pg-boss";
import type { OpportunityRepository } from "@roco/db";
import { detectOpportunities } from "@roco/opportunities";
import type { Logger } from "@roco/shared";
export const detectionJobSchema = z.strictObject({
  runId: z.string().uuid(),
  siteId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
});
export function createDetectionHandler(dependencies: {
  repository: OpportunityRepository;
  logger: Logger;
}) {
  return async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const data = detectionJobSchema.parse(job.data);
      const started = Date.now();
      const run = await dependencies.repository.getRun(data.runId);
      if (!run) throw new Error("Detection run does not exist.");
      if (
        run.siteId !== data.siteId ||
        run.correlationId !== data.correlationId
      )
        throw new Error("Detection job does not match its persisted command.");
      if (run.status === "SUCCEEDED") continue;
      try {
        const captured = await dependencies.repository.captureInput(run.id);
        if (!captured) continue;
        dependencies.logger.info(
          {
            runId: run.id,
            siteId: run.siteId,
            jobId: job.id,
            correlationId: data.correlationId,
            attempt: run.attemptCount + 1,
            startDate: run.startDate,
            endDate: run.endDate,
          },
          "opportunity detection started",
        );
        const result = detectOpportunities(captured.input, captured.config);
        await dependencies.repository.persistResult(
          run.id,
          result,
          Date.now() - started,
        );
        dependencies.logger.info(
          {
            runId: run.id,
            siteId: run.siteId,
            jobId: job.id,
            correlationId: data.correlationId,
            durationMs: Date.now() - started,
            counts: result.statistics.counts,
            insufficient: result.statistics.insufficient,
          },
          "opportunity detection completed",
        );
      } catch {
        await dependencies.repository.fail(run.id);
        dependencies.logger.error(
          {
            runId: run.id,
            siteId: run.siteId,
            jobId: job.id,
            correlationId: data.correlationId,
            durationMs: Date.now() - started,
            errorCode: "DETECTION_FAILED",
          },
          "opportunity detection failed",
        );
        // Generic error prevents query text, data, or credentials entering pg-boss logs.
        throw new Error(
          "Opportunity detection failed; inspect run status and correlated logs.",
        );
      }
    }
  };
}
