# Architecture

## 1. Architectural goals

The architecture separates observation, deterministic analysis, semantic judgment, human decision, execution recording, and outcome measurement. This prevents a model response from becoming a production action and preserves evidence for every decision.

## 2. Logical flow

```text
RocoBroker website (read-only)
        |
        v
Crawler jobs -> raw observations -> deterministic SEO analysis
        |                                |
        +------------> PostgreSQL <------+<-- GSC / GA4 / PageSpeed
                            |
                            v
                  Opportunity Engine
                            |
                            v
                 SEO Supervisor / Agents
                            |
                            v
                 Versioned recommendations
                            |
                            v
                    Human approval queue
                            |
                            v
              Manual execution + Change Ledger
                            |
                            v
                 30 / 60 / 90 measurements
                            |
                            v
                 Evidence for future decisions
```

PostgreSQL is the durable system of record. pg-boss uses the same PostgreSQL service for durable scheduling and job delivery. The dashboard and API never import worker application code; they communicate through shared packages, database contracts, and job commands.

## 3. Runtime components

### `apps/api`

- Fastify HTTP API
- Authentication/authorization boundary for dashboard operations
- Read APIs for health, runs, issues, metrics, opportunities, recommendations, and ledger data
- Command APIs for approved job starts, cancellations, and approval decisions
- No crawl execution and no direct LLM invocation in request handlers

### `apps/worker`

- pg-boss workers and schedules
- Crawl, import, analysis, measurement, reporting, and alert orchestration
- Bounded concurrency, retries, cancellation checks, and heartbeat/status updates
- The only MVP component making outbound calls to the website and Google services

### `apps/dashboard`

- Private Next.js control center
- Server-side access through authenticated API contracts
- No direct database access from browser code
- Approval views must display evidence, risk, and before/after values

## 4. Package responsibilities

| Package              | Responsibility                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `@roco/config`       | Typed environment schema and runtime configuration                                              |
| `@roco/shared`       | IDs, dates, result/error types, pagination, domain constants, shared Zod schemas                |
| `@roco/db`           | Drizzle schema, migrations, database client, transaction helpers, repositories                  |
| `@roco/seo-core`     | URL normalization, robots/indexability rules, issue definitions, scoring primitives             |
| `@roco/crawler`      | Fetch policy, frontier, Cheerio extraction, sitemap/robots parsing, Playwright fallback adapter |
| `@roco/integrations` | GSC, GA4, PageSpeed clients and normalized import contracts                                     |
| `@roco/llm`          | Provider-neutral completion interface, model configuration, usage/cost capture, schema parsing  |
| `@roco/agents`       | Supervisor and specialist agent contracts, prompts, evidence packaging, recommendation schemas  |
| `@roco/testkit`      | Builders, fixtures, fake clocks, mock external clients, database test helpers                   |

Packages must not depend on apps. Domain packages must not depend on dashboard code. `crawler` may use `seo-core`, `shared`, and config contracts, but persistence occurs through worker orchestration and `db` repositories to keep extraction testable.

## 5. Exact target monorepo structure

```text
roco-seo/
  apps/
    api/
      src/{plugins,routes,services}/
      test/
      package.json
      tsconfig.json
    worker/
      src/{jobs,schedules,services}/
      test/
      package.json
      tsconfig.json
    dashboard/
      app/
      components/
      lib/
      public/
      test/
      package.json
      tsconfig.json
  packages/
    config/{src,test}/
    shared/{src,test}/
    db/
      src/{schema,repositories}/
      migrations/
      test/
    seo-core/
      src/{issues,scoring,url}/
      test/
    crawler/
      src/{fetch,frontier,parse,render}/
      test/fixtures/
    integrations/
      src/{gsc,ga4,pagespeed}/
      test/
    llm/
      src/{providers,schemas}/
      test/
    agents/
      src/{supervisor,technical,opportunity,content,internal-linking}/
      test/
    testkit/src/
  infrastructure/
    docker/
    nginx/
    compose.yaml
    compose.production.yaml
  scripts/{db,operations}/
  tests/{integration,e2e,fixtures}/
  docs/{reference,phases,runbooks}/
  .env.example
  .gitignore
  eslint.config.js
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.workspace.ts
  AGENTS.md
```

Only directories needed by the approved phase should be materialized. The tree is a target boundary map, not permission to scaffold later phases early.

