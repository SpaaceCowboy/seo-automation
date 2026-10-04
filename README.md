# Roco SEO

Roco SEO is an internal SEO intelligence and automation system that operates alongside the existing RocoBroker website. Phase 3 adds historical Google Search Console, GA4 organic landing-page, and PageSpeed ingestion to the Phase 1/2 foundation.

No opportunity engine, LLM, recommendation workflow, or production website write capability exists in this phase.

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
  api/         Fastify liveness and readiness service
  worker/      pg-boss lifecycle and foundation health job
  dashboard/   Minimal private control-center placeholder
packages/
  config/      Zod-validated environment configuration
  db/          Drizzle schema, migration, database probes, job repository
  seo-core/    URL identity, indexability, graph metrics, issue rules
  crawler/     Safe HTTP fetch, robots/sitemaps, Cheerio extraction, frontier
  integrations/ Validated Google auth, API clients, normalization, and URL mapping
  shared/      Structured logging and correlation helpers
  testkit/     Shared test environment helpers
infrastructure/
  docker/      PostgreSQL initialization
  nginx/       Future authenticated reverse-proxy baseline
docs/runbooks/ Operational procedures
```

See [docs/runbooks/development.md](docs/runbooks/development.md) for health checks, shutdown, and recovery guidance.
