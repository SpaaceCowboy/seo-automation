# Phase 7.5 Production Readiness Report

Validation date: 2026-10-08 (Asia/Tehran). Scope: authorized post-MVP hardening, private deployment and live validation. Phases 1–7 are approved. Phase 8 is not authorized or implemented.

## Deployment Status

Deployed to the upgraded VPS `31.57.24.70` under `/opt/roco-seo`. Ubuntu 24.04, 2 CPUs, approximately 4 GB RAM and 40 GB disk. Final image configuration digest: `sha256:f4ae8f3369ce1a236ad1979df84a9e6f0867ac43e636ffd008e34d45392243c9`. The shared production image builds Node/TypeScript applications and Next.js for production; no development server is deployed. Initial validation used SSH forwarding. The user subsequently authorized `https://scc.rocobroker.com/sign-in`; HTTPS is deployed with the same named credential and no browser tunnel requirement. The exact site ID is `2be1e815-cd6a-479f-a18c-7bb6a9b4b166`.

Deployment and crawl work are complete. The remaining live Google, opportunity, AI and real recommendation review validations require external credentials/configuration; Phase 7.5 is therefore not fully accepted yet.

## Services

PostgreSQL, Fastify API, worker, Next dashboard and Nginx passed health checks. A one-shot migrator runs before application startup. PostgreSQL persists in a named volume; automatic process restart, dependency ordering, bounded logs, memory limits and graceful termination are configured. Operations run as an on-demand profile, rather than a public administrative endpoint.

## Security

The base deployment used loopback port 8087. The approved HTTPS overlay publishes ports 80/443 for the dashboard hostname, with HTTP redirected and ACME webroot validation available. Database, API and dashboard ports are not published. SSH uses verified key access; password authentication is disabled. Node services run as `node`, with read-only files, dropped capabilities and no-new-privileges. PostgreSQL's `roco_seo` login is neither superuser nor createdb-capable.

Named actor authentication and server-side role checks protect mutations; sessions use opaque HTTP-only cookies. Secrets are external, process-scoped mounts. Google token exchange uses a fixed endpoint, no redirects, deadlines and bounded response bytes. Error logging excludes raw messages/stacks/provider bodies, while preserving safe classifications and HTTP status. These checks do not constitute an independent security certification.

## Database / Backups

All seven existing migrations applied; no new migration was added by Phase 7.5. Encrypted custom-format database backup restored successfully into `roco_restore_drill_20261008`, with seven migration records, two initial actors, one site, one crawl run and one queue job present before fixture validation.

Daily encrypted database and separate configuration/secret archives run at 02:30 UTC (06:00 Tehran), with up to five minutes jitter and 30-day local retention. Configuration recovery was verified by decrypting its archive listing. The private recovery identity was verified against its workstation copy and removed from the VPS. Initial encrypted backups were copied off the VPS. Recurring offsite backup delivery is not configured; this remains an operational durability gap.

Restore creates a new database and refuses an existing target; it does not switch production connections. Copies of queue work are removed only from the disposable validation database before any handlers run. Database statement timeouts and bounded read queries are configured.

## Logging / Monitoring

Correlated API/domain logs, queue/run states, source freshness views and a read-only operational inspection CLI identify latest successful/failed work. Logs rotate at 10 MB × 5 per service. Worker health records event-loop freshness and database/queue connectivity every 15 seconds. Docker health status does not itself trigger a restart; crash restart is automatic. No outbound alert recipient is configured.

During the crawl, the worker used about 128 MB of its 1 GB limit. A separate origin check returned HTTP 200 in approximately 0.44 seconds. Crawl observations had median response time 1,950 ms, p95 3,959 ms and maximum 4,461 ms. These are sampled operational checks, not proof of all-user website stability.

## Google Integrations

- GSC: not configured; no real import or verified available date range/latest data date. PAGE, QUERY and PAGE_QUERY records are absent. Mapping failure results are unavailable until ingestion.
- GA4: not configured; no real import, verified date range/latest data date or mapping reconciliation.
- PageSpeed: one public mobile request for the homepage was queued as `0e9f9cbb-a9dd-42d6-9e21-9ab5709e7d86`. It failed with `GOOGLE_API_ERROR`; zero metrics were written. No PageSpeed scores are claimed. The failed run's `requestCount=0` is an incomplete-run counter, not evidence that no outbound request occurred.

Service-account setup, Search Console Restricted access, GA4 Viewer access, exact property identifiers and worker-only credential installation are documented in `OPERATIONS.md`. Google schedules remain disabled. A configured PageSpeed project/key is required before retrying its live validation. Provider data absence is never interpreted as zero traffic.

## Full Crawl Result

