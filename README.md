# Roco SEO

Roco SEO is an internal SEO intelligence and automation system that operates alongside the existing RocoBroker website. Phase 6 adds immutable recommendation versions, named human review, a manual Change Ledger, frozen baselines and durable 30/60/90-day measurement on top of the approved Phase 1–5 foundation.

Approval remains separate from declared human implementation. No production website write, automatic publishing, automatic rollback or full dashboard capability exists.

## Prerequisites

- Node.js 22.12 or newer (Node.js 24 recommended)
- pnpm 10 or newer (the repository pins pnpm 11.25.0)
- Docker Desktop with Docker Compose v2

## Install

```powershell
pnpm install --frozen-lockfile
```

Dependency build scripts are allowlisted in `pnpm-workspace.yaml`; only packages explicitly approved there may run install-time scripts.

## Configure the environment

```powershell
Copy-Item .env.example .env
```

The checked-in example contains local-development defaults only. Change database credentials for shared or deployed environments. Never commit `.env` or production secrets.

Required configuration:

- `DATABASE_URL`: PostgreSQL connection used by Drizzle, the API, worker, and pg-boss
- `NODE_ENV`: `development`, `test`, or `production`
- `LOG_LEVEL`: Pino log level

API and worker-specific settings are documented in `.env.example`. Configuration is validated with Zod and fails at startup when invalid.

## Start PostgreSQL

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
docker compose --env-file .env -f infrastructure/compose.yaml ps
```

The development port is bound to `127.0.0.1`. Docker initializes both `roco_seo` and `roco_seo_test` databases on a new volume.

## Apply database migrations

```powershell
pnpm db:migrate
```

After an intentional schema change:

```powershell
pnpm db:generate
pnpm db:migrate
```

Review generated SQL before applying it. Migration conventions are described in [docs/DATABASE.md](docs/DATABASE.md).

## Run development services

Use separate terminals:

```powershell
pnpm dev:api
pnpm dev:worker
pnpm dev:dashboard
```

Or start them together:

```powershell
pnpm dev
```

Local endpoints:

- Dashboard: `http://127.0.0.1:3000`
- API liveness: `http://127.0.0.1:4000/health`
- API readiness: `http://127.0.0.1:4000/ready`

The dashboard is deliberately localhost-only until an authentication approach is approved and implemented. Do not expose it publicly.

## Register a crawlable site

Register the canonical origin and approved host scope once after migrating:

```powershell
pnpm site:upsert -- "RocoBroker" "https://rocobroker.com" "Asia/Tehran"
```

The command prints the site UUID used by the crawl API. It does not store credentials or grant write access to the website.

## Start and inspect a crawl

Start the API and worker, then submit a conservative crawl command:

```powershell
$siteId = '<site UUID>'
$body = @{
  startUrl = 'https://rocobroker.com/fa'
  maxPages = 10
  concurrency = 1
  requestsPerSecond = 0.5
} | ConvertTo-Json

$run = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:4000/sites/$siteId/crawls" `
  -ContentType 'application/json' `
  -Body $body

Invoke-RestMethod "http://127.0.0.1:4000/crawls/$($run.id)"
Invoke-RestMethod "http://127.0.0.1:4000/crawls/$($run.id)/summary"
```

Cancellation is cooperative between bounded crawl batches:

```powershell
Invoke-RestMethod -Method Post "http://127.0.0.1:4000/crawls/$($run.id)/cancel"
```

Request values can only reduce the environment-configured ceilings. Robots rules, approved hosts, public-network SSRF checks, redirect scope, rate, concurrency, depth, byte size, timeout, and page budget are enforced by the worker.

## Configure and run Google imports

Create a Google service account, enable the Search Console API and Google Analytics Data API, and grant its email read access to the configured GSC and GA4 properties. Keep its downloaded JSON outside the repository and set `GOOGLE_CREDENTIALS_FILE`, `GSC_PROPERTY`, `GA4_PROPERTY_ID`, and `GOOGLE_SITE_ID` in `.env`. `PAGESPEED_API_KEY` is optional but recommended for managed quota.

After starting the API and worker, a small GSC validation can be queued with:

```powershell
$siteId = '<site UUID>'
$body = @{ startDate='2026-09-01'; endDate='2026-09-03'; dimensionSet='PAGE' } | ConvertTo-Json
$sync = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/sites/$siteId/integrations/gsc/sync" -ContentType 'application/json' -Body $body
Invoke-RestMethod "http://127.0.0.1:4000/integration-syncs/$($sync.id)"
Invoke-RestMethod "http://127.0.0.1:4000/sites/$siteId/integrations/freshness"
```

