# Phase 5 Agent Layer

## Boundary

Phase 5 interprets deterministic evidence and produces validated, non-executable DRAFT output. It does not approve recommendations, modify RocoBroker, publish articles, create a Change Ledger or schedule measurements. The implemented Phase 6 workflow layer separately owns recommendation versions, approvals and measurements. Drafts are attached to validated Supervisor records in `agent_outputs`, not an executable recommendation table.

`@roco/llm` defines `LLMProvider.generate` and `structuredGenerate`, an injectable fixture provider and one real OpenAI HTTP adapter. `@roco/agents` contains evidence/input/output schemas, versioned prompt assets, deterministic specialist planning, grounding/risk/confidence validation and Supervisor orchestration. It has no database or application dependency. Workers own provider calls and history through `@roco/db`; API handlers only validate, authenticate, enqueue and read.

## Supervisor and contracts

The initial production rollout uses `executionMode: SUPERVISOR_ONLY`, following section 22 of the original proposal. Only the Supervisor route is required; it analyzes the frozen original evidence directly. No specialist is invoked or reserved. Specialist activation requires a later explicit approval.

For historical policies without the mode field, parsing preserves the existing `SPECIALISTS` behavior. In that mode, the Supervisor chooses an allowlisted plan from opportunity type:

- Quick Win, CTR, cannibalization and content-gap candidates: KEYWORD then CONTENT.
- Decay: KEYWORD then TECHNICAL.
- Internal-link opportunities: INTERNAL_LINKING.
- Supplied technical issue occurrences add TECHNICAL where not already selected.

The default maximum is three specialists. Plans exceeding the configured limit fail before calls; specialists are not silently dropped. A final SUPERVISOR invocation synthesizes validated specialist findings against the original facts. The model cannot add specialists, invoke tools, query PostgreSQL or browse the website. If specialists report insufficient evidence, no final draft is created.

All five agents accept the same bounded `agent-evidence-v1` input contract and return `seo-agent-v1`; role/action validation binds output to the expected specialist and opportunity:

- TECHNICAL interprets canonical/indexability/status/schema/issue context; it does not replace deterministic rules. Allowed actions: observation, schema, canonical and manual URL/redirect/deletion suggestions.
- KEYWORD interprets supplied visibility, CTR, position, decay, queries and competition candidates; it cannot invent volume, competitor observations or confirmed intent. Allowed actions cover observation, presentation/content briefs and manual consolidation-related suggestions.
- CONTENT uses supplied title/meta/word-count/query evidence to propose bounded titles, descriptions, headings, brief sections or FAQ concepts. No full article or publishing action exists. Unsupplied page-body/heading details must remain assumptions.
- INTERNAL_LINKING assesses only supplied eligible source/target pairs. It may provide a rationale and short anchor concept, but cannot invent target/source identities or edit links.
- SUPERVISOR combines specialist findings and returns a non-executable draft. Risk cannot be lower than the contributing specialist risks.

## Evidence selection and grounding

Each analysis is tied to an immutable Phase 4 score observation. Selection uses the latest analysis window, not simply the last inserted backfill observation. A frozen evidence record captures at most five page identities, ten queries, ten technical issue occurrences and fifty scalar facts. Facts cite the score, page snapshot, query or issue ID plus field path. It never sends complete crawl histories or raw HTML/page bodies.

Page title/meta/canonical/indexability/status/word-count context is drawn from the crawl referenced by the source opportunity run. Queries and issues remain site-scoped. Text is bounded and common credential/email patterns are redacted; URL credentials, query strings and fragments are removed from provider-facing display context. Explicit page IDs retain target identity independently of display URLs. Redaction/selection limits lower confidence and add limitations. This is data minimization, not a general-purpose PII classifier; operators must review the permitted dataset before enabling a provider.

Observations must copy supplied fact IDs and values exactly. Unknown references, targets or link pairs fail validation. Numeric measurements belong only in typed observations; digits in summaries/inferences/rationales/assumptions/warnings are rejected. Proposal digits must already occur in supplied textual context. This conservative rule may reject otherwise useful prose and trigger a bounded repair attempt.

