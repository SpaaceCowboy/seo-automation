# Architecture Decision Log

`Accepted` decisions govern implementation. `Proposed` decisions require validation or human confirmation before becoming binding.

## ADR-001: TypeScript pnpm monorepo

- Status: Accepted
- Decision: Use TypeScript/Node.js in a pnpm workspace with deployable apps and reusable packages.
- Rationale: Shared schemas and types reduce contract drift while keeping deployment boundaries explicit.
- Alternatives: Multiple repositories; a single application package.
- Tradeoffs: Easier reuse and coordinated changes, at the cost of workspace tooling discipline.

## ADR-002: PostgreSQL as system of record and job backend

- Status: Accepted
- Decision: Use PostgreSQL with Drizzle ORM for domain data and pg-boss for durable jobs/schedules.
- Rationale: Fits the existing VPS and avoids operating Redis or a separate queue for the MVP.
- Alternatives: Redis/BullMQ, managed queues, cron-only scheduling.
- Tradeoffs: Lower operational complexity; queue load and domain workload must be monitored on the same database.

## ADR-003: Historical append-oriented observations

- Status: Accepted
- Decision: Keep stable identities separate from immutable or append-oriented run observations. Current state is derived.
- Rationale: The proposal requires comparison between dates and measurable outcomes.
- Alternatives: Overwrite current page rows; external event store.
- Tradeoffs: More storage and careful indexes, in exchange for auditability and reproducibility.

## ADR-004: Deterministic analysis before LLM analysis

- Status: Accepted
- Decision: HTTP, redirect, canonical, robots, sitemap, metadata, link graph, crawl depth, orphan, and technical validation logic is normal tested code.
- Rationale: These checks are reproducible and cheaper without model calls.
- Alternatives: General agent-driven crawling/analysis.
- Tradeoffs: More explicit rule maintenance; much higher predictability, explainability, and cost control.

## ADR-005: Provider-neutral LLM port with schema validation

- Status: Accepted
- Decision: Agents use an internal provider interface and versioned Zod schemas. Invalid output fails closed.
- Rationale: Avoid provider lock-in and prevent free-form output from driving workflows.
- Alternatives: Direct provider SDK calls throughout agents; unstructured text parsing.
- Tradeoffs: Adapter and schema maintenance, offset by portability and safety.

## ADR-006: No production writes in the MVP

- Status: Accepted
- Decision: The MVP produces recommendations, approvals, and execution records but has no production website write credential or code path.
- Rationale: Human control is a core product requirement and reduces early operational risk.
- Alternatives: Automatic metadata/link updates from the start.
- Tradeoffs: Manual execution effort; safer validation of recommendation quality.

## ADR-007: Cheerio-first crawl with controlled Playwright fallback

- Status: Accepted
- Decision: Use standard HTTP plus Cheerio by default. Invoke Playwright only for allowlisted cases where required content cannot be observed otherwise.
- Rationale: Browser rendering is slower and more resource-intensive.
- Alternatives: Browser-only crawling; HTTP-only crawling.
- Tradeoffs: Two fetch paths require parity tests, but capacity remains manageable.

## ADR-008: Separate recommendation, approval, execution, and measurement records

- Status: Accepted
- Decision: Model these as linked, separately attributable records rather than one mutable workflow row.
- Rationale: Approval does not prove execution, and execution does not prove outcome.
- Alternatives: A single recommendation table with many mutable status/date fields.
- Tradeoffs: More joins; clearer audit and version semantics.

## ADR-009: Versioned configurable opportunity scoring

- Status: Accepted
- Decision: Store scoring weights/thresholds as immutable published configurations and retain component scores with each result.
- Rationale: The proposal requires tunable Search Demand, Impact, Confidence, Effort, and Business Value.
- Alternatives: Hardcoded formula; LLM-only prioritization.
- Tradeoffs: Configuration governance is needed; results remain reproducible.

## ADR-010: Single private control-center dashboard

- Status: Accepted
- Decision: Build one focused internal Next.js dashboard backed by a Fastify API.
- Rationale: Matches the proposal and avoids a broad admin-platform scope.
- Alternatives: Multiple dashboards; direct database BI only.
- Tradeoffs: Custom UI work; clearer workflow and access control.

## ADR-011: Raw HTML retention