Use `mode='backfill'` with explicit dates for a historical GSC/GA4 import. PageSpeed accepts at most 20 approved-scope `urls` and `mobile`/`desktop` `strategies`. Scheduled imports remain disabled until `GOOGLE_SCHEDULES_ENABLED=true`; defaults are daily GSC/GA4 and weekly canonical-page PageSpeed collection. Full setup and recovery details are in [docs/runbooks/google-integrations.md](docs/runbooks/google-integrations.md).

## Detect and inspect SEO opportunities

Set a private `OPPORTUNITY_API_TOKEN` (at least 32 random characters), then start the existing API and worker. Missing token disables all Phase 4 routes. The API queues `opportunities.detect`; the worker loads successful historical observations and runs six deterministic detectors.

- `POST /sites/:siteId/opportunity-runs`: trigger with optional historical `endDate`, partial `config`, and `idempotencyKey`
- `GET /sites/:siteId/opportunity-runs/:id`: status, counts, coverage, attempts and safe failures
- `GET /sites/:siteId/opportunities`: paginated filters by type/status/minScore/pageId
- `GET /sites/:siteId/opportunities/:id`: immutable evidence/score history and lifecycle decisions
- `PATCH /sites/:siteId/opportunities/:id/status`: acknowledge, dismiss or reopen with expected status and reason; requires an active configured `OPPORTUNITY_ACTOR_ID`

Every endpoint requires `Authorization: Bearer <token>`. Defaults use 28 days, a three-day finality buffer and explicit minimum evidence. Business value remains unassigned until configured. Cannibalization, content gaps and internal-link suggestions remain candidates for review.

`pnpm opportunities:validate` reads existing observations without database writes or vendor calls. Detailed output is stored privately in ignored `tmp/phase4-validation.json`. Unconfigured database access is reported explicitly rather than interpreted as zero opportunities.

Rules, formulas and limits: [docs/OPPORTUNITY_ENGINE.md](docs/OPPORTUNITY_ENGINE.md). Commands/recovery: [docs/runbooks/opportunities.md](docs/runbooks/opportunities.md). Calibration and available-data status: [docs/PHASE_4_CALIBRATION.md](docs/PHASE_4_CALIBRATION.md).

## Analyze opportunities with agents

Phase 5 is disabled by default. Configure a separate `AGENT_API_TOKEN`, active `AGENT_ACTOR_ID`, worker-only `LLM_OPENAI_API_KEY` and a complete `LLM_POLICY_JSON` with pinned models, verified integer token prices and limits before setting `AGENTS_ENABLED=true`.

- `POST /sites/:siteId/opportunities/:id/analysis`: queue a bounded Supervisor workflow
- `GET /sites/:siteId/agent-runs/:id`: inspect sanitized evidence, versions, calls, usage, cost and validated findings
- `GET /sites/:siteId/agent-runs/:id/draft`: retrieve only completed non-executable DRAFT output
- `POST /sites/:siteId/agent-runs/:id/retry`: request safe resume with frozen evidence/policy and retained attempt limits

Every Phase 5 route requires its own bearer credential. Specialists interpret technical, keyword, content and link evidence; the Supervisor combines validated results. All important output is schema/policy checked, observations must copy supplied facts exactly, and targets stay within supplied page identities. Agents have no tools, database access or production write capability. No autonomous schedule or full dashboard is added.

Architecture/contracts: [docs/AGENT_LAYER.md](docs/AGENT_LAYER.md). Enablement/recovery/live procedure: [docs/runbooks/agents.md](docs/runbooks/agents.md). Actual evaluation status: [docs/PHASE_5_EVALUATION.md](docs/PHASE_5_EVALUATION.md).

## Review, record and measure changes

Phase 6 materializes one validated draft action into a concrete typed proposal with before/after values and an explicit measurement rule. Set `WORKFLOW_ACCESS_JSON` with private token/active actor/role entries. Clients cannot supply reviewer identity or privileges. HIGH/SPECIAL_APPROVAL review requires SPECIAL_APPROVER; business mutations require active humans.

Under `/sites/:siteId/workflow/`:

- Recommendations: create/list/detail, immutable `versions`, review `decisions`, manual `implementation`.
- Changes: ledger detail, human `reverts`, metadata `corrections`, explicit baseline recapture and measurement history.
- Measurements: operator-triggered mature 30/60/90 attempts; optional pg-boss hourly dispatch from durable plans.

Approval never changes the website. Implementation requires exact approved values, human date/notes/reference/attestation. SANDBOX is explicit for controlled validation. Missing/thin/overlapping data produces INSUFFICIENT_DATA, and results never assert causation. Reverts are records only.

`WORKFLOW_SCHEDULES_ENABLED` defaults false. Scheduled dispatch requires an active SERVICE `WORKFLOW_MEASUREMENT_ACTOR_ID`; existing plans survive restarts/disabled schedules. All analysis uses stored observations, without new vendor calls.