Qualitative inferences cite facts and remain distinguishable from measurements. Prompts forbid invented metrics, unsupported competitor claims, Google guarantees and approval/execution claims. Policy checks block known unsupported claim patterns. They cannot prove that every semantic conclusion or every language's prose is correct: human review and live evaluation remain necessary.

All source and specialist text is explicitly untrusted user-message data. System policy is separate and versioned. No tools, secrets, application access or production credentials are passed to the model. Invalid output is never persisted as a structured result; only safe failure codes and usage metadata survive rejected attempts.

## Prompts and schemas

Prompt assets live in `packages/agents/src/prompts/index.ts`, with explicit role, responsibility, non-goals and shared grounding policy. Version identifiers:

- Prompts: `seo-prompts-v2`.
- Agent output: `seo-agent-v1`.
- Evidence: `agent-evidence-v1`.
- Policy: `agent-policy-v1`.

Prompt/schema versions, provider/model, request hash and evidence reference are recorded. Raw request prompts and invalid model bodies are not logged or retained. Runs whose prompt/schema version no longer matches the installed worker require a new analysis rather than reinterpretation under changed assets.

The model output schema contains assessment, summary, exact observations, cited inferences/actions, target/source page IDs, confidence, risk, expected metric, assumptions and warnings. Zod rejects extra fields, non-finite values, impossible confidence and unsupported action types. The real adapter requests the documented strict JSON-schema subset; local validation retains all length/cardinality constraints. Persistence revalidates output and evidence ceilings, independently of worker orchestration.

## Confidence and risk

Specialist confidence is:

`floor(min(model confidence, Phase 4 source confidence) * evidence quality * 10000) / 10000`.

Evidence quality begins with observed-day/window coverage and is multiplied by 0.8 for capped context and by 0.8 for redacted/truncated text. Supervisor confidence is also capped by the lowest validated specialist confidence, without applying the quality penalty a second time. Confidence is an evidence-strength heuristic, not a probability of traffic uplift.

Risk floors are deterministic:

- LOW: observation/reporting.
- MEDIUM: title/meta/headings/content brief/FAQ/internal-link/schema suggestions.
- HIGH: canonical suggestions.
- SPECIAL_APPROVAL: redirects, URL changes, deletion and major rewrites.

Models may raise risk but cannot lower these floors or contributing specialist risk. Every draft retains `status: DRAFT` and `executable: false`, including high-risk suggestions. There are no approval or execution endpoints.

## Provider and model routing

The runtime installs the OpenAI adapter; domain tests prove substitution through differently named injected providers without changing agent logic. Adding DeepSeek/OpenRouter/another provider requires an adapter and worker registry/credential wiring, not changes to the agent domain.

Only active agents require provider/model and token pricing routes. Supervisor-only mode accepts a single SUPERVISOR route; specialist mode requires all existing specialist routes. Each route can set explicit reasoning effort. Operators can route simpler analysis and complex synthesis to different models. No model, price or provider fallback is guessed. OpenAI model IDs must be pinned exact IDs: a different returned model fails closed to prevent unnoticed pricing/routing drift. Temperature is optional; omit it for models that do not support it.

