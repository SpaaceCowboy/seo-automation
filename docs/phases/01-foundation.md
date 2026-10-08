# Phase 1 - Foundation

Status: Implemented, pending review and Docker Desktop container-start verification.

## Objective

Create a runnable, observable, and testable monorepo foundation without crawling RocoBroker or integrating external data sources.

## In scope

- pnpm workspace, shared TypeScript configuration, formatting/linting, Vitest, and package scripts
- `apps/api`, `apps/worker`, and `apps/dashboard` minimal deployable shells
- `packages/config`, `packages/shared`, `packages/db`, and `packages/testkit` foundations
- Typed environment validation and safe `.env.example`
- PostgreSQL/Drizzle connection and migration workflow
- pg-boss connection, worker lifecycle, and one no-op health job
- Fastify liveness/readiness endpoints and request logging
- Pino logging with correlation and redaction
- Docker Compose development services and baseline Nginx/deployment documentation
- Initial `sites`, `site_hosts`, `actors`, `jobs`, and `audit_events` schema as needed for the foundation
- CI-equivalent test, typecheck, lint, and build commands

## Out of scope

- Fetching any production URL
- Technical SEO rules
- Google API credentials or calls
- LLM provider integrations
- Recommendation, approval, ledger, and dashboard feature workflows

## Acceptance criteria

- A clean checkout installs with the documented pnpm command and has a reproducible lockfile.
- One root command runs all tests, one runs typecheck, one runs lint, and one builds all Phase 1 projects.
- API liveness succeeds without dependencies; readiness accurately fails when PostgreSQL/job infrastructure is unavailable.
- Worker starts, handles graceful shutdown, and executes a no-op job exactly once from the application's perspective under a duplicate command test.
- Invalid or missing environment configuration fails at startup with a safe, actionable message.
- Database migrations apply to an empty database and the migration test verifies expected constraints.
- Logs are JSON in production mode, include correlation fields, and redact configured secrets.
- Dashboard renders a private-shell placeholder and is not exposed without the documented authentication/network decision.
- Docker Compose starts the Phase 1 stack and documented health checks pass.
- No production website write credential or crawler capability exists.
- Tests, typecheck, lint, and build pass; architecture/security/runbook documentation is updated.

## Required decisions before completion

- Deployment host constraints and PostgreSQL location
- Dashboard authentication/network exposure approach
- Site canonical origin and timezone for seed configuration
- Backup target and initial operator ownership

## Exit artifact

A foundation readiness report with commands, service health evidence, migration state, unresolved risks, and an explicit stop before Phase 2.

## Implementation evidence

- Workspace: pnpm with exact lockfile, shared strict TypeScript, ESLint, Prettier, and Vitest
- API: `/health` and PostgreSQL/pg-boss-aware `/ready`, structured request logs, safe errors
- Worker: pg-boss lifecycle, `foundation.noop` queue/schedule, database-backed idempotency, bounded graceful stop
- Database: five Phase 1 tables and generated Drizzle migration
- Dashboard: localhost-only Next.js placeholder with `noindex`
- Infrastructure: pinned PostgreSQL 17.11 Compose service, localhost port binding, health check, and inactive Nginx baseline
- Operations: environment example, README, development runbook, migration/integration tests

The completion report is authoritative for the exact verification results. Phase 2 and Phase 3 are now implemented; Phase 3 has been approved. This Phase 1 exit note is historical.