## 6. Data and job flow

1. API creates a job command with an idempotency key and actor context.
2. pg-boss durably queues the command.
3. Worker claims it, creates the relevant run record, and updates heartbeat/status.
4. External observations are validated and written in batches inside bounded transactions.
5. Deterministic analysis writes versioned issue/opportunity evidence.
6. Semantic analysis receives only minimized, structured evidence and must return a validated schema.
7. A recommendation is stored separately from approval, execution, and measurement events.
8. Failures retain machine-readable codes, safe messages, attempt count, and retry timing.

## 7. Historical model

Stable identities (`site`, `page`, `query`) are separated from dated observations (`page_snapshot`, `gsc_metric`, `pagespeed_result`). Current state is a query or materialized view over the latest successful observations, never an overwrite of history.

Comparisons include snapshot field/fingerprint changes, issue lifecycles, link-edge appearance/disappearance, metric windows before and after execution, and recommendation versions with their decisions.

## 8. Crawler safety model

- Read-only GET/HEAD requests; no form submission or authenticated production browsing by default
- Per-site rate and concurrency limits, crawl window, URL budget, maximum depth, response-size cap, timeout, and user agent
- Normalize and scope URLs before enqueueing
- Respect robots.txt by default; exceptions require explicit approval
- Cheerio is the normal path; Playwright is allowlisted, budgeted, and observable
- SSRF protections reject non-public/private-network targets unless explicitly configured for an approved environment
- Cancellation, pause, and kill-switch controls are checked throughout a run

## 9. Observability

Logs/events include relevant `siteId`, `jobId`, `runId`, `correlationId`, component, attempt, and duration. Metrics cover queue age, job duration/failures, crawl throughput/status mix, external API latency/quota errors, analysis counts, agent validation failures, approval aging, and measurement completion.

## 10. Deployment shape

The initial VPS deployment uses Nginx in front of the dashboard/API, separate API and worker containers, and PostgreSQL with durable storage and backups. The worker has outbound access; PostgreSQL is not exposed publicly. A future production executor, if approved in Phase 8, is a separate service and credential boundary rather than an added method inside the analysis worker.

## 11. Phase 1 implementation

The implemented foundation materializes only the boundaries needed now:

- `apps/api`: Fastify liveness and dependency-aware readiness, structured request logs, safe errors, and graceful lifecycle
- `apps/worker`: pg-boss bootstrap, queue registration, scheduled foundation health job, application-level idempotency, and graceful lifecycle
- `apps/dashboard`: static Next.js internal placeholder bound to localhost by development/start scripts
- `packages/config`: side-effect-controlled `.env` loading and Zod schemas
- `packages/db`: Drizzle schema/migration, PostgreSQL pool/probes, and foundation job repository
- `packages/shared`: Pino logger and correlation identifiers
- `packages/testkit`: shared test environment defaults

PostgreSQL is the only Docker Compose service in development. Applications run locally for faster Windows/macOS development and connect to it through `DATABASE_URL`. The checked-in Nginx configuration is intentionally inactive until authentication and production deployment details are approved.

API readiness requires both a successful PostgreSQL probe and the pg-boss schema. Therefore liveness can remain healthy while readiness correctly reports unavailable before the worker initializes queue infrastructure.

## 12. Phase 2 implementation

Phase 2 materializes `@roco/seo-core` and `@roco/crawler` without changing application boundaries:

- API handlers validate and enqueue bounded `crawl.site` commands; they never crawl in the request process.
- The worker resolves the persisted site scope, runs the crawler, checks cancellation between bounded batches, and persists one logical run transactionally.
- `@roco/crawler` owns the HTTP frontier, public-network and host enforcement, throttling, retries, redirect tracing, robots/sitemap parsing, Cheerio extraction, and crawl summary.
- `@roco/seo-core` owns versioned URL normalization, indexability, graph metrics, snapshot comparison, and deterministic issue output.
- `@roco/db` owns stable page identity, immutable cross-run observations, same-run idempotency, link and issue provenance, and status/summary reads.

The frontier prioritizes link-discovered URLs by breadth/depth before sitemap-only candidates. Sitemap membership is still retained so unlinked sitemap pages can be identified as orphans. External links are observed but never enqueued.

HTTP/Cheerio is the only enabled fetch path. The Playwright decision function requires an explicit allowlist, empty extraction evidence, and a separate render budget; no production URL is allowlisted in Phase 2, so browser rendering is disabled rather than speculative.

