import { createHash } from "node:crypto";
import {
  ProviderError,
  type LLMProvider,
  type GenerationRequest,
  type GenerationResult,
} from "@roco/llm";
import {
  AgentError,
  analysisSchema,
  draftSchema,
  evidenceSchema,
  policySchema,
  getAgentRoute,
  type AgentType,
  type Analysis,
  type AgentPolicy,
  type EvidenceBundle,
  type Draft,
} from "./contracts.js";
import { systemPrompt, PROMPT_VERSION } from "./prompts/index.js";
import { remoteAnalysisSchema, validateAnalysis } from "./validation.js";
export interface CallRecord {
  id: string;
  attempt: number;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  reservedNanousd: string;
  costNanousd: string | null;
  output: Analysis | null;
  retryable: boolean | null;
}
export interface WorkflowJournal {
  calls(agent: AgentType): Promise<CallRecord[]>;
  reserve(input: {
    agent: AgentType;
    attempt: number;
    provider: string;
    model: string;
    promptVersion: string;
    inputHash: string;
    reservedNanousd: string;
  }): Promise<string>;
  settle(
    id: string,
    input: {
      result: GenerationResult | null;
      output: Analysis | null;
      costNanousd: string;
      costBasis: "USAGE_ESTIMATE" | "RESERVATION";
      errorCode: string | null;
      retryable: boolean;
      durationMs: number;
      httpStatus: number | null;
    },
  ): Promise<void>;
}
export function selectSpecialists(
  bundle: EvidenceBundle,
  maxSpecialists: number,
  executionMode: AgentPolicy["executionMode"] = "SPECIALISTS",
): AgentType[] {
  if (executionMode === "SUPERVISOR_ONLY") return [];
  const plans: Record<EvidenceBundle["type"], AgentType[]> = {
    QUICK_WIN: ["KEYWORD", "CONTENT"],
    CTR: ["KEYWORD", "CONTENT"],
    DECAY: ["KEYWORD", "TECHNICAL"],
    CANNIBALIZATION_CANDIDATE: ["KEYWORD", "CONTENT"],
    CONTENT_GAP_CANDIDATE: ["KEYWORD", "CONTENT"],
    INTERNAL_LINK: ["INTERNAL_LINKING"],
  };
  const plan = [...plans[bundle.type]];
  if (
    bundle.facts.some((f) => f.source.kind === "ISSUE_OCCURRENCE") &&
    !plan.includes("TECHNICAL")
  )
    plan.push("TECHNICAL");
  if (plan.length > maxSpecialists)
    throw new AgentError("SPECIALIST_PLAN_EXCEEDS_LIMIT");
  return plan;
}
export function quoteReservation(
  request: GenerationRequest,
  route: ReturnType<typeof getAgentRoute>,
): string {
  // UTF-8 bytes plus a conservative protocol allowance bound ordinary text tokenization.
  const inputCeiling =
    Buffer.byteLength(JSON.stringify(request), "utf8") + 4096;
  return (
    BigInt(inputCeiling) * BigInt(route.inputNanousdPerToken) +
    BigInt(request.maxOutputTokens) * BigInt(route.outputNanousdPerToken)
  ).toString();
}
export function quoteUsage(
  result: GenerationResult,
  route: ReturnType<typeof getAgentRoute>,
  reserved: string,
): { costNanousd: string; costBasis: "USAGE_ESTIMATE" | "RESERVATION" } {
  if (
    result.inputTokens === null ||
    result.outputTokens === null ||
    result.inputTokens === 0 ||
    result.outputTokens === 0
  )
    return { costNanousd: reserved, costBasis: "RESERVATION" };
  if (
    !Number.isSafeInteger(result.inputTokens) ||
    !Number.isSafeInteger(result.outputTokens) ||
    result.inputTokens < 0 ||
    result.outputTokens < 0
  )
    throw new AgentError("INVALID_PROVIDER_USAGE");
  return {
    costNanousd: (
      BigInt(result.inputTokens) * BigInt(route.inputNanousdPerToken) +
      BigInt(result.outputTokens) * BigInt(route.outputNanousdPerToken)
    ).toString(),
    costBasis: "USAGE_ESTIMATE",
  };
}
export async function runSupervisor(input: {
  bundle: EvidenceBundle;
  policy: AgentPolicy;
  providers: ReadonlyMap<string, LLMProvider>;
  journal: WorkflowJournal;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ analyses: Analysis[]; draft: Draft | null }> {
  const bundle = evidenceSchema.parse(input.bundle);
  const policy = policySchema.parse(input.policy);
  if (
    bundle.facts.length < 2 ||
    bundle.sourceConfidence === 0 ||
    bundle.quality === 0
  )
    return { analyses: [], draft: null };
  const plan = selectSpecialists(
    bundle,
    policy.maxSpecialists,
    policy.executionMode,
  );
  for (const agent of [...plan, "SUPERVISOR"] as AgentType[])
    if (!input.providers.has(getAgentRoute(policy, agent).provider))
      throw new AgentError("PROVIDER_NOT_CONFIGURED");
  const sleep =
    input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (plan.length + 1 > policy.maxInvocations)
    throw new AgentError("INVOCATION_LIMIT_BELOW_PLAN");
  const initialHistory = new Map<AgentType, CallRecord[]>();
  for (const agent of [...plan, "SUPERVISOR"] as AgentType[])
    initialHistory.set(agent, await input.journal.calls(agent));
  let invocationCount = [...initialHistory.values()].reduce(
    (n, calls) => n + calls.length,
    0,
  );
  let booked = [...initialHistory.values()]
    .flat()
    .reduce(
      (n, call) => n + BigInt(call.costNanousd ?? call.reservedNanousd),
      0n,
    );
  const analyses: Analysis[] = [];
  let lastRequestAt = 0;
  async function analyze(agent: AgentType): Promise<Analysis> {
    const route = getAgentRoute(policy, agent);
    const provider = input.providers.get(route.provider)!;
    const history = initialHistory.get(agent)!;
    const cached = history.find(
      (call) => call.status === "SUCCEEDED" && call.output !== null,
    );
    if (
      history.some(
        (call) => call.status === "FAILED" && call.retryable === false,
      )
    )
      throw new AgentError("AGENT_NONRETRYABLE_FAILURE_CREATE_NEW_RUN");
    for (const call of history.filter((call) => call.status === "RUNNING"))
      await input.journal.settle(call.id, {
        result: null,
        output: null,
        costNanousd: call.reservedNanousd,
        costBasis: "RESERVATION",
        errorCode: "INTERRUPTED_CALL_UNKNOWN_USAGE",
        retryable: true,
        durationMs: 0,
        httpStatus: null,
      });
    if (cached) return analysisSchema.parse(cached.output);
    for (
      let attempt = history.length;
      attempt <= policy.retryLimit;
      attempt++
    ) {
      const request: GenerationRequest & { schema: Record<string, unknown> } = {
        model: route.model,
        system: systemPrompt(agent),
        input: JSON.stringify({
          kind: "UNTRUSTED_EVIDENCE",
          evidence: bundle,
          specialists: agent === "SUPERVISOR" ? analyses : [],
          repairCode:
            attempt > 0
              ? "Prior attempt failed validation or provider contract. Follow the original schema and facts."
              : null,
        }),
        maxOutputTokens: policy.maxOutputTokens,
        timeoutMs: policy.timeoutMs,
        temperature: route.temperature,
        reasoningEffort: route.reasoningEffort,
        schema: remoteAnalysisSchema(),
      };
      if (
        Buffer.byteLength(JSON.stringify(request), "utf8") >
        policy.maxInputBytes
      )
        throw new AgentError("AGENT_INPUT_TOO_LARGE");
      const remainingDelay =
        1000 / policy.requestsPerSecond - (Date.now() - lastRequestAt);
      if (remainingDelay > 0) await sleep(remainingDelay);
      const reserved = quoteReservation(request, route);
      if (
        invocationCount >= policy.maxInvocations ||
        booked + BigInt(reserved) > BigInt(policy.runBudgetNanousd)
      )
        throw new AgentError("AGENT_BUDGET_EXCEEDED");
      const callId = await input.journal.reserve({
        agent,
        attempt,
        provider: route.provider,
        model: route.model,
        promptVersion: PROMPT_VERSION,
        inputHash: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
        reservedNanousd: reserved,
      });
      invocationCount++;
      booked += BigInt(reserved);
      const started = Date.now();
      lastRequestAt = started;
      let result: GenerationResult | null = null;
      let output: Analysis | null = null;
      let failure: AgentError | ProviderError | null = null;
      try {
        result = await provider.structuredGenerate(request);
        if (result.text.length > 16000)
          throw new AgentError("AGENT_OUTPUT_TOO_LARGE", true);
        let raw: unknown;
        try {
          raw = JSON.parse(result.text);
        } catch {
          throw new AgentError("INVALID_AGENT_JSON", true);
        }
        output = validateAnalysis(
          raw,
          agent,
          bundle,
          agent === "SUPERVISOR" ? analyses : [],
        );
      } catch (error) {
        failure =
          error instanceof AgentError || error instanceof ProviderError
            ? error
            : new AgentError("AGENT_CALL_FAILED", true);
      }
      const charge = result
        ? quoteUsage(result, route, reserved)
        : { costNanousd: reserved, costBasis: "RESERVATION" as const };
      if (BigInt(charge.costNanousd) > BigInt(reserved))
        failure = new AgentError("PROVIDER_USAGE_EXCEEDS_RESERVATION");
      await input.journal.settle(callId, {
        result,
        output: failure ? null : output,
        ...charge,
        errorCode: failure?.code ?? null,
        retryable: failure?.retryable ?? false,
        durationMs: Date.now() - started,
        httpStatus:
          failure instanceof ProviderError
            ? failure.status
            : route.provider === "openai"
              ? 200
              : null,
      });
      booked += BigInt(charge.costNanousd) - BigInt(reserved);
      if (!failure && output) return output;
      if (!failure?.retryable || attempt >= policy.retryLimit)
        throw failure ?? new AgentError("AGENT_CALL_FAILED");
      await sleep(Math.min(5000, 250 * 2 ** attempt));
    }
    throw new AgentError("AGENT_ATTEMPTS_EXHAUSTED");
  }
  for (const specialist of plan) analyses.push(await analyze(specialist));
  if (analyses.some((a) => a.assessment === "INSUFFICIENT_EVIDENCE"))
    return { analyses, draft: null };
  const final = await analyze("SUPERVISOR");
  analyses.push(final);
  return {
    analyses,
    draft:
      final.assessment === "SUPPORTED"
        ? draftSchema.parse({
            status: "DRAFT",
            executable: false,
            analysis: final,
          })
        : null,
  };
}
