# Opportunity Operations

## Prepare

Apply reviewed migrations with `pnpm db:migrate`. Keep the existing API/dashboard localhost-only. Phase 4 does not authorize public exposure of the unauthenticated Phase 1–3 routes.

Set `OPPORTUNITY_API_TOKEN` to at least 32 random characters in secret environment injection. Missing token disables **all** opportunity endpoints with HTTP 503; missing/wrong bearer authentication receives HTTP 401. Do not put the token in a tracked file or command history. The credential grants this internal operator access to this deployment's opportunity endpoints; per-user sessions/roles remain a later authentication decision.

To acknowledge/dismiss/reopen, set `OPPORTUNITY_ACTOR_ID` to an active registered `actors.id`. Caller-supplied actor identities are rejected. The actor associated with the credential is attributed in `audit_events`; do not share a named person's credential. Detection/read access works without an operator actor, while status mutations fail closed.

Start `pnpm dev:api` and `pnpm dev:worker`. Detection is manual through pg-boss; no new autonomous schedule is installed.

## Queue and inspect

Bash examples assume `siteId` is your registered site UUID and the token is already in the process environment:

```bash
curl --fail-with-body -X POST "http://127.0.0.1:4000/sites/$siteId/opportunity-runs" \
  -H "Authorization: Bearer $OPPORTUNITY_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"config":{"windowDays":28}}'
```

The response returns `id` and status. Inspect progress and results:

```bash
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/opportunity-runs/$runId" \
  -H "Authorization: Bearer $OPPORTUNITY_API_TOKEN"
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/opportunities?status=OPEN&minScore=50&limit=50&offset=0" \
  -H "Authorization: Bearer $OPPORTUNITY_API_TOKEN"
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/opportunities/$opportunityId" \
  -H "Authorization: Bearer $OPPORTUNITY_API_TOKEN"
```

List filters: `type`, `status`, `minScore`, `pageId`, `limit`, `offset`. Detail and run reads are site-scoped. Use `hasMore` for list pagination.

Override thresholds/weights/business path values in the `config` object, supplying only changed values. Supply `endDate` for a historical window; a date inside the configured freshness buffer is rejected. Configuration is stored immutably with its hash. To recompute the same end date after corrected imports, supply a **new** `idempotencyKey`; ordinary repeated commands deliberately resolve the same logical run.

## Review lifecycle

```bash
curl --fail-with-body -X PATCH "http://127.0.0.1:4000/sites/$siteId/opportunities/$opportunityId/status" \
  -H "Authorization: Bearer $OPPORTUNITY_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"status":"DISMISSED","expectedStatus":"OPEN","reason":"Reviewed as an irrelevant candidate"}'
```

Allowed operator targets: OPEN, ACKNOWLEDGED, DISMISSED. On HTTP 409, check the configured actor and reload current state before retrying. Operator decisions appear alongside detector events and evidence in detail responses. Dismissal suppresses automatic reopening but does not delete observations. Automatic resolution requires adequate negative evidence; missing data can eventually become STALE, never an inferred recovery.

## Validate existing data without writing to PostgreSQL

```bash
pnpm opportunities:validate
```

Requires `DATABASE_URL` and migrated Phase 1–4 schema. It reads all active sites, uses the default safe 28-day window, and evaluates observations in PostgreSQL **READ ONLY, REPEATABLE READ** transactions. It creates no config/run/opportunity records and makes no vendor calls. Detailed output is saved with mode 0600 in ignored `tmp/phase4-validation.json`; terminal output contains counts and coverage warnings, not query exports. Missing database configuration exits nonzero explicitly. Do not interpret unavailable data as zero production opportunities.

Review candidate false positives before tuning or moving to Phase 5. In particular inspect Google privacy/truncation, matched date sets, target indexability, bounded crawl scope, coarse path relationships, brand queries, locale differences and commercially unassigned pages.

## Failure and recovery

Run summaries retain start/end, attempts, error code, duration, source window, detector/type counts, insufficient-evidence counters and created/updated/resolved/staled counts. Correlated worker logs retain identifiers and safe metadata, not query bodies or database credentials.

Retry failed commands with the same idempotency key after fixing infrastructure. The frozen snapshot is reused. If failure is due to unsuitable input/budget/configuration, create a new command with an approved corrected configuration or smaller data window. Changes to daily source data never rewrite previously captured runs. No site write or external credential is needed by the engine.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL='<isolated-test-database-url>' pnpm test:integration
pnpm build
pnpm format:check
```

The integration suite truncates its test database in the existing migration suite; never point `TEST_DATABASE_URL` at a shared/project/production database. It verifies migrations, historical evidence, retries, concurrency, lifecycle/audit and actual pg-boss delivery. It makes no Google or website calls.
