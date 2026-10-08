# Agent Operations

## Prerequisites and defaults

Apply the reviewed additive migrations with `pnpm db:migrate`. Keep services private: new agent routes are authenticated, while older unauthenticated routes still require localhost/private deployment.

Agents are disabled by default. There is no fixture/fake provider selection in deployed environment configuration. Fake providers are injected only by tests. An ambient `OPENAI_API_KEY` does not automatically enable this layer or trigger spending.

Required deployment variables:

- `DATABASE_URL`: project database containing reviewed Phase 4 opportunities and Phase 5 migrations.
- `AGENTS_ENABLED=true`: API/worker enablement; keep false until provider/data review is complete.
- `AGENT_API_TOKEN`: private high-entropy operator token, at least 32 characters, for all Phase 5 routes.
- `AGENT_ACTOR_ID`: active registered actor UUID attributed to trigger/retry operations.
- `LLM_OPENAI_API_KEY`: worker-only OpenAI project credential, provided through secret injection.
- `LLM_POLICY_JSON`: complete validated route/cost policy. It contains models/prices/limits, never credentials.

For an initial named operator, register an actor through the existing administrative database boundary:

```sql
INSERT INTO actors (type, external_id, display_name)
VALUES ('HUMAN', '<operator identity>', '<operator display name>')
RETURNING id;
```

Do not share a named person's bearer credential. Clients cannot supply actor identity, model, pricing, prompts or execution fields.

## Initial Supervisor-only setup

Use the reviewed nonsecret `infrastructure/supervisor-policy.json`. The existing specialist example below is retained for later approved activation, not the current rollout. It preserves compatibility with frozen historical policies.

The user supplies `OPENAIKEY` in the ignored repository-root `.env`; this is a local provisioning input, not an automatic runtime fallback. Transfer only its value to `/opt/roco-seo/secrets/llm_openai_key` over SSH, preserve the private host parent, and use the existing worker-only file mount. Do not upload the complete local `.env` or pass a key in command arguments. Explicitly enable `AGENTS_ENABLED` and set `LLM_POLICY_JSON` only after the updated worker passes validation. The API has no provider key.

Initial settings: only Supervisor, GPT-6.1 Sol, medium reasoning, $20/month, $0.10/run, eligibility score at least 75, 12 KB total request, 2,048 total completion tokens, no provider retries and no automatic AI schedule. Review top-ranked eligible opportunities manually. Later Keyword/Technical preference is GPT-6 Luna, but those routes are not activated.

```sh
./scripts/operations/compose.sh run --rm --no-deps worker node scripts/dist/check-ai-connection.js gpt-6.1-sol
```

This makes a bounded authenticated model-metadata request, without inference/token billing. It verifies credentials/model access, not recommendation quality. It does not insert synthetic production opportunity or metric records. A real end-to-end evaluation awaits healthy Google imports and genuine scored opportunities.

## Construct specialist model policy (later approval)

Select exact supported pinned model IDs and verify their current prices/capabilities before filling these environment values. The following labels and price variables are placeholders, not recommended models or invented vendor prices:

