# Phase 6 Validation — 2026-10-07

## Delivery boundary

Phase 5 was completed and approved by the user. Phase 6 implements versioned human review, recorded manual implementation, Change Ledger, baseline and 30/60/90 measurement only. Phase 7 was not started; the dashboard is unchanged. No production CMS adapter, approval automation, publishing, website write or automatic revert exists.

## Controlled flow and production status

No real Phase 5 recommendations are accessible from this checkout: no project `DATABASE_URL` or local `.env` is configured. Controlled validation therefore uses explicitly SANDBOX records in isolated PostgreSQL 17.11, valid fixture Phase 5 Supervisor drafts, named human/service actors and an injected UTC clock. Real recommendations are not falsely claimed as tested.

The exercised flow is:

1. Materialize one validated title action as a concrete DRAFT with typed before/after values and a CTR measurement rule.
2. Submit for review; approve as a separate authenticated human.
3. Record a simulated SANDBOX implementation with exact approved values, human attestation/date/notes/reference.
4. Capture initial pre-change baseline from fixture final PAGE observations and create all three durable plans atomically.
5. Advance the injected clock to matured T+30/60/90 comparison dates; use controlled post windows and classify POSITIVE association without a causal claim.
6. Replay commands and retain one immutable result per run.
7. Exercise missing-baseline INSUFFICIENT_DATA, explicit late baseline recapture, metadata correction and recorded human revert; later result becomes REVERTED.

**No real production change or revert was involved.** Production records were not created, migrated or mutated. No website, Google or paid LLM call was made by Phase 6 tests.

## Evidence and safety checks

- Active-version approval is required before implementation. Approval itself creates no ledger/website change.
- An approved revision creates version two/DRAFT, supersedes the old approval and rejects stale review/implementation.
- Concurrent review produces only one successful decision and attributable generated/submitted/approved audit events.
- HIGH canonical review rejects normal approvers and service actors; SPECIAL_APPROVER succeeds.
- Rejection and changes-requested decisions remain separate immutable history.
- Wrong actual-after values are rejected instead of silently recording unapproved changes.
- Initial baseline fixture contains 2,800 impressions over twenty-eight observed days. Missing baseline stays missing until an explicit new capture version.
- All three horizon plans exist immediately after implementation. Early requests are rejected, due dispatcher attempts are idempotent, and actual pg-boss delivery/replay preserves result identity.
- Matching daily coverage, low volume, incomplete imports, missing primary/optional metrics, sparse PageSpeed samples, overlapping changes and changed URL identity have conservative insufficiency handling.
- Ledger and measurement-result mutation attempts fail through database guards.
- Roles/identity are server-mapped; caller reviewer strings or privilege assumptions cannot authorize review. ADMIN is not an implicit approver.

These checks validate software contracts and sandbox arithmetic, not production SEO causation or calibration. Physical implementation remains a human-attested fact.

## Commands and actual verification

- `pnpm lint`: PASS, zero warnings.
- `pnpm typecheck`: PASS across apps/packages and operational/integration scripts.
- `pnpm test`: PASS, 125 tests across 22 files, including Phase 1–5 regressions.
- `TEST_DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55436/roco_phase6_test pnpm test:integration`: PASS, ten migration/history tests, one opportunity queue test, four agent tests and seven Phase 6 workflow/measurement tests (22 total).
- `pnpm build`: PASS for all packages, API, worker and unchanged Next.js dashboard.
- `pnpm format:check`: PASS.
- `DATABASE_URL=postgresql://localhost/roco_seo pnpm db:generate`: no ORM/migration snapshot drift; generation does not connect to that placeholder deployment URL.

The disposable PostgreSQL cluster is stopped after validation. Existing shared migrations and production data were not changed. The new workflow package reuses existing Zod/agent/opportunity contracts; no new external dependency or dependency upgrade is introduced.

## Acceptance and remaining review

Immutable versions, attributable role-controlled approvals, stale-version protection, exact-value manual ledger, baseline history, durable pg-boss horizon plans, deterministic outcomes, safe replays/reverts and audit events are implemented and tested.

Review inputs before rollout: named credentials/roles/service actor, private access, actual manual evidence policy, metric/sample/threshold calibration, source timezone/coverage, overlap policy and operational notification channels. No notifications are sent automatically; durable audit, status/history and structured logs are available. URL/redirect/deletion identity reconciliation remains intentionally insufficient until separately designed; sparse/uneven data and absent metrics are not treated as failures caused by a change.

Rules and commands are in `WORKFLOW_MEASUREMENT.md` and `runbooks/workflow-measurement.md`. Phase 6 is ready for review. Phase 7 remains unapproved and unimplemented.

## Files changed

43 files changed or added relative to the approved Phase 5 workspace:

- `.env.example`
- `README.md`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/workflow-routes.ts`
- `apps/api/test/workflow.test.ts`
- `apps/worker/package.json`
- `apps/worker/src/jobs/measure-change.ts`
- `apps/worker/src/runtime.ts`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DECISIONS.md`
- `docs/MASTER_PLAN.md`
- `docs/PHASE_6_VALIDATION.md`
- `docs/SECURITY.md`
- `docs/WORKFLOW_MEASUREMENT.md`
- `docs/phases/05-agents.md`
- `docs/phases/06-approval-ledger.md`
- `docs/runbooks/workflow-measurement.md`
- `package.json`
- `packages/config/src/index.ts`
- `packages/db/migrations/0006_phase6_workflow.sql`
- `packages/db/migrations/meta/0006_snapshot.json`
- `packages/db/migrations/meta/_journal.json`
- `packages/db/package.json`
- `packages/db/src/index.ts`
- `packages/db/src/measurement-repository.ts`
- `packages/db/src/measurement-source.ts`
- `packages/db/src/schema.ts`
- `packages/db/src/workflow-repository.ts`
- `packages/db/src/workflow-schema.ts`
- `packages/shared/src/index.ts`
- `packages/workflow/package.json`
- `packages/workflow/src/contracts.ts`
- `packages/workflow/src/index.ts`
- `packages/workflow/src/measurement.ts`
- `packages/workflow/src/policy.ts`
- `packages/workflow/test/workflow.test.ts`
- `packages/workflow/tsconfig.build.json`
- `packages/workflow/tsconfig.json`
- `pnpm-lock.yaml`
- `tests/integration/workflow.integration.test.ts`
