import { randomUUID } from "node:crypto";
import type { Job } from "pg-boss";
import {
  connectionJobSchema,
  runtimeSnapshotSchema,
  agentCodeSchema,
  type RuntimeSnapshot,
} from "@roco/shared/control";
import type { WorkerConfig } from "@roco/config";
import type { AgentPolicy } from "@roco/agents";
import type { IntegrationStatusRepository, CheckResult } from "@roco/db";
import { WorkflowError } from "@roco/workflow";
import type { Logger } from "@roco/shared";

export function integrationSnapshot(
  config: WorkerConfig,
  policy: AgentPolicy | null,
): RuntimeSnapshot {
  return runtimeSnapshotSchema.parse({
    agentsEnabled: config.AGENTS_ENABLED,
    policyKnown: !config.AGENTS_ENABLED || policy !== null,
    agents: agentCodeSchema.options.map((code) => ({
      code,
      enabled:
        config.AGENTS_ENABLED &&
        !!policy &&
        (policy.executionMode === "SPECIALISTS" || code === "SUPERVISOR"),
      model: policy?.routes[code]?.model ?? null,
      reasoning: policy?.routes[code]?.reasoningEffort ?? null,
    })),
    openai: {
      keyConfigured: !!config.LLM_OPENAI_API_KEY,
      model: policy?.routes.SUPERVISOR.model ?? null,
    },
    google: {
      siteId: config.GOOGLE_SITE_ID ?? null,
      GSC: !!config.GSC_PROPERTY && !!config.GOOGLE_CREDENTIALS_FILE,
      GA4: !!config.GA4_PROPERTY_ID && !!config.GOOGLE_CREDENTIALS_FILE,
      PAGESPEED: !!config.PAGESPEED_API_KEY,
    },
    limits: {
      monthlyNanousd: policy ? String(policy.monthlyBudgetNanousd) : null,
      runNanousd: policy ? String(policy.runBudgetNanousd) : null,
      minScore: policy?.minOpportunityScore ?? null,
    },
  });
}
async function metadataMatches(
  response: Response,
  model: string,
): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) return false;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return false;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      value.id === model &&
      "object" in value &&
      value.object === "model"
    );
  } catch {
    return false;
  }
}
export async function checkOpenaiAccess(
  key: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    if (!key || !/^[a-zA-Z0-9_.-]{1,100}$/.test(model))
      return {
        status: "FAILED",
        errorCode: "OPENAI_NOT_CONFIGURED",
        httpStatus: null,
        durationMs: 0,
      };
    const response = await fetcher(
      `https://api.openai.com/v1/models/${model}`,
      {
        headers: { authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const verified =
      response.status === 200 && (await metadataMatches(response, model));
    if (response.status !== 200) await response.body?.cancel();
    const errorCode = verified
      ? null
      : response.status === 200
        ? "OPENAI_INVALID_MODEL_RESPONSE"
        : response.status === 401
          ? "OPENAI_CREDENTIAL_REJECTED"
          : response.status === 403
            ? "OPENAI_ACCESS_DENIED"
            : response.status === 404
              ? "OPENAI_MODEL_UNAVAILABLE"
              : response.status === 429
                ? "OPENAI_RATE_LIMITED"
                : response.status >= 500
                  ? "OPENAI_PROVIDER_UNAVAILABLE"
                  : "OPENAI_CHECK_REJECTED";
    return {
      status: verified ? "VERIFIED" : "FAILED",
      errorCode,
      httpStatus: response.status,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: "FAILED",
      errorCode:
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
          ? "OPENAI_CHECK_TIMEOUT"
          : "OPENAI_CHECK_NETWORK_ERROR",
      httpStatus: null,
      durationMs: Date.now() - started,
    };
  }
}
function safeDispatchFailure(): Error {
  return new Error("INTEGRATION_CHECK_DISPATCH_FAILED", {
    cause: new Error("INTEGRATION_CHECK_DISPATCH_FAILED"),
  });
}
export function createOpenaiCheckHandler(dependencies: {
  repository: IntegrationStatusRepository;
  instanceId: string;
  key: string | undefined;
  logger: Logger;
  fetcher?: typeof fetch;
}) {
  return async (jobs: Job<unknown>[]) => {
    for (const job of jobs) {
      const data = job.data;
      let checkId: string, instanceId: string, correlationId: string;
      if (
        typeof data === "object" &&
        data !== null &&
        "dispatch" in data &&
        data.dispatch === true
      ) {
        try {
          const ticket = await dependencies.repository.request(
            "trigger" in data && data.trigger === "STARTUP"
              ? "STARTUP"
              : "SCHEDULED",
          );
          if (!ticket.enqueue) continue;
          ({ id: checkId, instanceId, correlationId } = ticket);
        } catch (error) {
          if (
            error instanceof WorkflowError &&
            [
              "OPENAI_NOT_CONFIGURED",
              "INTEGRATION_WORKER_UNAVAILABLE",
            ].includes(error.code)
          )
            continue;
          dependencies.logger.error(
            { errorCode: "INTEGRATION_CHECK_DISPATCH_FAILED", jobId: job.id },
            "connection check dispatch failed",
          );
          throw safeDispatchFailure();
        }
      } else
        ({ checkId, instanceId, correlationId } =
          connectionJobSchema.parse(data));
      if (instanceId !== dependencies.instanceId) continue;
      const check = await dependencies.repository.claim(checkId, instanceId);
      if (!check) continue;
      const result = await checkOpenaiAccess(
        dependencies.key ?? "",
        check.model,
        dependencies.fetcher,
      );
      await dependencies.repository.finish(checkId, result);
      dependencies.logger.info(
        {
          checkId,
          correlationId,
          jobId: job.id,
          status: result.status,
          errorCode: result.errorCode,
          httpStatus: result.httpStatus,
          durationMs: result.durationMs,
        },
        "OpenAI model access check completed",
      );
    }
  };
}
export const newRuntimeInstance = () => randomUUID();