The adapter uses fixed `https://api.openai.com/v1/chat/completions`, disabled redirects, no tools, `store: false`, strict JSON output, bounded response streaming and `max_completion_tokens`. Refusals, tool calls, incomplete output, malformed envelopes and model drift are explicit errors. Implementation references: [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Cost, retry and concurrency controls

Money is integer nanodollars: one USD equals 1,000,000,000 nanodollars. Prices are configured integer nanodollars/token; USD per million tokens multiplied by 1,000 gives this unit. Usage estimates use `BigInt` arithmetic and PostgreSQL integer-scale `numeric`, exposed as strings. Prices are operator-supplied estimates, not claims about current vendor billing.

Defaults:

- Request size: 20,000 UTF-8 bytes; configurable ceiling 32,000.
- Completion tokens: 1,500; ceiling 4,096.
- Specialists: three; total provider attempts: eight, ceiling twelve.
- Retry limit: one per agent, including bounded schema repair.
- Timeout: thirty seconds; configurable ceiling two minutes.
- Start rate: one request every two seconds per workflow/process.
- Run budget: one USD; monthly deployment budget: one hundred USD.

Before a call, the journal atomically reserves a conservative input/output quote against both run and shared monthly limits. Input reservation uses UTF-8 request bytes plus a protocol allowance; output uses the configured completion ceiling. Positive explicit rates are mandatory for the real runtime. Concurrent workers cannot independently spend the same remaining budget.

Known positive usage replaces the reservation with a configured-price estimate. Missing/zero/invalid or interrupted usage is not treated as free: unknown calls retain conservative reservations. Usage above its reserved quote stops the workflow and records the excess instead of producing a draft. Estimates do not guarantee the provider's invoice, account-wide spending outside this application or prices remaining unchanged.

Monthly booking follows each call's UTC month, including retries crossing a month boundary. A newly applied lower monthly policy tightens the existing month's shared ceiling, even for resumed runs; raising that ceiling takes effect in a new month. Per-run pricing/routing snapshots remain immutable.

Each external attempt is recorded before sending. Refusals and other non-retryable failures remain non-retryable after worker/job restart. Successful specialist calls are cached. Pending interrupted calls are closed with unknown-usage accounting before bounded resume. Paid providers are not assumed to offer exactly-once semantics: ambiguous failures can consume an additional reserved attempt, within the limits.

A session advisory lock serializes each workflow, and transactional budget locks serialize reservations/settlements. No database transaction is held open during a provider call. pg-boss infrastructure retries remain bounded and cannot reset persisted per-agent attempt/cost limits. Actor revocation prevents new starts; missing configuration fails closed.

## History and phase boundary

`agent_runs`, `agent_evidence`, `agent_invocations`, `agent_outputs` and `agent_budget_months` preserve execution context, immutable evidence and validated outputs. Calls record safe errors, retry classification, HTTP status, request ID, latency, token usage and cost basis. Completed histories are protected by database triggers. Only one matching, non-executable Supervisor draft may be attached to its immutable validated output.

See `runbooks/agents.md` for enabling/configuration/inspection and `PHASE_5_EVALUATION.md` for test evidence and remaining live review. Phase 6 has since been implemented and approved; the agent package itself remains non-executable.

## Initial Supervisor deployment policy

The user approved OpenAI GPT-6.1 Sol with medium reasoning and a $20 monthly application cap on 2026-10-08. `infrastructure/supervisor-policy.json` configures only SUPERVISOR, an initial score eligibility floor of 75/100, a $0.10 analysis ceiling, one provider attempt, a 12,000-byte serialized request cap and 2,048 completion tokens (including reasoning). No autonomous analysis schedule is added. The score floor is a configurable spending gate, not a change to Opportunity Engine scoring or a calibrated guarantee of value.

The database independently blocks specialist reservations in Supervisor-only mode and checks the immutable score before provider spending. A frozen run cannot resume under another deployment execution mode. Prompt version v2 changes the Supervisor's responsibility to direct evidence analysis when specialists are absent; pending v1 runs require a new analysis, while historical results stay readable.

Official [GPT-6.1 Sol documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) lists `gpt-6.1-sol`, medium reasoning, Chat Completions and structured output support. At setup, standard input was $2/M tokens, cache writes $2.50/M and output $10/M. The configured input allowance conservatively uses $2.50/M and output $10/M; cached inputs are not discounted by the local estimator. Model metadata access can be checked without requesting inference. Real recommendations still require healthy opportunity evidence and human review.

OpenAI requests explicitly select `service_tier: default` to bind standard pricing. A response reporting another tier fails closed. This prevents a project-level automatic priority setting from silently changing the request tier; the conservative budget remains an application estimate, not an invoice guarantee.