- Status: Proposed
- Decision: Default to extracted typed fields and hashes. If raw compressed HTML is needed for diagnosis, keep it short-lived under an explicit retention policy.
- Rationale: Reduces storage, privacy, and sensitive-content risk while preserving change detection.
- Alternatives: Keep all HTML forever; keep none.
- Tradeoffs: Short retention may limit later parser replays. Human decision required before Phase 2.

## ADR-012: Dashboard authentication

- Status: Accepted — application sessions selected by the user for Phase 7 on 2026-10-07
- Decision: Prefer an existing reverse-proxy/identity-aware SSO mechanism if the organization has one; otherwise implement application authentication with secure sessions and roles.
- Rationale: Reuse reduces identity complexity, but no existing provider is documented.
- Alternatives: VPN-only access, basic auth, bespoke credentials.
- Tradeoffs: Final choice affects deployment and audit detail. Human decision required in Phase 1.

## ADR-013: Partitioning deferred until measured

- Status: Accepted
- Decision: Start with ordinary indexed tables and measure volume/query behavior before partitioning high-volume history tables.
- Rationale: Premature partitioning complicates migrations and uniqueness.
- Alternatives: Partition all observations from day one.
- Tradeoffs: A later online migration may be required; initial development stays simpler.

## ADR-014: Future executor is a separate trust boundary

- Status: Accepted
- Decision: If Phase 8 is approved, deploy a separate executor with its own allowlisted commands and credentials.
- Rationale: Production write access must remain isolated from analysis and LLM components.
- Alternatives: Add write methods to the main worker.
- Tradeoffs: Additional deployment complexity; materially smaller blast radius.

## ADR-015: Node.js 22.12 minimum

- Status: Accepted
- Decision: Require Node.js 22.12 or newer and validate with Node.js 24 in Phase 1.
- Rationale: pg-boss 12 requires Node.js 22.12+, while Fastify 5 and Next.js 16 are compatible with this baseline.
- Alternatives: Use an older pg-boss release or replace pg-boss.
- Tradeoffs: Older VPS Node.js installations must be upgraded; the project remains on maintained runtime lines and keeps the approved queue.

## ADR-016: Local applications with Dockerized PostgreSQL during development

- Status: Accepted
- Decision: Docker Compose runs PostgreSQL only; API, worker, and dashboard run as local Node.js processes during development.
- Rationale: This keeps iteration fast, avoids unnecessary images in Phase 1, and follows the approved simple-infrastructure boundary.
- Alternatives: Containerize every application immediately; install PostgreSQL directly.
- Tradeoffs: Production application images remain future deployment work, while dependency behavior is still reproducible through the pinned workspace and PostgreSQL image.

## ADR-017: Localhost-only dashboard pending authentication decision

- Status: Accepted for Phase 1
- Decision: Bind dashboard development/start commands to `127.0.0.1`; keep the Nginx baseline inactive until authentication is selected.
- Rationale: ADR-012 remains unresolved and the private dashboard must not be exposed without authentication.
- Alternatives: Implement speculative authentication; expose through basic auth.
- Tradeoffs: Remote review requires a secure tunnel or later authentication work, but Phase 1 does not create an unsafe public surface.

## ADR-018: Do not retain raw HTML in Phase 2

- Status: Accepted
- Decision: Store typed extractions, ordered observations, content/HTML fingerprints, and safe failures; do not store raw page HTML.
- Rationale: This follows the recommended privacy/storage default while preserving change detection and historical SEO evidence.
- Alternatives: Permanent raw HTML; short-lived compressed HTML.
- Tradeoffs: Historical parser replay is unavailable, but sensitive content and storage exposure are substantially reduced.

## ADR-019: Conservative public-network crawler ceilings

- Status: Accepted for Phase 2
- Decision: API requests may lower but never raise environment ceilings. Default to 30 pages, concurrency 1, one request per second, six levels, 15-second timeout, 2 MB bodies, five redirects, two retries, robots compliance, approved hosts, and public IPs only.
- Rationale: RocoBroker must not be overloaded and the crawler must not become an unrestricted SSRF client.
- Alternatives: Per-request unrestricted settings; private-network crawling; high-throughput defaults.
- Tradeoffs: Crawls take longer and approved staging/private fixtures require explicit test-only adapters, while production load and network risk remain bounded.

## ADR-020: Derived issue lifecycle over append-only occurrences