Pilot `b769ede7-748b-4f8f-9f6a-6c7efd3360a7`: SUCCEEDED, 30 URLs, about 62 seconds, one 404, no 5xx. Reviewed before expansion.

Bounded full run `5cc233d0-4bca-40cc-ae01-31c09c39dced`: **SUCCEEDED**. Concurrency 1, 0.5 requests/second, maximum 500 URLs, maximum depth 10, existing bounded deadlines/retries/response sizes, robots respected and rendering fallback disabled.

- Discovered URLs: 215; crawled URLs: 215; successful pages: 211.
- Indexable pages: 136; redirects: 48; HTTP 4xx: 3; HTTP 5xx: 0; noindex: 0.
- Canonical findings: 1; broken-link occurrences: 216; orphan pages within observed scope: 0.
- Missing titles: 1; duplicate-title observations: 115; missing descriptions: 1.
- Raw findings reported by the crawl summary: 1157; persisted issue occurrences after page/rule fingerprint deduplication: 674; maximum observed depth: 3; duration: 526.564 seconds (8 minutes 47 seconds).
- Failures: three 404 observations (`/documents/risk-disclosure.pdf`, `/register/trader`, `/register`) and one blocked out-of-scope MT5 download redirect. No server errors were observed.

Indexability reasons: 136 INDEXABLE, 74 CANONICAL_TO_OTHER_URL, three HTTP_404, one NON_HTML and one FETCH_FAILED. Forty-six repeated final targets account for 93 successful snapshots; redirect aliases therefore affect duplicate-title counts. Broken-link occurrences can repeat the same failing destination across many source pages: the BROKEN_INTERNAL_LINK rule affected 210 source pages, while the crawl summary counted 216 broken-link observations. META_DESCRIPTION_DUPLICATE affected 116 pages and TITLE_DUPLICATE affected 115. Treat these as reviewable observations, not unique business defects. No thresholds were changed to make results look better.

The frontier exhausted at 215 discovered URLs, below the budget. This verifies the allowed discovered graph, not guaranteed completeness of every website URL. No automated fix was applied.

## Opportunity Engine Result

Not run: the requested prerequisite of healthy crawl **and real Google data** is not met. Total opportunities, Quick Wins, CTR, Decay, Cannibalization Candidates, Internal Linking and Content Gap Candidates are unavailable, rather than asserted zero. Highest-score false-positive review remains pending real ingestion.

## AI Validation

Live semantic evaluation has not run. Following user approval, only the Supervisor is now enabled with GPT-6.1 Sol, medium reasoning and a $20 monthly cap; project-key/model metadata access passed. Specialist routes remain inactive. No ambient workstation key was used and no paid inference was initiated. Grounding, usefulness, hallucination rate, risk/confidence, token use, cost and latency need a representative 5–15 opportunity sample after real detection.

## Approval Workflow Validation

Existing tests and the isolated VPS drill verify exact-version submission/approval/rejection/request-changes, special human permissions, baseline capture and auditable history. Live review of real recommendations remains pending Google/opportunity/AI validation.

**No production website modifications occurred.** No real RocoBroker change was marked implemented. Fixture implementations and virtual metrics exist only in the disposable restored validation database; they are not real business evidence.

## Dashboard Validation

The final production browser smoke check passed named sign-in, all eleven sections, real crawl/technical data, missing-data/failure views, RTL, mobile overflow checks and HTTP-only session cookies, with zero page errors and no credential in rendered content. Local browser tests also exercise review controls, role restrictions, pagination/filtering, revocation, keyboard and mobile/RTL flows. Real recommendation/approval/measurement content remains absent until its actual prerequisite data exists.

## Job / Measurement Validation

All seven Phase 6 workflow/virtual-time measurement tests passed on the VPS against the isolated restored database. The restart reliability test passed there, preserving delayed pg-boss work and measurement plan rows while removing disabled Google schedules. The first isolated run retained four plans at each horizon. Repeating the compiled recovery runner retained eight at each of T+30, T+60 and T+90 (24 fixture plans total), with existing plan rows unchanged across restart. Fourteen remain pending: two at T+30, six at T+60 and six at T+90. Their rule-adjusted ready dates are 2026-11-11, 2026-12-11 and 2027-01-10 UTC, respectively. Idempotent dispatch/replay, immutable results and insufficient data handling were verified without waiting 30 days.

Production retains the real crawl history and separate measurement dispatcher schedule; its real measurement plans are empty because no genuine implementation has been recorded. Virtual validation does not establish a real SEO outcome.

## Tests / Build

