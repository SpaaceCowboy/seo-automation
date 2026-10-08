# Private SEO Control Center

## Run locally

1. Use Node.js >=22.12, pinned pnpm, PostgreSQL and the existing migration/site setup in `development.md`.
2. Register active HUMAN actors using the Phase 6 workflow runbook. Configure `WORKFLOW_ACCESS_JSON` **on the API** with a different random high-entropy credential for each person and explicit roles. Never share a credential or put it in source control. ADMIN is not an implicit approver/operator.
3. Inject `DASHBOARD_ORIGIN=http://127.0.0.1:3000` and `DASHBOARD_API_URL=http://127.0.0.1:4000` into the dashboard process. Next loads its application environment, not the workspace root `.env`; export these values through the shell/service manager when changing the defaults.
4. Run `pnpm dev:worker`, `pnpm dev:api`, and `pnpm dev:dashboard` in separate terminals. Production bundles use `pnpm build`, then `pnpm --filter @roco/api start`, `pnpm --filter @roco/worker start`, `pnpm --filter @roco/dashboard start` with the same environment injection.
5. Open `http://127.0.0.1:3000`; enter the named credential. The API resolves the registered identity, checks its active HUMAN status and audits successful sign-in.

Google/LLM credentials belong to the worker. Missing Google configuration produces no successful observations; LLM use stays disabled unless separately configured. Existing collection/detection/analysis job APIs and runbooks remain the way to trigger jobs; the dashboard does not initiate paid model calls.

## Session and deployment limits

The approved sign-in approach uses existing actor credentials with secure application sessions. An opaque 256-bit session ID is stored in an HttpOnly, SameSite=Strict cookie. HTTPS origins additionally require Secure cookies. The session expires after eight hours. The credential remains in server memory, never localStorage, URLs or returned props. Sign-out revokes that session; API credential rotation or actor disablement rejects subsequent requests.

The session registry and sign-in throttle are bounded **per Next process** (200 sessions, 20 attempts/minute globally). Run one dashboard process. Restart/deploy signs everyone out. Multiple replicas, durable session recovery, MFA and enterprise SSO require a reviewed replacement session store/provider; do not enable sticky multi-process workers and assume it is shared. Credentials are high-entropy access secrets, not user-selected passwords.

For remote use, terminate TLS, set the exact HTTPS `DASHBOARD_ORIGIN`, keep Fastify/PostgreSQL private, apply proxy request/rate limits and review the access registry. The checked-in Nginx baseline sends `/api` to Next's authenticated backend-for-frontend. Never send `/api` directly to Fastify or trust caller-supplied identity headers. No remote deployment has been performed by Phase 7.

All configured roles currently read all registered sites. Site-specific tenancy is not implemented. Only active human credentials sign in. The UI and Fastify enforce the Phase 6 business permissions independently of visibility. Origin and per-session CSRF checks protect mutations. Requests are uncached; body/query limits, fixed API origin, no redirects and an eight-second upstream timeout bound the BFF. Large SQL reads have a five-second statement timeout.

## Daily operating flow