- Status: Accepted
- Decision: Persist a stable issue definition and fingerprinted occurrence per analysis run. Derive open, resolved, and reopened intervals across runs instead of updating source occurrences.
- Rationale: Historical facts remain reproducible and retry idempotency is enforced within one logical run.
- Alternatives: One mutable issue row; unrelated issue rows without stable identity.
- Tradeoffs: Lifecycle reads require cross-run queries or a later rebuildable projection.

## ADR-021: Service-account JWT authentication for Phase 3

- Status: Accepted
- Decision: Use an externally stored service-account JSON file, exchange a signed JWT for short-lived access tokens in the worker, and request only Search Console and Analytics read-only scopes.
- Rationale: It is unattended, least-privilege, compatible with the worker schedule, and keeps tokens out of source control and PostgreSQL.
- Alternatives: Persist OAuth refresh tokens; manually provide access tokens; use broad Google SDK credentials in every process.
- Tradeoffs: The service-account email must be explicitly granted property access and organizations with mandatory user OAuth will need a later approved adapter.

## ADR-022: Separate GSC dimension datasets

- Status: Accepted
- Decision: Store page, query, and page/query daily observations in separate tables with country, device, search type, and data state in each natural key.
- Rationale: GSC aggregation and privacy behavior varies by dimension set; separation prevents accidental double-counting.
- Alternatives: One sparse metrics table; retain only page/query rows.
- Tradeoffs: More tables and sync runs, but safer reconciliation and explicit query semantics.

## ADR-023: Conservative Google URL mapping

- Status: Accepted
- Decision: Reuse `url-v1`, require approved site scope, and attach `page_id` only on exact normalized-hash match. Preserve normalized Google-only rows with nullable `page_id`; count unsafe/unmappable URLs.
- Rationale: Mapping must not silently merge distinct URLs or fabricate crawler observations.
- Alternatives: Create page identities from every provider URL; fuzzy path matching; discard unmatched rows.
- Tradeoffs: Some useful provider rows remain unmatched until a crawl observes them, but the evidence remains visible and reversible.

## ADR-024: Targeted PageSpeed collection

- Status: Accepted
- Decision: Cap manual jobs at 20 approved URLs, sample the canonical origin weekly by default, retain mobile and desktop separately, and preserve missing field data as null.
- Rationale: PageSpeed is variable and quota-sensitive; crawling every URL on every run is costly and misleading.
- Alternatives: Run for every crawled page; overwrite a single latest score.
- Tradeoffs: Coverage is intentionally selective and must be expanded through explicit targets when operational value justifies the quota.

## ADR-025: Pure deterministic opportunity analysis with frozen evidence

- Status: Accepted — Phase 4 approved by the user on 2026-10-06
- Decision: Add `@roco/opportunities` with no network/persistence dependencies; store exact source inputs and resolved config per run, immutable scored observations and rebuildable current lifecycle projections.
- Rationale: Daily Google upserts and repeated imports must not make old priority decisions unexplainable. Schema gates and idempotent delivery are testable without Google access.
- Alternatives: Recompute evidence from latest daily tables; put detectors inside API handlers.
- Tradeoffs: More storage and bounded source loads; reproducible decisions and safe retries. Old backfills cannot regress current projections.

## ADR-026: Provisional configurable scoring without inferred business value

- Status: Accepted for Phase 4 implementation, pending calibration review
- Decision: Normalize configurable demand/impact/confidence/ease-of-effort/business-value weights to 0–100. Default weights are 25/30/20/15/10. Unknown commercial value is null and omitted from the active denominator; explicit longest-path rules are the only source of value.
- Rationale: The proposal requires tunable priorities and the project has no approved automatic revenue/value mapping. Decay uses baseline demand so loss of current visibility does not hide an important page.
- Alternatives: Assign every page an invented default business value; permanently hardcode scoring; infer value from conversions.
- Tradeoffs: Rankings require operator calibration. Confidence is evidence strength, not an uplift probability; query groups remain commercially unassigned.

## ADR-027: Evidence-controlled lifecycle and candidate boundaries