- Unit tests: 146 passed across 29 files.
- Database integration tests: 27 passed across six sequential suites, including restart recovery.
- Local browser scenarios: four passed.
- VPS isolated workflow/recovery tests: eight passed.
- Lint, typecheck, formatting and production application/container builds passed. Final source diff whitespace check passed.
- Shell backup/restore syntax checks passed; actual encrypted backup, isolated restore and configuration decryption checks passed.

## Production Issues Fixed

Mounted secret loading and production configuration validation; Google OAuth deadlines/retries/endpoint restriction; streamed response limits and import bounds; shared Google pacing and safer finalized-date/week dispatch; stale schedule removal; crawl retry/cancellation state handling; startup cleanup and pool error handling; worker heartbeat; safe errors and provider HTTP diagnostics; explicit dashboard production origins; database timeouts; production containers, private proxy with dynamic Docker DNS and encrypted recovery tooling.

Architecture decisions are documented in ADR-040/041. No new external application dependency or schema migration was introduced. Existing workspace packages are linked for operational tooling; the approved architecture remains intact.

## Remaining Risks

### Blockers

- Missing Google service-account access, exact GSC/GA4 property configuration and usable PageSpeed project/key.
- Consequently pending real Google reconciliation, opportunity run, representative AI evaluation and real recommendation review.
- First real Supervisor inference/semantic evaluation remains pending healthy opportunity evidence; provider configuration and the approved $20 policy are now installed.

### Non-blockers for private crawl/dashboard review

- Recurring offsite backup delivery and an operator alert destination are not configured; initial encrypted offsite copies exist.
- Offline recovery identity must be archived securely by the administrator, outside ignored temporary workspace files.
- One dashboard process; restart invalidates sessions. Current read roles can view all registered sites.
- Large imports must be split into bounded windows; failed-run request counts do not include incomplete HTTP attempts.
- Bounded static crawl, duplicate aliases and repeated links require human interpretation; no guaranteed full-site completeness.

### Future improvements

Durable multi-replica sessions/MFA, automated offsite recovery/monitoring and a smaller runtime image. None authorizes Phase 8 or website execution.

## Operational Commands

Run on the VPS from `/opt/roco-seo/app`; JSON request files belong to `/opt/roco-seo/operations` and must be readable by UID 1000. The CLI loads mounted credentials; no token belongs in shell arguments.

```sh
# Deploy and migrate
./scripts/operations/compose.sh build api
./scripts/operations/compose.sh run --rm migrate
./scripts/operations/compose.sh up -d --wait api worker dashboard proxy
# Restart/status/logs
./scripts/operations/compose.sh restart api worker dashboard
./scripts/operations/compose.sh ps
./scripts/operations/compose.sh logs --tail 100 api worker dashboard proxy
# Backup and isolated restore (offline key temporarily available at the supplied path)
./scripts/operations/backup.sh
./scripts/operations/restore.sh /opt/roco-seo/backups/<dump>.dump.age /private/offline-age-identity roco_restore_drill_new
# Crawl
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/crawls /operations/full-crawl.json /operations/full-result.json
# Google sync, after actual credentials/properties are installed
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/integrations/gsc/sync /operations/gsc-page.json /operations/gsc-result.json
# Opportunity run, after healthy Google ingestion
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js opportunities POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/opportunity-runs /operations/opportunity-run.json /operations/opportunity-result.json
```

`OPERATIONS.md` includes request bodies, safe recovery validation, identity rotation, provider setup and scheduling details. Never use `down -v` or run destructive tests against the live database.

## Documentation Updated

`OPERATIONS.md`, this validation report, README, MASTER_PLAN, ARCHITECTURE, DATABASE, SECURITY, DECISIONS and the Google integration runbook. Historical phase reports remain historical evidence. The Phase 7.5 file inventory is appended below; earlier Phase 4–7 uncommitted changes were preserved.

### Phase 7.5 files changed

