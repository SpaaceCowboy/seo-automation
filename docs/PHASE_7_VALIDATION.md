# Phase 7 validation — 2026-10-07

## Approved scope and outcome

The user approved Phase 6 and requested only the private Phase 7 control center. They selected named actor credentials plus secure application sessions and a compact light interface. The implemented dashboard exposes existing Phases 1–6 data and human workflow through Fastify. It does not query PostgreSQL from UI code, compute opportunities/classifications in React, trigger paid models or modify the production website. Phase 8 remains unapproved and unimplemented.

The core private MVP loop is usable locally. Production rollout/live-data evaluation has not been performed. The broader prospective critical-alert/report-distribution requirement is an explicit exception under the current instruction to expose existing alert data and invent no new alert rules (ADR-039).

## Verification environment

- Host Node.js 26.7.0; pinned pnpm 11.25.0; Next.js 16.3.6; Playwright 1.63.0.
- Isolated PostgreSQL 17 on localhost port 55437, database `roco_phase7_test`; migrations applied to this disposable database.
- Chrome browser, Next production bundle on localhost 3017, Fastify on localhost 4017. Browser tests use UTC to make native timestamp assertions deterministic.
- Project/deployment `DATABASE_URL` and live Google data were not configured. Fixtures use synthetic `.example.test` sites, named HUMAN actors, existing source/scoring/validated-output contracts and SANDBOX workflow records. These are controlled model fixtures, not live brokerage observations.
- No Google, model-provider or production website call is made by the browser harness. Existing queue/worker regression tests separately exercise real pg-boss delivery with injected deterministic fixtures.

## Actual quality gates

All final commands passed:

```sh
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55437/roco_phase7_test pnpm test:integration
TEST_DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55437/roco_phase7_test pnpm test:dashboard
DATABASE_URL=postgresql://spacecowboy@127.0.0.1:55437/roco_phase7_test pnpm db:generate
pnpm format:check
git diff --check
```

- Unit: **138 tests / 26 files**. New coverage includes private route authentication/authorization/error handling, safe request logs, calendar/filter validation, opaque session expiry/revocation, exact origins/rate limits/path allowlists, streamed body limits, untrusted text escaping, score-versus-confidence formatting and stored measurement rendering.
- Integration: **26 tests / 5 suites**: migration/history constraints 10, opportunity/queue regression 1, agent/queue regression 4, human workflow/measurement regression 7, control read projections 4. Phase 7 reads cover all sections, PAGE aggregates, GA4 engagement/daily-user semantics, PageSpeed lab/missing-field semantics, site isolation, actor revocation, unknown crawl counts, stable pagination and URL/status/score filtering.
- Browser: **4 scenarios passed**, final run **5.9 seconds** after the production build. See the walkthrough below. Pixel snapshots are not assertions.
- Build: `pnpm test:dashboard` invokes the full `pnpm build`; shared packages, API, worker and optimized Next bundle pass. Private page/BFF/session routes render dynamically; sign-in is a static public shell without private data.
- Schema: **49 tables**, “No schema changes, nothing to migrate.” No Phase 7 migration was introduced. Initial schema-generation invocation without `DATABASE_URL` correctly failed closed; it was rerun with the isolated local test configuration above.
- Formatting/whitespace: full repository checks pass. Existing approved-phase uncommitted work is preserved; the file inventory below is measured relative to the Phase 7 starting snapshot.

Earlier browser failures exposed an empty-JSON upstream sign-in request, ambiguous wrapped control labels and a detail/navigation/form-loading race. The forwarding headers, accessible labels, cancellation/form loading behavior and native timestamp normalization were corrected before the final passing run. Fastify's supported `LogController` API avoids the deprecated logging option.

## Browser acceptance walkthrough