Rules and architecture: [docs/WORKFLOW_MEASUREMENT.md](docs/WORKFLOW_MEASUREMENT.md). API/operation instructions: [docs/runbooks/workflow-measurement.md](docs/runbooks/workflow-measurement.md). Controlled evidence: [docs/PHASE_6_VALIDATION.md](docs/PHASE_6_VALIDATION.md).

## Verify the workspace

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the PostgreSQL migration integration test while the development database is available:

```powershell
$env:TEST_DATABASE_URL='postgresql://roco_seo:roco_seo_dev@127.0.0.1:5432/roco_seo_test'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
```

`pnpm test:all` runs both unit and integration tests and therefore requires `TEST_DATABASE_URL` and PostgreSQL.

Crawler fixtures are part of `pnpm test`. The fixtures cover URL normalization, scope/SSRF rules, robots and sitemap parsing, static HTML extraction, redirects and loops, response limits, retry/rate behavior, cancellation, graph metrics, issue rules, and snapshot comparison without relying on production availability.

## Production builds

```powershell
pnpm build
pnpm --filter @roco/api start
pnpm --filter @roco/worker start
pnpm --filter @roco/dashboard start
```

The Nginx file under `infrastructure/nginx/` is a deployment baseline, not an authorization control. It must not be enabled on a public interface until authentication and TLS deployment are approved.

## Important directories

```text
apps/
  api/         Fastify health, crawl, integration, opportunity and agent commands/reads
  worker/      pg-boss crawl, Google import, opportunity and agent jobs
  dashboard/   Minimal private control-center placeholder
packages/
  config/      Zod-validated environment configuration
  db/          Drizzle schema, migration, database probes, job repository
  seo-core/    URL identity, indexability, graph metrics, issue rules
  crawler/     Safe HTTP fetch, robots/sitemaps, Cheerio extraction, frontier
  integrations/ Validated Google auth, API clients, normalization, and URL mapping
  opportunities/ Pure deterministic detection, scoring and lifecycle rules
  llm/         Provider ports, real HTTP adapter and fixture provider
  agents/      Evidence, role/prompt/schema contracts and bounded Supervisor
  workflow/    Review/risk/value contracts and deterministic measurement
  shared/      Structured logging and correlation helpers
  testkit/     Shared test environment helpers
infrastructure/
  docker/      PostgreSQL initialization
  nginx/       Future authenticated reverse-proxy baseline
docs/runbooks/ Operational procedures
```

See [docs/runbooks/development.md](docs/runbooks/development.md) for health checks, shutdown, and recovery guidance.

## Phase 7 private SEO Control Center

Phases 1–7 are approved. Phase 7 adds a compact light dashboard with overview, crawl/technical evidence, separate Google performance datasets, opportunities, agent recommendations, exact-version human review, manual implementation recording, Change Ledger, 30/60/90 measurement state and collection freshness/failures. Phase 7.5 private VPS deployment and hardening are implemented; live Google/opportunity/AI acceptance remains pending. See [production operations](docs/OPERATIONS.md) and [validation evidence](docs/PHASE_7_5_VALIDATION.md). Phase 8 has not been started.

Run `pnpm dev:dashboard` alongside the API/worker. Sign in with your own API-managed `WORKFLOW_ACCESS_JSON` credential bound to an active HUMAN actor. The browser receives an HttpOnly expiring session, not a bearer token. Use one dashboard process; deploy/restart signs out users. Inject `DASHBOARD_ORIGIN`/`DASHBOARD_API_URL` when changing localhost defaults and complete TLS/access hardening before remote exposure. No production website modification occurs through this UI.

Read [dashboard operations](docs/runbooks/dashboard.md) and [Phase 7 validation](docs/PHASE_7_VALIDATION.md) for setup, roles, review/implementation, metric/freshness definitions, scope limits and checks. Existing collection/detection/analysis commands remain in their runbooks. New alert engines and scheduled report distribution are explicitly deferred under the current scope.

Browser checks use `TEST_DATABASE_URL=... pnpm test:dashboard` with an isolated local database ending `_test` and installed Chrome. Playwright 1.63.0 is development-only; no browser/analytics/identity runtime dependency was added. Never run destructive integration fixtures against a deployment database.

### Deployed dashboard

Open [SEO Control Center](https://scc.rocobroker.com/sign-in) with the existing named access credential. HTTPS renewal is automatic; the API and database remain private. No SSH tunnel is needed for dashboard access. See [operations](docs/OPERATIONS.md) for certificate/renewal checks and recovery.

### Initial AI connection

Only the SEO Supervisor is activated, using GPT-6.1 Sol with medium reasoning and a $20 monthly application cap. Real recommendation evaluation awaits genuine scored Google evidence. See [Supervisor connection](docs/SUPERVISOR_CONNECTION.md) for eligibility, limits and validation.
