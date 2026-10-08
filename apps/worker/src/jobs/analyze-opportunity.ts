import type { Job } from "pg-boss";
import type { AgentRepository } from "@roco/db";
import { ProviderError, type LLMProvider } from "@roco/llm";
import {
  AgentError,
  agentJobSchema,
  runSupervisor,
  type AgentPolicy,
} from "@roco/agents";
import type { Logger } from "@roco/shared";
// Provider/database exceptions may contain secrets or raw evidence. Queue errors
// deliberately preserve only a classified, non-sensitive cause.
function safeQueueFailure(error: unknown): Error {
  const code =
    error instanceof AgentError || error instanceof ProviderError
      ? error.code
      : "AGENT_WORKFLOW_FAILED";
  return new Error(
    `Agent analysis failed (${code}); inspect persisted run metadata.`,
    { cause: new AgentError(code) },
  );
}
export function createAnalysisHandler(dependencies: {
  repository: AgentRepository;
  policy: AgentPolicy | null;
  providers: ReadonlyMap<string, LLMProvider>;
  logger: Logger;
}) {
  return async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const data = agentJobSchema.parse(job.data);
      const run = await dependencies.repository.getRun(data.runId);
      if (
        !run ||
        run.siteId !== data.siteId ||
        run.correlationId !== data.correlationId
      )
        throw new Error("Invalid persisted agent job context.");
      if (run.status === "SUCCEEDED") continue;
      await dependencies.repository.withRunLock(run.id, async () => {
        const started = Date.now();
        try {
          if (!dependencies.policy)
            throw new AgentError("AGENT_LAYER_DISABLED");
          const captured = await dependencies.repository.start(
            run.id,
            dependencies.policy,
          );
          if (!captured) return;
          dependencies.logger.info(
            {
              runId: run.id,
              siteId: run.siteId,
              jobId: job.id,
              correlationId: run.correlationId,
              attempt: run.attemptCount + 1,
            },
            "agent analysis started",
          );
          const result = await runSupervisor({
            bundle: captured.bundle,
            policy: captured.policy,
            providers: dependencies.providers,
            journal: dependencies.repository.journal(run.id),
          });
          await dependencies.repository.complete(run.id, result.draft);
          const completed = await dependencies.repository.getRun(run.id);
          dependencies.logger.info(
            {
              bookedNanousd: completed?.bookedNanousd,
              invocations: completed?.invocationCount,
              runId: run.id,
              siteId: run.siteId,
              jobId: job.id,
              correlationId: run.correlationId,
              durationMs: Date.now() - started,
              draftCreated: result.draft !== null,
            },
            "agent analysis completed",
          );
        } catch (error) {
          const code =
            error instanceof AgentError || error instanceof ProviderError
              ? error.code
              : "AGENT_WORKFLOW_FAILED";
          await dependencies.repository.fail(run.id, code);
          dependencies.logger.error(
            {
              runId: run.id,
              siteId: run.siteId,
              jobId: job.id,
              correlationId: run.correlationId,
              durationMs: Date.now() - started,
              errorCode: code,
            },
            "agent analysis failed",
          );
          throw safeQueueFailure(error);
        }
      });
    }
  };
}