```bash
export LLM_FAST_MODEL='<exact supported pinned model ID>'
export LLM_REASONING_MODEL='<exact supported pinned model ID>'
export LLM_FAST_INPUT_NANOUSD_PER_TOKEN='<verified positive integer>'
export LLM_FAST_OUTPUT_NANOUSD_PER_TOKEN='<verified positive integer>'
export LLM_REASONING_INPUT_NANOUSD_PER_TOKEN='<verified positive integer>'
export LLM_REASONING_OUTPUT_NANOUSD_PER_TOKEN='<verified positive integer>'
export LLM_POLICY_JSON="$(node --input-type=module <<'JS'
function rate(key) {
  const value = Number(process.env[key]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`);
  return value;
}
const fast = {
  provider: 'openai', model: process.env.LLM_FAST_MODEL,
  inputNanousdPerToken: rate('LLM_FAST_INPUT_NANOUSD_PER_TOKEN'),
  outputNanousdPerToken: rate('LLM_FAST_OUTPUT_NANOUSD_PER_TOKEN'),
};
const reasoning = {
  provider: 'openai', model: process.env.LLM_REASONING_MODEL,
  inputNanousdPerToken: rate('LLM_REASONING_INPUT_NANOUSD_PER_TOKEN'),
  outputNanousdPerToken: rate('LLM_REASONING_OUTPUT_NANOUSD_PER_TOKEN'),
};
process.stdout.write(JSON.stringify({
  routes: {
    KEYWORD: fast, CONTENT: reasoning, TECHNICAL: reasoning,
    INTERNAL_LINKING: fast, SUPERVISOR: reasoning,
  },
  maxInputBytes: 20000, maxOutputTokens: 1500,
  maxInvocations: 8, maxSpecialists: 3, retryLimit: 1,
  timeoutMs: 30000, requestsPerSecond: 0.5,
  runBudgetNanousd: 1000000000, monthlyBudgetNanousd: 100000000000,
}));
JS
)"
```

Routing above illustrates separate task classes; choose models/limits appropriate to your approved budget. Omitting temperature avoids unsupported temperature parameters. If needed, each route accepts a supported `temperature` value. Keep secrets out of shell history and source-controlled files.

Start `pnpm dev:api` and `pnpm dev:worker`. Invalid enabled configuration fails worker startup with a safe message. No autonomous agent schedule is installed.

## Trigger and inspect

Assume `siteId` and `opportunityId` refer to a reviewed OPEN/ACKNOWLEDGED opportunity. Token is already injected into the process environment:

```bash
curl --fail-with-body -X POST \
  "http://127.0.0.1:4000/sites/$siteId/opportunities/$opportunityId/analysis" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

The response returns a run ID and status. Default idempotency uses source score ID plus prompt/schema versions. To deliberately create another reviewed analysis against the same score, pass a new `idempotencyKey`; it remains subject to shared budgets.

```bash
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/agent-runs/$runId" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/agent-runs/$runId/draft" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

Inspection exposes sanitized evidence, versions, source IDs, attempts, validated findings, HTTP outcomes, latency, usage and cost basis. Failed/incomplete/insufficient runs have no draft. Every returned draft is DRAFT and non-executable.

## Retry and recovery

```bash
curl --fail-with-body -X POST \
  "http://127.0.0.1:4000/sites/$siteId/agent-runs/$runId/retry" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Only the configured active actor owning a failed run can request retry. Source evidence, prompt/schema versions, model/pricing policy and consumed attempts remain fixed. Successful calls are reused; ambiguous pending calls retain conservative cost accounting. Infrastructure recovery cannot reset consumed paid attempts. Non-retryable provider errors require a new reviewed run; exhausted attempts or incompatible versions also require a new analysis after addressing the cause.

HTTP 503 indicates disabled/unconfigured access; HTTP 401 indicates failed bearer authentication; HTTP 409 indicates rejected context/state/actor/idempotency/retry. Fix property/operator/provider setup rather than repeatedly submitting jobs.

For budget failures, inspect integer `bookedNanousd`, call reservations and cost basis. Missing usage is charged conservatively for budget purposes. Repricing an existing workflow is prohibited; create a new reviewed analysis under new configuration. A lower monthly deployment cap tightens the active month; an increased cap starts in a new month.

Disable new analysis by setting `AGENTS_ENABLED=false` and restarting services. Existing HTTP calls remain bounded by their configured timeout; this flag is not a production executor kill switch. No production executor exists.

## Controlled live validation

After credentials, exact models/prices, migrated project data and provider data-processing constraints are approved, manually choose three to ten real Phase 4 opportunities across CTR, quick-win, decay, cannibalization/content-gap and link types where available.

1. Inspect each opportunity's source coverage, bounded crawl context and score evidence before queuing.
2. Trigger individually and inspect the final run before proceeding to the next.
3. Record provider/model, types/count, schema validity, copied facts/reference accuracy, qualitative usefulness, unsupported claims, confidence/risk and token/latency/cost metadata.
4. Review prose and proposed copy against the actual pages; automated grounding does not prove semantic accuracy or legal suitability for brokerage content.
5. Keep every output as a draft. Do not approve, implement or execute it in Phase 5.

No project database or Phase 5 route/pricing policy is configured in the implementation session, so real-opportunity live validation was not performed. See the evaluation report for actual mock/database results.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL='<isolated disposable database URL>' pnpm test:integration
pnpm build
pnpm format:check
```

Integration tests truncate their isolated fixture database and budget counter; never point them at shared/project/production data. All automated model calls use injected fixtures. No paid/live calls are required.
