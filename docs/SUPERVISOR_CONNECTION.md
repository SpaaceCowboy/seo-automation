# Initial SEO Supervisor connection

User authorization: 2026-10-08. Activate SEO Supervisor only. Use OpenAI GPT-6.1 Sol with medium reasoning and a $20 monthly application limit. Keyword/Technical preference is GPT-6 Luna for a later approved stage; Content/Internal Linking remain deferred.

## Connection and data boundary

The user-provided repository-root `.env` variable `OPENAIKEY` is explicitly transferred into the VPS worker's mounted `llm_openai_key` secret. The local environment and intermediate key file are ignored and permission-restricted. No general ambient key fallback or API/dashboard key mount exists. The key is never printed or embedded in the image.

A bounded authenticated `GET /v1/models/gpt-6.1-sol` from the VPS returned HTTP 200. This confirms credential/model metadata access without an inference request. No synthetic production opportunities, Google observations or recommendations are inserted to make connection validation look like a real evaluation. Live structured inference/recommendation quality remains unverified until genuine opportunity evidence exists.

## Initial policy

`infrastructure/supervisor-policy.json`:

- Execution mode: SUPERVISOR_ONLY; only one required route.
- Model: `gpt-6.1-sol`; reasoning effort: medium; no tools, no provider storage.
- Shared monthly cap: $20; per-analysis ceiling: $0.10.
- Priority eligibility: immutable opportunity score at least 75/100. This is a configurable budget gate, not detector tuning.
- Serialized request cap: 12,000 bytes, including schema/system/evidence overhead.
- Completion cap: 2,048 tokens, including hidden reasoning; timeout: 60 seconds.
- One provider attempt, zero paid repair retries; process pacing: at most 0.5 requests/second.
- Manual trigger only; no automatic AI schedule.

The [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) documents this exact model ID and medium reasoning support. It lists standard input at $2/M, cache writes at $2.50/M and output at $10/M. The application's input allowance conservatively uses $2.50/M and does not apply cached-input discounts. The [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) defines `reasoning_effort` and the reasoning-inclusive completion bound.

The monthly limit uses integer conservative estimates/reservations and database locks. It controls this deployment, not unrelated provider-account spending. Ambiguous/failed usage remains reserved rather than treated as free. Truncated output fails instead of generating a paid automatic repair. A $20 ceiling does not guarantee useful results; token accounting and semantic quality require the subsequent live evaluation.

## Implementation safeguards

Supervisor analyzes original facts directly without specialist calls. Both workflow selection and database reservations independently enforce this mode. Inactive routes are optional; legacy policies without an execution mode retain SPECIALISTS behavior. The database prevents frozen runs from switching execution modes and applies the tighter active/frozen eligibility floor before spending.

Prompt version is `seo-prompts-v2`; pending older prompt versions need a new analysis. Historical results remain readable. Runtime validation preserves known fact IDs/values, target scope, risk floors, confidence caps and non-executable drafts. No agent can approve or apply changes to RocoBroker.

## Verification

- 155 unit tests passed, including all opportunity types invoking only Supervisor and explicit medium-reasoning serialization.
- 29 database integration tests passed, including single persisted Supervisor output, blocked specialist reservations, low-score refusal, frozen-mode refusal and existing shared budget/retry/approval behavior.
- Lint, typecheck, formatting and production build passed.
- Four local browser regression scenarios passed. The first Supervisor image activated successfully, all five VPS services passed health checks, and safe runtime inspection confirmed SUPERVISOR_ONLY with one route, medium reasoning, $20/month, $0.10/run, score floor 75 and 2,048 completion tokens. The live HTTPS smoke test passed all eleven sections, RTL/mobile, secure cookies and origin protection. No production agent run or invocation exists, consistent with the absence of genuine opportunity data.

## Operations

```sh
cd /opt/roco-seo/app
./scripts/operations/compose.sh run --rm --no-deps worker node scripts/dist/check-ai-connection.js gpt-6.1-sol
./scripts/operations/compose.sh ps
./scripts/operations/compose.sh logs --tail 100 worker
```

Production policy is stored in `/opt/roco-seo/config/production.env`, separate from its credential mount. Changing mode requires explicit approval; lower caps/score eligibility remain independently enforced on frozen-source jobs. Before the first real inference, connect Google, run a healthy opportunity analysis and manually select a high-scoring result. Real provider output, usage, latency, usefulness and grounding must then be reviewed. Phase 8 is not authorized.

OpenAI requests explicitly select `service_tier: default` to bind standard pricing. A response reporting another tier fails closed. This prevents a project-level automatic priority setting from silently changing the request tier; the conservative budget remains an application estimate, not an invoice guarantee.

## Files changed for this connection

- `packages/agents/src/contracts.ts`, `workflow.ts`, `prompts/index.ts`: mode, eligibility, optional inactive routes, reasoning and direct Supervisor prompts.
- `packages/agents/test/agents.test.ts`, `fixtures.ts`: mode and compatibility coverage.
- `packages/llm/src/index.ts`, `test/provider.test.ts`: medium reasoning, standard processing tier and billing-tier validation.
- `packages/db/src/agent-repository.ts`, `tests/integration/agents.integration.test.ts`: independent reservations, score gating and frozen-mode protection.
- `apps/worker/src/runtime.ts`: validate only active routes.
- `packages/shared/src/index.ts`: redact the user-selected local key name.
- `infrastructure/supervisor-policy.json`, `scripts/operations/check-ai-connection.ts`, `scripts/tsconfig.build.json`: deployed policy and bounded credential/model probe.
- `docs/AGENT_LAYER.md`, `runbooks/agents.md`, `OPERATIONS.md`, `MASTER_PLAN.md`, `DECISIONS.md`, `PHASE_7_5_VALIDATION.md`, this report and README: rollout/activation/operational documentation.

No external application dependency or database migration was added. Earlier uncommitted project changes were preserved.

Final deployed image: `roco-seo:supervisor-20261008-v2`, configuration digest `sha256:6ea4e0d74b954f2c9d690aef5b775af52d2ebce01edb0f9122f3c79fbeb38b02`. All five services passed health after final recreation. The canonical worker model-access probe again returned HTTP 200 without inference; HTTPS sign-in returned 200. Fresh encrypted database/configuration backups include the activated policy and mounted provider key.