## 13. Phase 3 implementation

Phase 3 materializes `@roco/integrations` and retains the existing process boundaries:

- The API validates manual sync/backfill commands, creates an idempotent `integration_sync_runs` record, and sends a pg-boss command. It does not call Google directly.
- The worker is the only Google API caller. It exchanges a least-privilege service-account JWT for a short-lived access token in memory, applies bounded timeouts/rates/retries, validates responses with Zod, maps URLs conservatively, and persists batches through `@roco/db`.
- GSC uses three deliberately separate dimension sets (`PAGE`, `QUERY`, `PAGE_QUERY`); they are never implicitly summed together.
- GA4 stores only `Organic Search` landing-page sessions, users, engaged sessions, engagement rate, and configured key-event totals under dimension contract `ga4-organic-landing-v1`.
- PageSpeed stores mobile/desktop point-in-time observations. Manual requests are capped at 20 URLs; the default schedule samples only the canonical origin weekly to control quota and variability.
- The pg-boss dispatcher creates deterministic daily GSC/GA4 and weekly PageSpeed commands when schedules are explicitly enabled. Re-delivery resolves the same logical sync run and metric natural keys.

Crawler, GSC, GA4, and PageSpeed observations share `url-v1` normalization. A Google URL receives a `page_id` only when its normalized hash matches an existing crawler page. Valid in-scope but not-yet-crawled URLs remain stored with `page_id = null`; invalid or out-of-scope URL counts remain visible in the sync summary and are never silently merged.

## 14. Phase 4 implementation

`@roco/opportunities` owns pure, schema-validated six-type detection, evidence gates, scoring and lifecycle rules. It depends only on the existing Zod dependency and Node.js primitives. The API validates authenticated commands and enqueues `opportunities.detect`; workers load data, freeze a repeatable-read source snapshot and persist results atomically through `@roco/db`. No app imports another app, and no new vendor caller or dashboard surface is introduced.

`scoring_configs` stores immutable resolved configurations by content hash. `opportunity_runs` stores immutable command/input provenance, status, attempts, windows, timings, safe failures and counts. `opportunities` is a mutable current projection over immutable `opportunity_scores` observations and `opportunity_events`. Human status changes append attributable `audit_events`. Per-site database transaction locks serialize current projections and operator decisions; old runs retain historical evidence without regressing newer state.

The source loader keeps PAGE and PAGE_QUERY datasets independent and requires successful/final source coverage. GA4/PageSpeed provide optional context, not inferred commercial value. Insufficient imports cannot resolve opportunities. The operational validator uses the same source loader in READ ONLY transactions without creating any database records.

A separate optional bearer operator credential protects every Phase 4 endpoint, and status mutations require its configured active actor. This does not authorize public exposure of earlier unauthenticated endpoints or settle the dashboard SSO/session decision. Rules/calibration/operations are documented in `OPPORTUNITY_ENGINE.md`, `PHASE_4_CALIBRATION.md` and `runbooks/opportunities.md`. Phase 5 is implemented separately below.

## 15. Phase 5 implementation

`@roco/llm` separates provider transport from `@roco/agents` domain logic. The installed real adapter calls OpenAI with strict structured output, no tools, bounded timeout/response size and no automatic model fallback. Model routes/prices are operator configured; live analysis is disabled by default. Tests inject providers without network/paid calls.

The API authenticates a separate analysis operator credential, binds triggers/retries to a configured active actor, creates a source-score-bound run and queues `agents.analyze-opportunity`. The worker takes a per-run execution lock, freezes the selected evidence/policy, executes an allowlisted specialist sequence and then runs Supervisor synthesis. Each provider attempt is journalled/reserved before egress and settled with usage/cost/status afterward. No database transaction remains open during the provider request. Validated partial specialist findings remain historical if later stages fail; they never become an executable action.

`agent_runs`, `agent_evidence`, `agent_invocations`, `agent_outputs` and a deployment-wide monthly budget projection preserve traceability. Drafts are an attachment to a validated Supervisor output, explicitly DRAFT/non-executable. Full recommendation versions, approvals, execution ledger, measurement and dashboard work remain outside Phase 5.

