# Phase 4 Calibration and Validation

## Validation status — 2026-10-05

Phase 3 was approved by the user. Phase 4 implements only deterministic opportunity analysis and is pending review. No website changes, Google calls, LLM calls or Phase 5 work were performed.

Existing project data is **unavailable from this checkout**: no local `.env` or process `DATABASE_URL` is present. The read-only `pnpm opportunities:validate` command exits nonzero with the explicit missing-configuration message. Real-data totals, counts by type, highest-scoring opportunities and observed production false positives are therefore **not available**, not zero. This does not imply data was not collected elsewhere.

Automated database validation used isolated PostgreSQL 17.11 on localhost port 55434, with newly created test databases under a temporary cluster. Docker socket access was unavailable; no shared/project/production database was migrated or mutated. A fixture queue smoke executed the actual worker and pg-boss pipeline, creating eight scored observations in 17 ms and retaining eight after redelivery. This is a local engineering observation, not an SLA.

## Controlled three-page calibration

Fixture: seven-day current window ending 2026-09-28, adjacent seven-day comparison window, three pages, two exact queries, 42 PAGE daily rows, 28 PAGE_QUERY rows and a three-page crawl graph. All relevant sync windows and observed days are complete. No business rules are supplied.

| Type                      | Count |
| ------------------------- | ----: |
| QUICK_WIN                 |     2 |
| CTR                       |     1 |
| DECAY                     |     1 |
| CANNIBALIZATION_CANDIDATE |     2 |
| INTERNAL_LINK             |     1 |
| CONTENT_GAP_CANDIDATE     |     1 |
| Total                     |     8 |

Highest scores, calculated from the actual fixture:

| Rank | Type                  | Target                          | Score |
| ---- | --------------------- | ------------------------------- | ----: |
| 1    | DECAY                 | `/fa/blog/forex`                | 79.07 |
| 2    | INTERNAL_LINK         | `/fa/blog/forex`                | 69.21 |
| 3    | QUICK_WIN             | `/fa/blog/forex`, query `forex` | 66.95 |
| 4    | CONTENT_GAP_CANDIDATE | query `gap`                     | 64.07 |
| 5    | CTR                   | `/fa/blog/forex`                | 63.10 |

The remaining quick win scores 63.03; both exact-query competition candidates score 62.41. Query groups have no arbitrary primary page or business value. The default business weight is excluded from each score because value is unassigned.

## Backtesting and sensitivity

A second controlled fixture contains 100 pages across 14 days, with varied demand and positions and one exact query per page. Current and previous seven-day detection both produce 100 quick wins; current detection produces 100 CTR opportunities and no decay on unchanged metrics. The earlier analysis explicitly reports insufficient prior-comparison coverage rather than inventing earlier data.

Changing to impact-only scoring changes the ranking order, and every resulting score equals its impact component. Raising minimum impressions to 5,000 suppresses all opportunities in the small calibration fixture. These fixtures demonstrate reproducibility, sensitivity and historical-window behavior; they do not calibrate commercial value, search intent or production precision.

Additional tests cover sparse imports, unequal observed day sets, severe declines below current demand thresholds, tiny changes, weighted position, dataset separation, Unicode exclusions, query overlap, unsafe/existing link sources, lifecycle suppression/reopen, frozen retries, concurrent delivery and old-run projection protection.

## False-positive concerns and evidence limitations

- Exact-query competition may be intentional across locales, content types or search intents. Competition and overlap results are candidates, never confirmed cannibalization.
- Weak rankings do not prove a content gap; content quality/intent requires later review.
- Orphan and incoming-link counts describe a bounded observed graph. Same path section is a coarse relationship, not semantic relevance.
- CTR bands are provisional and may be wrong for branded queries, geography, device or SERP features.
- Position and CTR aggregates can shift with query/device/country mix even when individual rankings are stable.
- Missing Google rows are not zeros. A completely absent page cannot be confidently classified as decay. Such evidence remains insufficient/stale.
- Scores reflect heuristic evidence confidence and effort, not estimated revenue or a guaranteed uplift.
- Matched observed dates and a finality buffer reduce noise; seasonality and site-wide search changes still need review.

## Production follow-up

Configure a least-privilege database connection to existing observations and run the read-only validator. Review `tmp/phase4-validation.json`, especially insufficient-evidence counters and candidate false positives. Confirm business path values, commercial-page priorities, branded/excluded queries and CTR expectations before accepting tuned scoring. Phase 5 requires separate approval.

## Verification evidence

| Command                                                                                              | Actual result                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                          | PASS, zero warnings                                                             |
| `pnpm typecheck`                                                                                     | PASS, all packages/apps and operational/integration scripts                     |
| `pnpm test`                                                                                          | PASS, 68 tests across 15 files                                                  |
| `TEST_DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55434/roco_phase4_final pnpm test:integration` | PASS, 10 migration/history tests plus 1 actual pg-boss delivery/redelivery test |
| `pnpm build`                                                                                         | PASS, all packages, API, worker and Next.js dashboard                           |
| `pnpm format:check`                                                                                  | PASS                                                                            |
| `pnpm opportunities:validate`                                                                        | Exit 1: no configured project database; no source/database writes               |

PostgreSQL integration uses a disposable localhost cluster; the cluster is stopped after validation. The environment URL above names only the temporary test database, not a deployment database. Existing Phase 1–3 tests run within these suites. No new external dependency or dependency-version upgrade is introduced; the new domain package reuses the existing Zod version.

## Files changed

The implementation changes/adds 47 project files:

- Engine (8): `packages/opportunities/package.json`, `src/contracts.ts`, `src/engine.ts`, `src/index.ts`, `test/engine.test.ts`, `test/fixtures.ts`, `tsconfig.json`, `tsconfig.build.json` (all under `packages/opportunities/`).
- API (4): `apps/api/package.json`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/test/opportunities.test.ts`.
- Worker (4): `apps/worker/package.json`, `apps/worker/src/runtime.ts`, `apps/worker/src/jobs/detect-opportunities.ts`, `apps/worker/test/detect-opportunities.test.ts`.
- Database (9): `packages/db/package.json`, `packages/db/src/index.ts`, `packages/db/src/schema.ts`, `packages/db/src/opportunity-schema.ts`, `packages/db/src/opportunity-repository.ts`, `packages/db/test/migrations.integration.test.ts`, `packages/db/migrations/0004_phase4_opportunities.sql`, `packages/db/migrations/meta/0004_snapshot.json`, `packages/db/migrations/meta/_journal.json`.
- Configuration/shared (3): `.env.example`, `packages/config/src/index.ts`, `packages/shared/src/index.ts`.
- Tooling/operations/integration (7): `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `scripts/operations/validate-opportunities.ts`, `scripts/tsconfig.json`, `tests/integration/opportunities.integration.test.ts`, `tests/tsconfig.json`.
- Documentation (12): `README.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DECISIONS.md`, `docs/MASTER_PLAN.md`, `docs/SECURITY.md`, `docs/OPPORTUNITY_ENGINE.md`, `docs/PHASE_4_CALIBRATION.md`, `docs/runbooks/opportunities.md`, `docs/phases/01-foundation.md`, `docs/phases/02-crawler.md`, `docs/phases/04-opportunity-engine.md`.
