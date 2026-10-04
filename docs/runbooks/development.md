# Local Development Runbook

## Services

Phase 1 runs PostgreSQL in Docker and the API, worker, and dashboard as local Node.js processes. All published development ports bind to `127.0.0.1`.

## Start PostgreSQL

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
docker compose --env-file .env -f infrastructure/compose.yaml ps
```

Wait until PostgreSQL reports `healthy` before migrating.

## Apply migrations

```powershell
pnpm db:migrate
```

Migrations are forward-only and committed under `packages/db/migrations/`. After an intentional schema change:

```powershell
pnpm db:generate
pnpm db:migrate
```

Review generated SQL before applying it. Do not modify a migration that has already been applied to a shared environment.

## Start applications

In separate terminals:

```powershell
pnpm dev:api
pnpm dev:worker
pnpm dev:dashboard
```

The API listens on `http://127.0.0.1:4000`, and the dashboard listens on `http://127.0.0.1:3000`.

## Health checks

```powershell
Invoke-RestMethod http://127.0.0.1:4000/health
Invoke-RestMethod http://127.0.0.1:4000/ready
```

`/health` proves the API process is alive. `/ready` returns success only when PostgreSQL is reachable and pg-boss has initialized its schema.

## Full verification

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
$env:TEST_DATABASE_URL='postgresql://roco_seo:roco_seo_dev@127.0.0.1:5432/roco_seo_test'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
pnpm build
```

## Stop services

Stop local Node.js processes with `Ctrl+C`, then:

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml down
```

Do not add `--volumes` unless intentionally discarding the local database.

## Recovery notes

- If `/health` succeeds but `/ready` fails, verify PostgreSQL and start the worker once so pg-boss can initialize.
- If a migration fails, preserve the database and inspect the migration error. Do not edit an already shared migration or reset the database blindly.
- If the worker cannot stop gracefully, its configured timeout bounds pg-boss shutdown. Check structured logs for active work before restarting.
