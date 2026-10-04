# Roco SEO

## Repository

The project repository is [SpaaceCowboy/seo-automation](https://github.com/SpaaceCowboy/seo-automation). The local project snapshot is published on the `prod` branch. Publishing this branch does not deploy the application or authorize changes to the production RocoBroker website.

Roco SEO is an internal SEO intelligence and automation system that operates alongside the existing RocoBroker website. Phase 1 provides only the technical foundation: workspace tooling, PostgreSQL persistence, durable jobs, service health, structured logging, and a private dashboard placeholder.

No crawler, Google integration, LLM, opportunity engine, recommendation workflow, or production website write capability exists in this phase.

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
  shared/      Structured logging and correlation helpers
  testkit/     Shared test environment helpers
infrastructure/
  docker/      PostgreSQL initialization
  nginx/       Future authenticated reverse-proxy baseline
docs/runbooks/ Operational procedures
```

See [docs/runbooks/development.md](docs/runbooks/development.md) for health checks, shutdown, and recovery guidance.