- Status: Accepted — Phase 4 approved by the user on 2026-10-06
- Decision: Require full successful window coverage plus observed-day/demand gates; resolve only fingerprints adequately evaluated as no longer matching. Missing evidence expires to STALE. Preserve ACKNOWLEDGED and suppress DISMISSED until explicit reopen. Cannibalization/content gaps/link relevance remain candidates.
- Rationale: Import failures, anonymization and bounded crawls must not silently imply recovery or confirmed semantic defects.
- Alternatives: Close all absent findings; treat coarse query/path similarity as proven intent.
- Tradeoffs: Some vanished pages remain insufficient/stale and require review. Comparable decay dates are stricter than merely equal-length periods.

## ADR-028: Authenticated Phase 4 operations and read-only calibration

- Status: Accepted for Phase 4 implementation
- Decision: Protect all new opportunity endpoints with an optional high-entropy bearer credential; disabled when absent. Bind lifecycle decisions to a configured active actor and audit them. Existing-data validation uses READ ONLY transactions and writes only an ignored private report file.
- Rationale: Add the minimal internal operator surface without speculative dashboard auth or writes during calibration.
- Alternatives: Leave new mutation endpoints unauthenticated; implement Phase 7 sessions/roles early; persist calibration into an unknown deployment database.
- Tradeoffs: The deployment operator credential is coarse-grained and must not be shared. Earlier routes remain localhost-only; broader authentication remains required before public exposure.

## ADR-029: Provider ports and bounded evidence-only Supervisor

- Status: Accepted — Phase 5 approved by the user on 2026-10-07
- Decision: Isolate provider transport in `@roco/llm`; keep versioned contracts, prompts, grounding and allowlisted planning in `@roco/agents`. Install one real OpenAI adapter and inject fixture/alternative providers for tests.
- Rationale: Different task classes can use different configured models without provider coupling in SEO business logic. No agent tools or unrestricted application access are needed.
- Alternatives: Provider SDK calls inside each specialist; autonomous model-planned tooling.
- Tradeoffs: Explicit adapter/route wiring and conservative source limits; predictable boundaries and testability. Chat Completions strict JSON output is used for the first adapter, with local schema/policy validation still authoritative.

## ADR-030: Typed factual grounding and conservative confidence/risk

- Status: Accepted for Phase 5 implementation, pending live evaluation
- Decision: Facts are copied by ID/value; qualitative inferences/actions cite supplied evidence and targets. Numeric prose is restricted. Confidence is bounded by deterministic evidence/quality and specialist ceilings; action risk floors are enforced independently of model claims.
- Rationale: LLM text must not invent SEO measurements or become an execution decision.
- Alternatives: Unstructured recommendation parsing; arbitrary model confidence/risk; automatic semantic acceptance.
- Tradeoffs: Useful prose can be rejected and repaired; semantic quality still needs human evaluation. High-risk suggestions remain non-executable drafts.

## ADR-031: Journal-before-call and integer shared budgets

- Status: Accepted for Phase 5 implementation
- Decision: Reserve integer nanodollar cost before each call, settle from known usage estimates, preserve conservative unknown-call reservations and persist retry classification. Freeze evidence/routes/prices per workflow; reuse successful steps and serialize workflows/monthly bookings.
- Rationale: External model calls may consume money despite timeouts or process interruption. Queue retry must not reset attempts or bypass caps.
- Alternatives: In-memory-only token/cost counters; assume exactly-once paid provider calls; treat missing usage as free.
- Tradeoffs: Conservative bookings may overstate billed costs. Current-month caps can tighten but increases wait for a new month. Vendor invoice accuracy remains outside the software estimate.

## ADR-032: Phase 5 drafts stay in validated agent outputs

- Status: Accepted for Phase 5 implementation
- Decision: Store final DRAFT/non-executable payload as a matching attachment to a validated Supervisor output. Do not create recommendation approval, Change Ledger or measurement schemas early.
- Rationale: The user explicitly approved only the analysis/recommendation side of the agent layer.
- Alternatives: Scaffold Phase 6 workflow tables and transitions now.
- Tradeoffs: Phase 6 will need a deliberate mapping from reviewed agent output to immutable recommendation versions.

## ADR-033: One concrete action per immutable human-reviewed recommendation

- Status: Accepted for Phase 6 implementation, pending review
- Decision: Materialize one selected validated draft action with fixed page/type/mode and explicit before/after/rule. Store immutable proposal versions and require fresh review after revision.
- Rationale: Approval must bind an exact, inspectable change; agent prose alone cannot authorize execution.
- Alternatives: Approve an entire opaque draft; mutate approved proposal text in place.
- Tradeoffs: More explicit materialization/review effort; clearer risk/value/measurement provenance.

