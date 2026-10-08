# Integrations status and agent availability

This approved Phase 7.5 follow-up adds an Integrations sidebar view, independent of AI recommendation history. It does not activate specialists, change the Supervisor policy, configure Google credentials, create paid inference or modify RocoBroker.

## Data and permissions

The worker publishes a whitelisted runtime snapshot and heartbeat to PostgreSQL. API/dashboard processes never receive provider keys. `GET /control/integrations` accepts optional `siteId` for stored Google sync history and requires an active named read principal. `POST /control/integrations/openai/check` accepts only `{}` and requires an active HUMAN OPERATOR, same-origin and CSRF validation through the Next BFF. Every manual request is audited, including coalesced requests. Response contracts reject unrecognized fields and secret-shaped model identifiers.

The page separately reports worker health, agent activation, key/model metadata verification and analysis history. Four deferred agent roles remain visible and inactive. Provider success is labelled “Key/model access verified”; it does not attest inference permissions, account credit, source data sufficiency or recommendation usefulness. Google configuration is reported separately from selected-site sync history; no new Google requests occur.

## Checks and durability

A dedicated `integrations.openai.check` pg-boss queue runs at startup, every 15 minutes in UTC and on manual request. The worker uses the fixed [OpenAI model retrieval endpoint](https://developers.openai.com/api/reference/resources/models/methods/retrieve), a 15-second deadline, no redirects and no automatic HTTP retry. The returned model identifier/object must match the configured model. Metadata is bounded to 64 KB and discarded after validation; only classified status, HTTP code, latency and correlation identifiers survive. No Chat Completions/Responses generation endpoint is called.

Requests are serialized/coalesced with a PostgreSQL advisory lock and a 60-second deployment-wide cooldown. Jobs expire after 60 seconds. A fresh boot identifier invalidates earlier check results; interrupted pending checks become SUPERSEDED. Terminal check rows are protected against update/delete. Runtime status is replaceable operational telemetry; connection-check history remains durable and indexed.

Worker heartbeats publish every 15 seconds. Telemetry older than 45 seconds is offline; verification older than 20 minutes is stale. The dashboard refreshes every 30 seconds only while visible, with short polling during a pending check. GET operations never contact vendors or mutate state. Database/status read failures show an error, not fabricated disconnection or zero metrics.

## Budget

The UTC-month budget projection uses the current policy and existing shared monthly ledger, choosing the tighter limit and retaining integer nanodollar calculations. Booked/reserved usage and remaining **application** budget are not provider invoices/account credit. Missing policy produces unknown limits. Known absent bookings produce zero. Metadata checks remain possible when inference budget is exhausted and do not change reservations or agent history.

## Schema and rollout

Migration `0007_integrations_status.sql` adds `integration_runtime` and `integration_connection_checks`, their index/constraints and terminal-history trigger. It makes no destructive changes to existing tables. Back up PostgreSQL, migrate, deploy worker telemetry first, then API/dashboard. Rollback can restore the preceding application image while leaving the additive schema/history in place.

The deployment assumes one active worker, consistent with the existing VPS stack. Stale checks and a missed heartbeat do not themselves restart Docker services; inspect worker/API/queue logs and correct the underlying problem. Operational checks and durable rows are distinct from real SEO evidence and paid recommendation evaluations.

## Validation

Unit tests cover metadata contracts, safe failures, response bounds, no inference, endpoint authorization and response whitelist enforcement. Database tests cover concurrent coalescing, cooldown, inactive roles, tighter budgets, stale health, boot invalidation, interrupted checks, history immutability and Google-history/configuration separation. Browser tests cover manual checks without new agent invocations, viewer restrictions, mobile/RTL and existing approval behavior. Final counts and VPS evidence are recorded after deployment.

Local release checks passed: 168 unit tests, 35 sequential database integration tests and five browser scenarios, plus lint, typecheck, production build, formatting and whitespace checks. No new dependency was added. The original work was pushed to master as `402345f`; this feature is isolated on `codex/integrations-agent-status`.

## Production validation — 2026-10-08

Deployed `roco-seo:integrations-20261008`, configuration digest `sha256:711ad6a6041b49ffe45e7c3e7360e48b870f0d037b25214ef570e10d048ed31c`. Encrypted backups succeeded before migration and after deployment. PostgreSQL contains eight migration records. Worker was deployed first; all five services passed health checks.

The real startup check verified `gpt-6.1-sol` metadata with HTTP 200. The authenticated production browser manual check also completed VERIFIED; the page reported ONLINE worker, only SUPERVISOR enabled, $20 application limit and zero bookings. Google cards correctly reported missing configuration and existing PageSpeed failure history. Production RTL/mobile layout passed overflow checks. Paid `agent_invocations` stayed at zero. The Next BFF normalizes successful responses to HTTP 200; its JSON checkId/status still identifies queued/completed checks, while Fastify returns 202 for pending work.

The quarter-hour cron registration was verified in PostgreSQL, and the scheduled check at 10:45:19 UTC completed VERIFIED with HTTP 200. Startup, manual and periodic checks therefore all passed on the deployed worker. No specialist activation, Google probe, paid inference or production website modification occurred.