1. Anonymous private read returns 401 and the private page redirects to sign-in. An active named credential authenticates; the rendered page contains no bearer secret.
2. Overview shows the fixture's successful crawl and page count. Crawl history and implemented technical issue evidence display correctly; severity filtering produces an explicit empty state.
3. GSC PAGE shows 56 clicks, 2,800 impressions, 2% CTR and impression-weighted position 7 over the default window. QUERY remains independently empty. GA4 shows the fixture's 70% engagement rate; PageSpeed shows 1,100 ms lab LCP and missing field data. Freshness shows both failed GA4 collection and sources without successful observations. Existing failure rows remain visible.
4. RTL reverses the layout, formats numbers/dates in Persian and keeps URLs readable. At 390×844, the page has no horizontal overflow. Desktop inspection uses 1440×1050. Focus states, labels, native modal interaction, reduced-motion CSS and touch-sized controls were checked in source/browser; this is not a full independent WCAG certification or production performance audit.
5. Open an opportunity and its immutable scoring/evidence history; navigate to related validated Supervisor output and select a concrete TITLE action. Create a SANDBOX proposal with exact “Old title” → “Approved sandbox title” values and submit for review.
6. Review reason, risk, current immutable version and before/after are visible. Approve the exact version. The UI states that approval does not change the website.
7. Record a human-attested sandbox application with timestamp, reference and notes. One SANDBOX ledger entry is created, its frozen baseline and T+30/60/90 plans are visible, and recorded values/actor traceability agree with the approved version. An early T+30 request is rejected with an actionable maturity message; it does not fabricate a measurement.
8. A VIEWER sees evidence/history but no review/implementation actions. Direct unauthorized decision returns 403; stale version returns 409; cross-origin/CSRF attempt returns 403. The session cookie is HttpOnly/SameSite=Strict; sign-out removes access. Unit tests also verify revoked opaque-session replay and expiry.
9. A separate validated action is materialized, submitted, sent back for changes, revised into version 2, resubmitted and rejected. Rejection exposes no implementation action and creates no extra ledger entry.

**No production website modification occurred.** The application contains no production write adapter or executor. Real 30/60/90-day outcomes cannot be claimed from this immediate validation; existing Phase 6 virtual-time regression tests verify result classification and durable worker delivery, while Phase 7 rendering tests verify stored before/after outcomes.

QA screenshots are ignored local artifacts under `tmp/phase7-overview.png` and `tmp/phase7-mobile-rtl.png`. They contain only synthetic fixture data.

## API / architecture acceptance

- `/control/session` GET verifies active human identity; POST/DELETE audit successful sign-in/sign-out. `/control/sites` lists bounded site identities.
- `/sites/:siteId/control/:section` reads overview, crawls, issues, performance, opportunities, agents, recommendations, changes, measurements, freshness and existing failures. Detail routes preserve source/evidence/history and server-derived review capabilities.
- Existing Phase 6 workflow services handle proposal/version/review/manual implementation/measurement mutations. Expected state/version and human/risk checks remain authoritative. Browser idempotency keys are retained across retries of the same submitted intent.
- Lists default to 25, cap at 50, offset caps at 100,000, date windows cap at 93 inclusive days. Google aggregation stays server-side; detail histories retain their explicit limits. Measurement source IDs cap at 100 per sample/group with original counts/truncation flags; exact full provenance remains stored and available through deliberate Phase 6 audit reads.
- BFF allowlists paths/methods, fixed API origin, eight-second timeout/no redirects/no caching, bounded streamed bodies and exact-origin/session CSRF checks. Read SQL is bound and site scoped; expensive projections have five-second statement timeouts. There is no arbitrary upstream proxy or frontend database client.
- Safe request logs contain matched route templates, status, latency and correlation, excluding raw query strings, bodies/IPs/parser exceptions. Error states do not silently become zero metrics.
- Codebase graph discovery/coverage checks were supplemented with direct source reads, including the reported partial JSX range. Typecheck/runtime tests provide independent implementation evidence.

## Known limits and post-MVP prerequisites