## ADR-034: Named actor bearer roles within the existing private boundary

- Status: Accepted for Phase 6 implementation, pending access review
- Decision: Extend existing bearer authentication with environment-managed actor/role entries. Require active humans for business mutations, special review for high risk and an active service identity for scheduled measurement.
- Rationale: Existing session/SSO selection remains unresolved; human authority and attribution must nevertheless be explicit now.
- Alternatives: Arbitrary request reviewer strings; implicit admin authority; implement a full Phase 7 identity/dashboard stack early.
- Tradeoffs: Secrets/roles are deployment-managed, and broader identity/site-specific governance remains future work. No invented dual-person approval rule is imposed.

## ADR-035: Manual ledger with atomic baseline and durable plans

- Status: Accepted for Phase 6 implementation
- Decision: Record human-attested implementation with exact approved values, immutable ledger/events, frozen initial baseline and durable 30/60/90 plans in one transaction. Reverts and metadata corrections append history only.
- Rationale: Approval is not execution, and recording must not lose measurement intent across restart/delivery failure.
- Alternatives: Website write adapters; mutable ledger fields; volatile delayed jobs without durable domain plans.
- Tradeoffs: Physical implementation cannot be verified automatically; human evidence/reference remains necessary. No production credentials or automatic rollback exist.

## ADR-036: Conservative deterministic measurement with explicit baseline versions

- Status: Accepted for Phase 6 implementation, pending calibration
- Decision: Use configurable equal-length post/pre windows, separate datasets, capture-time metrics/provenance, sufficiency/overlap gates and immutable attempts. Explicit late baseline recapture creates another version. URL identity changes require separate reconciliation; missing data remains insufficient.
- Rationale: Data delays, sparse samples, concurrent changes and mutable provider imports must not create fabricated or causal outcomes.
- Alternatives: Sum incompatible GSC dimensions; overwrite old metrics/results; classify every fluctuation or absent row.
- Tradeoffs: Conservative rules may yield many insufficient results and need human tuning. Defaults are provisional, not traffic guarantees.

## ADR-037: Named credential sign-in with bounded opaque application sessions

- Status: Accepted — user selected on 2026-10-07
- Decision: Reuse the Phase 6 actor credential registry through Fastify, hold credentials only in a bounded single-process Next session store and give the browser an expiring opaque cookie. Revalidate active identity/roles for each operation and audit successful sign-in/sign-out.
- Rationale: No existing SSO provider is documented; high-entropy named credentials and authoritative Phase 6 permissions already exist. Revocable process sessions avoid browser bearer storage and new identity dependencies.
- Alternatives: External SSO/identity proxy; an additional identity library/password store; stateless cookies containing a bearer secret.
- Tradeoffs: One Next process, restart signs out users, global bounded sign-in throttle. Multi-replica/durable sessions/MFA require reviewed hardening. API remains private; all named roles currently read all sites.

## ADR-038: API read projections and one operational interface

- Status: Accepted for Phase 7 implementation, pending review
- Decision: Extend `@roco/db`/Fastify with bounded site-scoped read projections and use a Next BFF plus focused sections/detail panels. Reuse existing review/measurement services and server-derived capabilities. Keep browser-safe schemas as separate exports.
- Rationale: Avoid browser database access and duplicated opportunity, transition or measurement engines while exposing historical evidence efficiently.
- Alternatives: Query SQL in React; generic unbounded API proxy; duplicate domain calculations client-side.
- Tradeoffs: Maintained read DTO/SQL contracts, capped detail histories, exact URL/page filters and bounded date windows. No new migrations or external runtime dependencies. Playwright is a pinned development-only dependency because actual browser auth/dialog/forms cannot be validated by the existing Node test runner alone.

## ADR-039: Existing failures and findings, without speculative alert rules

- Status: Accepted for Phase 7 implementation — explicit current user scope
- Decision: Show existing FAILED/PARTIAL run history and technical findings, source timestamps and a clearly described seven-day display age threshold. Use date-window performance inspection. Defer new regression/spike/commercial-page alert rules and report distribution.
- Rationale: The current request prohibits invented SEO engines or alert rules; those domains were not implemented in Phases 1–6.
- Alternatives: Implement the older phase document's prospective alert/report features now; imply failures are an independent alert lifecycle.
- Tradeoffs: Broader FR-021/critical-alert/report criteria remain explicit scope exceptions. No outbound channels, recipients, severity escalation or acknowledgement lifecycle are invented.