- **Overview:** latest attempt, counts from the latest successful crawl, current opportunities/reviews and recorded changes under measurement. No crawl means unavailable page/indexability/critical counts. Collection status shows latest success/failure independently.
- **Technical health / Crawl history:** filter findings by rule code, severity, page UUID, status and complete crawl UUID. Open evidence/remediation and source crawl. `OBSERVED` is present; `NOT_OBSERVED` means absent from the selected successful analysis, not proof of repair. A bounded crawl may omit a page. Partial/failed crawls stay visible in history but do not become a clean health comparison.
- **Search performance:** choose PAGE, QUERY, PAGE_QUERY, GA4 or PageSpeed and both UTC dates (1–93 days inclusive). Default is 28 days ending three days ago. Weekly/monthly inspection uses chosen date windows; there is no scheduled report distribution. PAGE metrics never include QUERY/PAGE_QUERY totals. CTR is clicks/impressions; position is impression weighted. Missing observations remain unavailable and missing trend dates are omitted. GA4 is Organic Search only and users are summed daily users, not unique period users. PageSpeed mobile/desktop and lab/field observations stay distinct.
- **Opportunities:** filter by type, status, minimum score/page and sort by score or recency. Open component scores, immutable observations and lifecycle events. Candidate status is not a confirmed semantic defect or uplift probability.
- **AI recommendations:** inspect validated specialist/Supervisor actions, facts, inferences, risk/confidence, metric and model provenance. From a draft with a concrete target, an OPERATOR can select one action and create a concrete SANDBOX or PRODUCTION-record proposal. Verify before/after, page type, topic and rationale. Complex heading/link values use bounded structured-entry fields. The backend supplies the measurement rule; the browser does not calculate it. Group-only actions without a concrete page require upstream clarification and cannot be materialized by guessing a target.
- **Review queue:** open exact current version and risk/evidence. Submit, approve, reject, request changes or cancel according to server-provided capabilities. A reason is required. Revise creates a new draft and requires fresh review. HIGH/SPECIAL_APPROVAL review requires SPECIAL_APPROVER. Refresh after stale-state/version conflicts.
- **Manual implementation:** after applying a reviewed change outside this system, an OPERATOR records the exact approved values, application timestamp in local time, external reference, notes and human attestation. Timestamp must follow approval and must not be future dated. The domain checks the values/context; approval itself performs no application.
- **Change Ledger / Measurements:** compare exact recorded values, context, actors, approval/proposal/application dates and immutable events. Inspect frozen baseline version, horizon readiness, result states and before/after metrics. A manual measurement request still requires a mature window/data lag; the worker processes accepted commands. Missing data, overlaps and changed URL identity remain conservative. Result association is not causal proof.
- **Alerts / failures:** historical FAILED/PARTIAL crawl/import and FAILED agent/opportunity runs only. Health holds existing technical findings. There are no invented spike, canonical-change, commercial-page or notification rules, no alert acknowledgement lifecycle and no outbound notification channel.
- **Data freshness:** each GSC dimension set has its own latest attempt/success/failure. The seven-day age badge is a display threshold, not an expected schedule or new alert. Compare timestamps with the source's configured cadence. NO_DATA/NO_SUCCESSFUL_DATA is not a healthy zero.

Lists default to 25, cap at 50, and paginate server-side. Detail histories cap at the existing 100-entry contract (agent output/call limits 20/50). Refresh retrieves current data; it does not run a crawler/import/agent. The interface is English with an RTL layout switch and Persian number/date formatting, not a complete Persian translation. URLs stay left-to-right; CSS uses logical spacing and native dialog keyboard/focus behavior. Reduced motion is respected.

## Troubleshooting

- **Cannot sign in:** check API availability, active HUMAN actor, credential/roles and exact origin. Unconfigured access fails closed. Never paste credentials into logs/tickets. Rate-limit denial resets after a minute.
- **Unexpected sign-out:** eight-hour expiry, service restart, explicit sign-out, rotated registry or disabled actor. Reauthenticate rather than storing a bearer token in browser storage.
- **API unavailable / read failed:** verify private API origin, API/database readiness and correlated API logs. The UI does not substitute zeros. Retry after recovery.
- **No data:** check site selection, date/filter bounds, latest successful import and collection configuration. QUERY totals may be lower/different due to Google privacy/dimension rules.
- **Review/implementation denied:** check current version/state, role and risk, actual values and timestamp. Refresh; do not bypass backend rules or change the website from the dashboard.
- **Insufficient/waiting measurement:** inspect sample dates/coverage/sufficiency, data lag, overlapping changes, URL identity and worker health. Do not label missing data neutral/negative or claim causation.

## Acceptance tests

Use a dedicated local `TEST_DATABASE_URL` ending `_test`, never a deployment database. `pnpm test:integration` applies migrations and runs the existing regression suites, which may reset test tables. `pnpm test:dashboard` builds the application and starts isolated dashboard/API listeners on ports 3017/4017 with synthetic `.example.test` fixtures. It uses the installed Chrome (`channel: chrome`) and does not call Google, an LLM or the website. Do not run integration resets concurrently with browser validation against the same database.

Screenshots are QA artifacts under ignored `tmp/`, not fragile pixel assertions. See `../PHASE_7_VALIDATION.md` for actual results, reviewed scope exceptions and Phase 7 file inventory.

Measurement source-ID arrays in dashboard detail responses cap at 100 per sample/group and retain original counts/truncation flags. Exact full source provenance remains in PostgreSQL and the existing authenticated Phase 6 history contract for deliberate audit access. Metric values and classification are never recomputed or changed by this display projection.

## Integrations

The dedicated Integrations view is available before the first AI run. Separate worker, activation, model-access, budget and sync-history indicators prevent empty analysis history from being mistaken for disconnection. OPERATOR users may check OpenAI access without paid inference; viewers have read-only access. See `../INTEGRATIONS_STATUS.md`.