- Single Next process with bounded in-memory sessions/throttle; restart signs users out. Shared durable sessions, MFA/SSO and nonce CSP remain reviewed hardening work. Remote TLS/private proxy, access registry, rate limits, backups/restore and deployment/container details require live operational validation.
- All named roles can read all registered sites. A multi-tenant/site-specific access policy has not been invented.
- No configured live project data/credentials were used. Production volume/performance, semantic recommendation quality and real outcome tuning require live collection and sustained observation. Local fixture timing is not a production SLA.
- Existing failures/findings only: no new spike, important-page, canonical-change, regression alert engine, acknowledgement lifecycle, notification channel or scheduled report distribution. Weekly/monthly inspection uses date windows. Broader FR-021 criteria are deferred explicitly, not marked implemented.
- No new frontend analytics engine for gaining/declining pages; existing DECAY opportunities provide available loss evidence. Dates/dimension sets/coverage/field-data absence remain explicit.
- English interface with RTL/Persian format support, not a full Persian translation. Complex proposal values use bounded structured-entry fields. Collection/detection/paid analysis commands remain in their existing runbooks; the dashboard's daily workflow focuses on evidence and human review.

Next recommended work after Phase 7 approval: deployment/access hardening, initial live read-only collections, monitoring/restore checks, data-quality and recommendation tuning, then actual 30/60/90-day evaluation. This does not authorize Phase 8.

## Phase 7 file inventory

58 files added or changed relative to the approved Phase 6 workspace:

- `.env.example`
- `.gitignore`
- `.prettierignore`
- `README.md`
- `apps/api/src/app.ts`
- `apps/api/src/control-routes.ts`
- `apps/api/src/server.ts`
- `apps/api/test/control.test.ts`
- `apps/dashboard/app/api/control/[...path]/route.ts`
- `apps/dashboard/app/api/session/route.ts`
- `apps/dashboard/app/error.tsx`
- `apps/dashboard/app/loading.tsx`
- `apps/dashboard/app/page.tsx`
- `apps/dashboard/app/sign-in/page.tsx`
- `apps/dashboard/app/styles.css`
- `apps/dashboard/components/control-center.tsx`
- `apps/dashboard/components/detail.tsx`
- `apps/dashboard/components/evidence.tsx`
- `apps/dashboard/components/measurement.tsx`
- `apps/dashboard/components/proposal-form.tsx`
- `apps/dashboard/components/sign-in.tsx`
- `apps/dashboard/lib/backend.ts`
- `apps/dashboard/lib/body.ts`
- `apps/dashboard/lib/paths.ts`
- `apps/dashboard/lib/presentation.ts`
- `apps/dashboard/lib/server-only.d.ts`
- `apps/dashboard/lib/server.ts`
- `apps/dashboard/lib/session.ts`
- `apps/dashboard/next.config.ts`
- `apps/dashboard/package.json`
- `apps/dashboard/test/body.test.ts`
- `apps/dashboard/test/render.test.ts`
- `apps/dashboard/test/session.test.ts`
- `apps/dashboard/tsconfig.json`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DECISIONS.md`
- `docs/MASTER_PLAN.md`
- `docs/PHASE_7_VALIDATION.md`
- `docs/SECURITY.md`
- `docs/phases/07-dashboard.md`
- `docs/runbooks/dashboard.md`
- `infrastructure/nginx/roco-seo.conf`
- `package.json`
- `packages/agents/package.json`
- `packages/db/package.json`
- `packages/db/src/control-repository.ts`
- `packages/db/src/index.ts`
- `packages/shared/package.json`
- `packages/shared/src/control.ts`
- `packages/workflow/package.json`
- `packages/workflow/src/contracts.ts`
- `pnpm-lock.yaml`
- `tests/e2e/control.spec.ts`
- `tests/e2e/fixture.ts`
- `tests/e2e/playwright.config.ts`
- `tests/integration/control.integration.test.ts`
- `tests/tsconfig.json`