## ADR-040: Private Compose deployment and mounted process-scoped secrets

- Status: Accepted for authorized Phase 7.5 deployment
- Decision: Deploy the existing stack on the resized VPS under `/opt/roco-seo`, publish only loopback Nginx, and use SSH forwarding until an actual HTTPS hostname is provided. Pin container manifests; use non-root read-only Node containers, scoped file mounts, a non-superuser database login and encrypted backups.
- Rationale: Preserve a private analysis boundary without inventing a public hostname or requiring SSO.
- Tradeoffs: One dashboard process; restart invalidates sessions. Local encrypted backups require an offline recovery key and separately configured offsite storage. No website executor exists.

## ADR-041: Fail-closed import bounds and restart reconciliation

- Status: Implemented for Phase 7.5
- Decision: Bound provider response bytes, requests and imported rows; reject OAuth endpoint overrides; pace calls and use bounded retries/deadlines. Dispatch delayed finalized windows, use actual week keys, reconcile disabled persisted schedules at boot, preserve delayed jobs and retry failed crawl domain runs. Suppress raw error payloads in centralized logging.
- Tradeoffs: Large imports require smaller date windows. Sanitized errors expose safe classifications rather than raw stacks; diagnose using correlation IDs and controlled reproduction. Heartbeat health is connectivity/freshness evidence, not a guarantee of successful jobs.

## ADR-042: User-approved HTTPS hostname on the existing proxy

- Status: Accepted and deployed — user requested `scc.rocobroker.com` on 2026-10-08
- Decision: Keep the existing Nginx container and add an optional HTTPS Compose overlay, exact dashboard origin, HTTP redirect, TLS 1.2/1.3, hostname validation and hostname-scoped HSTS. Mount only this hostname's certificate directories. Use host Certbot webroot renewal and a validated reload hook. Include certificate state in encrypted configuration backups.
- Rationale: Provide normal browser access at the supplied DNS hostname without exposing Fastify/PostgreSQL, introducing a second reverse proxy, or changing application authentication.
- Tradeoffs: Ports 80/443 are public for the authenticated dashboard and ACME challenges; one dashboard process remains. Renewal requires port 80 and the timer to remain healthy. The ACME account has no email contact; timer/journal/expiry monitoring is required until an administrator contact is supplied. No production website or crawling scope changes occur.

## ADR-043: Supervisor-only initial AI activation

- Status: Accepted — user explicitly approved on 2026-10-08
- Decision: Follow proposal section 22: activate only the SEO Supervisor, using GPT-6.1 Sol with medium reasoning and a $20 monthly deployment limit. Add a validated execution mode, optional inactive routes, independent database plan enforcement, immutable score eligibility and compact request/completion caps. Keep the user-preferred GPT-6 Luna specialist routes inactive until later approval.
- Rationale: The original proposal's initial MVP calls for Supervisor-first validation; the full five-agent implementation does not require simultaneous activation.
- Tradeoffs: Preserve legacy specialist policies through an explicit default. New Supervisor prompts are version v2; pending old prompt versions or changed frozen execution modes need a new run. Score 75 is an initial configurable budget gate, not detector retuning. Monthly caps cover this application's conservative usage accounting, not unrelated key/account spending. Live recommendation validation still needs actual Google/opportunity evidence.

## ADR-044: Worker-owned availability checks and durable operational status

- Status: Accepted — explicit user-approved implementation plan
- Decision: Add a dedicated Integrations view and authenticated control endpoints. The worker publishes safe boot-scoped status and performs fixed-origin model metadata checks at startup, every 15 minutes and manually. Preserve check history independently of AI runs and derive budgets from the existing ledger.
- Rationale: Agent availability must be visible before analysis, without exposing provider credentials to API/dashboard or fabricating recommendation evidence.
- Tradeoffs: A successful metadata check proves only key/model access. One worker is supported; stale telemetry is labelled rather than inferred as provider failure. An additive migration stores operational status/check history. No new Google probes or paid inference are introduced.