- `.dockerignore`
- `.env.example`
- `README.md`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/dashboard/lib/session.ts`
- `apps/worker/src/health.ts`
- `apps/worker/src/jobs/crawl-site.ts`
- `apps/worker/src/jobs/google-dispatch.ts`
- `apps/worker/src/jobs/google-sync.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/worker.ts`
- `apps/worker/test/google-dispatch.test.ts`
- `apps/worker/test/google-sync.test.ts`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/DECISIONS.md`
- `docs/MASTER_PLAN.md`
- `docs/OPERATIONS.md`
- `docs/PHASE_7_5_VALIDATION.md`
- `docs/SECURITY.md`
- `docs/runbooks/google-integrations.md`
- `eslint.config.js`
- `infrastructure/compose.env.example`
- `infrastructure/compose.production.yaml`
- `infrastructure/compose.recovery-validation.yaml`
- `infrastructure/docker/Dockerfile`
- `infrastructure/docker/postgres/init-production.sh`
- `infrastructure/nginx/roco-seo.conf`
- `infrastructure/production.env.example`
- `infrastructure/systemd/roco-backup.service`
- `infrastructure/systemd/roco-backup.timer`
- `package.json`
- `packages/config/src/index.ts`
- `packages/config/test/config.test.ts`
- `packages/config/test/secrets.test.ts`
- `packages/crawler/src/crawler.ts`
- `packages/db/package.json`
- `packages/db/src/crawl-repository.ts`
- `packages/db/src/index.ts`
- `packages/db/src/migrate.ts`
- `packages/db/src/seed-site.ts`
- `packages/integrations/src/index.ts`
- `packages/integrations/test/hardening.test.ts`
- `packages/shared/src/index.ts`
- `packages/shared/test/logger.test.ts`
- `pnpm-lock.yaml`
- `scripts/operations/api-command.ts`
- `scripts/operations/backup.sh`
- `scripts/operations/bootstrap.ts`
- `scripts/operations/compose.sh`
- `scripts/operations/healthcheck.ts`
- `scripts/operations/init-secrets.py`
- `scripts/operations/inspect.ts`
- `scripts/operations/restore.sh`
- `scripts/operations/validate-recovery.ts`
- `scripts/tsconfig.build.json`
- `tests/integration/reliability.integration.test.ts`

## MVP Readiness

**READY WITH BLOCKERS.** The private deployment, crawl, authentication, backup/restore and measurement infrastructure are usable for internal review. Required real Google, opportunity, AI and recommendation acceptance evidence remains incomplete. This is not a claim that Phase 7.5 or full live SEO operation is complete.

## Recommended Live Operation Plan

Archive the offline recovery identity and encrypted backup copies. Review the live crawl findings. Install read-only Google access and validate independent 3-day datasets, then a bounded backfill. Run real opportunity detection and inspect the highest scores. Use the approved Supervisor-only $20 policy to evaluate a small sample of grounded recommendations. Review recommendations through the human workflow without recording fictional implementation. Configure recurring offsite backups and alert ownership before relying on unattended operation. Reassess Phase 7.5 acceptance after these steps; do not start Phase 8.

## Ready for Review

Deployment/hardening is ready for review; full Phase 7.5 acceptance awaits the explicitly listed external setup and live validation. Stop at this boundary.

## HTTPS hostname follow-up — 2026-10-08

The user supplied an A record and requested `scc.rocobroker.com`. DNS resolved to `31.57.24.70`; the existing Docker Nginx now serves the authenticated dashboard at `https://scc.rocobroker.com/sign-in`. Dashboard origin is updated, sessions use Secure/HTTP-only/SameSite=Strict cookies, HTTP redirects to HTTPS, unknown hosts are rejected and noindex/HSTS are enabled for this hostname only. Fastify, PostgreSQL and the approved crawler host scope remain unchanged.

A Let's Encrypt certificate was issued, valid through 2027-01-06 06:16:23 UTC. Certbot reconfiguration successfully simulated webroot renewal. A second `renew --dry-run --run-deploy-hooks` check also passed, including successful Nginx validation and reload; the timer is enabled. Encrypted configuration backups now include `/etc/letsencrypt`. Live validation passed trusted HTTPS (200), canonical HTTP redirect (308), authenticated sign-in with the unchanged credential, all eleven dashboard sections, RTL/mobile layout, Secure/HTTP-only/SameSite=Strict session cookies and invalid-origin rejection (403), with zero browser page errors. The anonymous site-list route returned 401; direct Fastify readiness returned 404 and an unknown Host was rejected by closing the connection. All 146 unit tests, lint, typecheck, formatting and shell syntax checks passed. The encrypted archive was verified to contain certificate live/archive state without storing the offline identity on the VPS.

Files: `infrastructure/compose.https.yaml`, `infrastructure/nginx/roco-seo-https.conf`, `scripts/operations/compose.sh`, `scripts/operations/reload-tls.sh`, `scripts/operations/backup.sh`, `infrastructure/compose.env.example`, README and affected architecture/security/operations/decision documentation.

## Supervisor-first AI connection follow-up

The user approved OpenAI GPT-6.1 Sol, medium reasoning and $20/month, initially activating only the Supervisor. The key/model metadata check passed without paid inference. Supervisor-only routing, independent database budget/eligibility enforcement and prompt version v2 are implemented; see `SUPERVISOR_CONNECTION.md` for policy, deployment and validation evidence. Live opportunity/recommendation evaluation remains pending genuine Google data. This does not authorize the other four agents or Phase 8.