Persistence revalidates output, protects immutable evidence/call identity/terminal results and serializes shared cost reservations. Infrastructure retry cannot erase per-agent attempts or replay non-retryable errors. Pending ambiguous calls retain conservative budget bookings; successful calls are reused. Definitions and operating details are in `AGENT_LAYER.md` and `runbooks/agents.md`.

## 16. Phase 6 implementation

`@roco/workflow` materializes reviewed agent actions into typed, immutable versions, enforces role/risk/lifecycle rules and classifies metric comparisons deterministically. API credentials map to active named actors/explicit roles; there is no free-form reviewer input. Human review, human implementation declaration and measurement remain independent records. No dashboard or website writer is introduced.

The manual implementation transaction verifies the current approved version and exact actual-before/after values, then appends the ledger, initial baseline and all three measurement plans atomically. Revisions invalidate prior approval; metadata corrections and reverts append events. Agent/metric history is referenced rather than copied wholesale.

Measurement reads successful historical imports/crawl observations through shared persistence. Frozen baseline/result snapshots preserve capture-time aggregates and provenance. Operators can explicitly recapture late baseline data as another immutable version. A pg-boss dispatcher recovers durable due plans/queued commands and delivers generic horizon jobs; data lag, missing samples and overlapping changes cannot silently become causal performance claims.

Database guards reinforce current-version human approval, exact ledger values and immutable business/evidence histories. Mutable recommendation/plan/run fields are projections or operational status. See `WORKFLOW_MEASUREMENT.md`, `runbooks/workflow-measurement.md` and `PHASE_6_VALIDATION.md`. Phase 7 is implemented below.

## 17. Phase 7 implementation

The dashboard is a private Next.js application with one control-center navigation, bounded lists and an accessible native detail dialog. Server-only routes mediate API access; React never imports database runtime code or calculates opportunities, review transitions or measurement classifications. Browser-safe contracts are exported separately from server packages. Existing CSS conventions are extended with compact light panels, logical properties, responsive layouts and Persian number/date formatting under RTL.

An opaque expiring session keeps the named API credential in bounded process memory. The BFF revalidates active identity/roles through Fastify on every request, checks exact origin/per-session CSRF on mutations and allowlists fixed private API paths. No arbitrary upstream URL, raw prompt or browser bearer storage is introduced. One Next process is required; restart revokes sessions.

Fastify's control read service uses `@roco/db` projections over existing observations, exact site scoping, server pagination/filter/date bounds and five-second read statement timeouts. Current score components bind to the opportunity's projected source run. Google aggregation stays server-side and dimension specific. Missing imports remain null; issue absence is labelled NOT_OBSERVED rather than confirmed repair. Existing Phase 6 services remain authoritative for mutations; the server derives available review actions using their policy functions.

Phase 1–3 domain routes now require named active human credentials/roles when the control service is enabled. Phase 4/5 retain their existing separately authenticated private operator contracts; Phase 6 retains named roles. Health/readiness are non-sensitive probes. The Nginx baseline routes browser `/api` calls to Next, and Fastify remains private. No remote rollout or new write executor is enabled.

See `runbooks/dashboard.md` for operating instructions and `PHASE_7_VALIDATION.md` for browser/SQL/regression evidence and the explicit existing-alert/report boundary.

## Phase 7.5 production runtime

`infrastructure/compose.production.yaml` deploys PostgreSQL, a one-shot migrator, API, worker, dashboard and Nginx. The base configuration publishes a loopback Nginx port. The user-approved HTTPS overlay publishes 80/443 for `scc.rocobroker.com`; it proxies only the dashboard BFF, never direct Fastify routes. The operational wrapper selects this overlay using `config/https.enabled`. Certificate live/archive directories and an ACME webroot are mounted read-only into Nginx; host Certbot manages renewal and validates/reloads the proxy. Operations use a profile-scoped CLI with mounted credentials. File secret loading is shared in config, including migrations. The worker reconciles persisted schedules and writes a database/queue heartbeat after handler registration. PostgreSQL stores delayed work and measurement plans across process restarts. See `OPERATIONS.md` for startup order, health limitations, encrypted recovery and provider setup.

## Integrations operational status

The worker alone checks provider access and publishes safe PostgreSQL telemetry. Authenticated control endpoints project runtime status, agent activation, shared budget and existing Google sync history. A dedicated pg-boss metadata queue handles startup/quarter-hour/manual checks; it never creates AI analysis. See `INTEGRATIONS_STATUS.md`.
