# Phase 5 - Agent Layer

Status: Completed and approved by the user on 2026-10-07. Real-opportunity semantic evaluation remains an operational follow-up requiring deployment configuration.

## Objective

Add provider-independent semantic analysis where judgment is useful, while keeping all outputs structured, evidenced, bounded, and non-executable.

## In scope

- Provider-neutral LLM interface and at least one adapter
- Versioned prompts, schemas, policies, model configuration, token/cost limits, and tracing
- SEO Supervisor plus Technical SEO, Opportunity/Keyword, Content, and Internal Linking agent contracts
- Evidence minimization/packaging and prompt-injection defenses
- Zod-validated structured outputs, safe failure/retry behavior, and evaluation fixtures
- Usage, cost, latency, validation failure, and provider error records

## Out of scope

- Direct production changes
- Free-form output driving workflow state
- Automatic approval
- Approval queue, Change Ledger, and measurement implementation

## Acceptance criteria

- Agent domain code depends on an internal provider interface, not a provider SDK.
- A fake provider can run all agent tests without network access.
- Every agent has an input schema, output schema, evidence contract, prompt version, and explicit non-goals.
- Invalid, truncated, policy-violating, or provider-error output fails closed and produces no downstream recommendation/action.
- Page content is clearly delimited as untrusted data and prompt-injection fixtures do not alter system policy.
- Outputs cite internal evidence identifiers and distinguish observation, inference, confidence, and proposed next step.
- The supervisor can select/sequence specialists only within an allowlisted plan and bounded invocation budget.
- Token, cost, latency, provider/model, prompt/schema version, and validation outcome are recorded.
- Golden-set evaluations measure schema validity, evidence grounding, unsafe suggestions, and reviewer usefulness.
- Provider substitution is demonstrated with the fake adapter or a second adapter without changing agent domain logic.
- No production website credential or write tool is available to any agent.
- Tests, typecheck, lint, and build pass; provider and agent evaluation documentation is updated.

## Human inputs required

- Approved provider(s), model/cost caps, data-processing constraints, evaluation set owners, and quality thresholds

## Exit artifact

An agent evaluation report with schema pass rate, grounding review, cost/latency, known failure modes, and an explicit stop before Phase 6.

## Implementation evidence

- Provider-neutral ports, real OpenAI strict-JSON adapter, fake provider and provider substitution tests.
- Versioned evidence/output/policy schemas and centralized role prompts.
- Deterministic bounded specialist planning; Technical, Keyword, Content, Internal Linking and Supervisor synthesis.
- Exact fact copies, known references/targets/link pairs, bounded proposals, confidence/risk policies and no executable actions.
- Immutable source evidence, call usage/error/retry/cost history and validated outputs/drafts.
- Shared monthly/run reservations, per-agent restart-safe attempt limits and no implicit credential/model fallback.
- Separate authenticated operator API, durable worker jobs and safe frozen-input retry.
- Existing foundation/crawler/integration/opportunity suites remain included in verification.

Details: `docs/AGENT_LAYER.md`; operations/live configuration: `docs/runbooks/agents.md`; actual evaluation evidence: `docs/PHASE_5_EVALUATION.md`.

Real-opportunity live analysis was not performed: this checkout has no configured project database or Phase 5 route/pricing policy. This limits semantic usefulness/hallucination claims, not the mock implementation path. Provider/model, processing scope and human live evaluation thresholds remain operator inputs before enablement.

Phase 6 has since been approved for implementation and is documented in `06-approval-ledger.md`.
