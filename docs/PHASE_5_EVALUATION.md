# Phase 5 Evaluation — 2026-10-06

## Scope and live status

Phase 4 was approved by the user. This delivery implements Phase 5 only: bounded evidence analysis and validated non-executable drafts. No approval, website write, Change Ledger, measurement or full-dashboard capability was added.

No live provider API calls were made by the application. This checkout has no configured project `DATABASE_URL`, Phase 5 route/pricing policy or enabled agent runtime. Ambient credentials are not consumed automatically. Consequently, real-opportunity semantic usefulness, live token/latency/cost behavior and production hallucination rates are unmeasured.

Enablement requires `DATABASE_URL`, migrated project observations, `AGENTS_ENABLED=true`, `AGENT_API_TOKEN`, active `AGENT_ACTOR_ID`, worker-only `LLM_OPENAI_API_KEY` and complete `LLM_POLICY_JSON` with exact pinned models, verified integer token prices and limits. `runbooks/agents.md` supplies the concrete policy construction, API commands and a three-to-ten-opportunity live review procedure.

## Controlled evaluation fixtures

Six representative opportunity-type scenarios exercise Quick Win, CTR, Decay, Cannibalization Candidate, Content Gap Candidate and Internal Linking. All six produce schema-valid, grounded, non-executable mock drafts through their expected specialist plan and Supervisor.

- Schema-valid final drafts: six of six controlled scenarios.
- Exact fact preservation: observed impression value remains 12,400 across validated role outputs; altered values, unknown references and invented target identities are rejected by negative fixtures.
- Unsafe formal actions: execution/approval-shaped or unknown action fields are rejected; risk floors and non-executable status are enforced.
- Confidence: a mock model requesting 0.95 is capped at 0.8 by the controlled source evidence. Poor quality and weaker specialist confidence lower the final value.
- Routing: all four specialists are exercised; a second named fixture provider and different content-model route demonstrate substitution without domain changes.
- Retry: transient/malformed attempts repair within the limit; refusals remain non-retryable across workflow restart. Invalid responses create no validated output/draft.
- Injection: adversarial source strings stay in untrusted evidence, cannot add execution-shaped output or obtain credentials/tools.

These are contract/guardrail fixtures, not real semantic judgments. Mock recommendation usefulness is not independently scored. Qualitative hallucinations and real content intent remain human evaluation work. In particular, exact citations do not prove the relevance of an inference.

The six golden routing scenarios use seventeen mock provider invocations total. Fixture usage is explicitly supplied as 100 input and 50 output tokens per call: 1,700 input and 850 output tokens in that scenario set. These are synthetic counters, not tokenizer measurements or paid usage. Fixture pricing yields integer bookkeeping only and is not a vendor price quote.

## Persistence and queue validation

Isolated PostgreSQL 17.11 on localhost port 55435 validates all six migrations and Phase 1–5 behavior. Tests cover immutable evidence/output, draft matching, concurrent idempotent triggers, workflow locking, conservative booking, shared month limits, inactive actors, rejected responses and durable delivery/redelivery.

Actual pg-boss agent delivery uses an injected fixture handler on an isolated fixture queue. It creates one draft with three validated call records; redelivery retains the same three invocations. Malformed-response runs persist safe failure metadata and zero validated outputs/drafts. No paid call, Google call or website request occurs in these tests.

## Verification evidence

- `pnpm lint`: PASS, zero warnings.
- `pnpm typecheck`: PASS for all packages/apps and operational/integration scripts.
- `pnpm test`: PASS, 108 tests in 20 files, including existing Phase 1–4 regressions.
- `TEST_DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55435/roco_phase5_test pnpm test:integration`: PASS, ten migration/history tests, one opportunity queue test and four Phase 5 persistence/queue tests.
- `pnpm build`: PASS for packages, API, worker and unchanged Next.js dashboard.
- `pnpm format:check`: PASS.
- `DATABASE_URL=postgresql://localhost/roco_seo pnpm db:generate`: no schema drift; placeholder URL is used only for generation, not deployment migration.

The PostgreSQL cluster is disposable and stopped after verification. No shared/project/production database was migrated or modified. New packages reuse the existing Zod dependency; no provider SDK or dependency version upgrade was introduced.

## Acceptance and outstanding review

Provider-independent contracts, bounded model routing, all specialists/Supervisor, versioned prompts/schemas, factual grounding, safe failures/retries, immutable history, integer cost controls, authenticated APIs and durable jobs are implemented and covered by controlled tests.

Remaining human validation: approved provider/data processing, pinned model capabilities/prices, real-opportunity intent/content usefulness, multilingual qualitative claims, acceptable confidence/risk defaults and reviewer-quality thresholds. Estimates do not guarantee provider invoices; redaction is not exhaustive PII detection. Brokerage copy must be reviewed before any later execution workflow.

Phase 5 is ready for implementation review. Phase 6 remains unapproved and unimplemented.

## Files changed

50 Phase 5 files changed or added relative to the approved Phase 4 workspace:

- `.env.example`
- `README.md`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/test/agents.test.ts`
- `apps/worker/package.json`
- `apps/worker/src/jobs/analyze-opportunity.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/test/agents.test.ts`
- `docs/AGENT_LAYER.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DECISIONS.md`
- `docs/MASTER_PLAN.md`
- `docs/PHASE_5_EVALUATION.md`
- `docs/SECURITY.md`
- `docs/phases/04-opportunity-engine.md`
- `docs/phases/05-agents.md`
- `docs/runbooks/agents.md`
- `package.json`
- `packages/agents/package.json`
- `packages/agents/src/contracts.ts`
- `packages/agents/src/evidence.ts`
- `packages/agents/src/index.ts`
- `packages/agents/src/prompts/index.ts`
- `packages/agents/src/validation.ts`
- `packages/agents/src/workflow.ts`
- `packages/agents/test/agents.test.ts`
- `packages/agents/test/fixtures.ts`
- `packages/agents/tsconfig.build.json`
- `packages/agents/tsconfig.json`
- `packages/config/src/index.ts`
- `packages/db/migrations/0005_phase5_agents.sql`
- `packages/db/migrations/meta/0005_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/package.json`
- `packages/db/src/agent-repository.ts`
- `packages/db/src/agent-schema.ts`
- `packages/db/src/index.ts`
- `packages/db/src/schema.ts`
- `packages/db/test/agent-lock.test.ts`
- `packages/llm/package.json`
- `packages/llm/src/index.ts`
- `packages/llm/test/provider.test.ts`
- `packages/llm/tsconfig.build.json`
- `packages/llm/tsconfig.json`
- `packages/shared/src/index.ts`
- `pnpm-lock.yaml`
- `tests/integration/agents.integration.test.ts`
