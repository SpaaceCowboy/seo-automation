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
