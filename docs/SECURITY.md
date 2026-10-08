# Security

## 1. Security objectives

Protect production availability, Google data, credentials, recommendation integrity, and the human approval boundary. The MVP is an analysis system and has no production-write capability.

## 2. Trust boundaries

| Boundary                        | Required control                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Internet -> Nginx/API/dashboard | TLS, authentication, authorization, request limits, secure headers                   |
| Worker -> RocoBroker            | Read-only HTTP, scoped hosts, rate limits, SSRF controls, identifiable user agent    |
| Worker -> Google APIs           | Least-privilege OAuth/service account, encrypted secret storage, quota controls      |
| Apps -> PostgreSQL              | Private network, per-service credentials where practical, TLS if traffic leaves host |
| Application -> LLM provider     | Data minimization, provider abstraction, timeouts, logging redaction, no secrets     |
| Recommendation -> execution     | Human approval, immutable versions, attributable execution, no implicit write        |

## 3. Secrets

- Never commit API keys, OAuth client secrets, refresh tokens, database passwords, service-account JSON, session secrets, or production credentials.
- Local and deployed secrets come from environment injection or an approved secret manager.
- `.env.example` contains names and safe descriptions only.
- Rotate credentials after suspected exposure and record the incident without copying the secret into tickets or logs.
- Store only integration account identifiers in PostgreSQL; secret material is referenced externally.

## 4. Authentication and authorization

The dashboard is private. Phase 1 must select and document an authentication method before exposing it beyond localhost. Initial roles:

- `VIEWER`: read health, reports, issues, opportunities, and ledger
- `OPERATOR`: trigger/cancel approved read-only jobs and manage routine configuration
- `APPROVER`: approve/reject normal recommendations
- `SPECIAL_APPROVER`: approve high-risk/manual recommendations
- `ADMIN`: manage actors, roles, integrations, and security settings

Enforce authorization server-side. The UI is not a security boundary. Record authentication-sensitive and workflow actions in `audit_events`.

## 5. Crawler protections

- Allow only configured HTTP/HTTPS hosts and ports.
- Reject loopback, link-local, private, metadata-service, and unexpected network destinations unless explicitly approved for a controlled environment.
- Revalidate scope after redirects and DNS changes.
- Apply per-host concurrency, delay, timeout, response-size, URL-count, and depth limits.
- Respect robots.txt by default and document any approved exception.
- Do not submit forms, execute mutations, accept arbitrary credentials, or crawl logout/action URLs.
- Treat crawled HTML, structured data, and linked URLs as untrusted input.
- Sandboxed Playwright contexts have bounded lifetime and restricted downloads/navigation.

## 6. Input, output, and LLM safety

- Validate environment, API, queue, Google, crawler, and LLM payloads with schemas.
- Escape or safely render all crawled and model-generated text in the dashboard.
- Treat page content as data, never instructions.
- Agents receive minimized structured evidence, not unrestricted secrets or database access.
- Agent output must pass schema and policy checks. Failure produces no recommendation/action.
- Store prompt, schema, provider, model, and policy versions for audit without logging secrets.
- Apply monthly and per-job cost/token caps.

## 7. Approval and change integrity

- Approval is tied to an immutable recommendation version. Editing a proposal creates a new version and invalidates prior approval.
- Execution is separate and records actor, time, exact before/after values, and external reference.
- During the MVP, execution is manual and outside the analysis components.
- High-risk actions require special approval and remain manual.
- Reverts never erase the original ledger entry; they append a linked event.

## 8. Logging and privacy

- Use structured logs with safe error codes and correlation IDs.
- Redact authorization headers, cookies, tokens, database URLs, and secret environment values.
- Avoid raw page content and full query exports in logs.
- Limit detailed GSC query and analytics data to authorized internal users.
- Define retention for raw HTML/API responses before collection begins.

## 9. Infrastructure

- PostgreSQL is not publicly exposed.
- Nginx terminates TLS and proxies only required routes.
- Containers run as non-root where supported, with read-only filesystems and limited capabilities where practical.
- Pin dependency versions and scan dependencies/container images in CI when introduced.
- Backups are encrypted and restore-tested.
- Separate development, staging, and production credentials/data.

## 10. Future controlled automation

Phase 8 requires a new threat review. The executor must be separately deployed with narrowly scoped write credentials, allowlisted action types and targets, dry-run/diff output, idempotency keys, rate and daily limits, dual approval where appropriate, signed/audited commands, rollback support, and a global kill switch. Analysis workers must not inherit executor credentials.

## 11. Incident handling

1. Stop affected schedules or activate the relevant kill switch.
2. Revoke/rotate exposed credentials.
3. Preserve logs and audit evidence.
4. Assess production availability and data exposure.
5. Restore from known-good state where needed.
6. Document root cause, corrective actions, and prevention tests.

## 12. Phase 3 Google credential controls

- `GOOGLE_CREDENTIALS_FILE` references a service-account JSON file mounted or stored outside the repository. Secret JSON, private keys, OAuth tokens, and PageSpeed keys are never stored in PostgreSQL.
- The service account uses only `webmasters.readonly` and `analytics.readonly`; its email must be granted read access to the specific configured properties.
- Access tokens are generated by the worker, cached only in memory, and redacted from logs. The API process records only the external credential reference and cannot exchange tokens.
- PageSpeed can run without a key for limited validation. When used, `PAGESPEED_API_KEY` must be restricted to the PageSpeed Insights API and appropriate server/network restrictions.
- Google response bodies are runtime-validated but not retained raw. Logs contain provider/status metadata and safe errors, not authorization headers or detailed query exports.

## 13. Phase 4 opportunity boundary

Every Phase 4 route requires the separate `OPPORTUNITY_API_TOKEN`; missing configuration fails closed. Tokens are compared through constant-time fixed-size SHA-256 digests and authorization headers remain redacted. `OPPORTUNITY_ACTOR_ID` binds operator lifecycle decisions to an active registered actor; actor identity cannot be supplied by the caller. Expected-status checks prevent stale decisions from overriding current state, and decisions append to `audit_events`.

This operator credential does not implement multi-user sessions/roles or secure older Phase 1–3 routes. Keep the deployment private/localhost until full authentication is approved. The engine has no external credentials, network calls, write tools, prompts or agents. The validator uses PostgreSQL READ ONLY and stores detailed query evidence only in an ignored mode-0600 local report; console output is limited to counts and coverage.

## 14. Phase 5 agent controls

Phase 5 has its own high-entropy bearer credential and configured active operator identity. All reads and triggers/retries are authenticated; callers cannot supply actor/model/prompt/pricing/execution fields. Broader session/role and older-route protection remain required before public exposure.

Only the worker consumes `LLM_OPENAI_API_KEY`. The real adapter has a fixed HTTPS origin, disabled redirects, no tools and bounded request/response lifetime. Ambient credentials do not trigger spending. Explicit model/pricing/cost configuration and `AGENTS_ENABLED=true` are required; unknown model routing/pricing fails closed.

Providers receive capped selected facts and page/query context, not raw HTML, credentials, complete histories or database access. URLs and common sensitive text patterns are minimized. Page and specialist text is untrusted data separated from system policy. This minimizer is not an exhaustive PII detector; provider/data-processing scope still needs human review.

Exact fact copies, known reference/target/link identities, role action allowlists, risk floors, confidence ceilings and DRAFT/non-executable status are checked before persistence. Rejected raw responses/prompts are not retained or logged. Queue failures deliberately preserve only classified safe causes; original provider/database exceptions may contain sensitive payloads.

Shared transactional reservations bound configured-price estimates; frozen history and persisted retry classifications prevent unlimited restart replays. Refusals and non-retryable failures require a new reviewed run. Paid-call ambiguity is charged conservatively. Semantic inference, multilingual unsupported prose and provider invoice accuracy cannot be completely verified by these checks; reviewed live evaluations remain necessary. No production write, approval, ledger executor or measurement capability exists.

## 15. Phase 6 human workflow controls

`WORKFLOW_ACCESS_JSON` supplies secret high-entropy credentials, named actor UUIDs and explicit roles. Tokens are constant-time compared as SHA-256 digests in memory and never stored in SQL/audit records. Unconfigured registry fails closed; callers cannot pass reviewer/implementer/role authority. Revoked actors are rejected. ADMIN has no implicit business approval authority.

Business mutations require HUMAN actors. HIGH/SPECIAL_APPROVAL review requires SPECIAL_APPROVER; model risk claims and stale approvals cannot bypass that check. Approval binds to an immutable version and any revision requires fresh approval. Implementation requires matching approved before/after values, human attestation/time/reference and no future/pre-approval timestamps. Database guards supplement API checks.

Scheduled measurements use an active SERVICE identity and durable definitions; they only read stored observations and append results. No LLM, website fetch/write, approval, publication or rollback is invoked by these jobs. Reverts/corrections are human records, not commands. Logs include safe identifiers/status/timing instead of notes, changed content, tokens or raw model bodies.

SANDBOX records remain explicitly separate from PRODUCTION; overlap analysis does not mix modes. Result classification is associative, with sufficiency/overlap/identity warnings and no causal claim. Role/session/SSO/public rollout, broader site-specific permissions and outbound alert channels remain explicit deployment/Phase 7 decisions.

## 16. Phase 7 private application sessions

The user selected existing named credentials plus secure sessions. The Next process stores the bearer secret server-side behind a random 256-bit opaque session cookie, HttpOnly/SameSite=Strict and Secure for HTTPS. Sessions expire after eight hours, sign-out revokes the stored session and process restart clears all sessions. Active HUMAN identity and current API roles are checked on every read/mutation; revoked actors/credentials cannot continue through an old session. Successful sign-in/sign-out and workflow actions are attributable audit events. Failed authentication returns safe status codes and API request correlation without credential/body logging.

Exact configured origin plus session CSRF nonce protects mutations. The BFF has an explicit path/method allowlist, fixed internal origin, bounded streamed bodies/query strings, no redirects/cache and an eight-second timeout. Read SQL is parameterized, site scoped and paginated; expensive projections have a five-second statement timeout. React escapes all provider/page/user text; raw prompts and provider secrets are not returned. Frame denial, no-sniff/no-referrer/noindex headers supplement the private boundary.

The deployment must use one dashboard process: bounded session/throttle state is not shared between replicas (200 sessions; 20 login attempts per minute globally). Durable shared sessions, MFA/SSO, a production nonce-based CSP and per-site roles remain hardening decisions. Configured roles currently read all registered sites. Never expose Fastify directly or deploy the inactive Nginx baseline remotely without TLS, an exact HTTPS origin, access review and rate/request controls. Defaults bind to localhost. The API protects older Phase 1–3 domain routes with named human roles; existing private Phase 4/5 bearer routes keep their own authentication. No production website credentials or write adapters exist.

API request logs use the matched route template, status, latency and request correlation rather than raw query strings, IPs, body/parser exceptions or caller URLs. This prevents page filters or malformed JSON from leaking sensitive text into logs. Client parser failures return safe 4xx responses; unclassified failures retain a logged safe code and 500 response. Dashboard measurement source-ID arrays cap at 100 per group/sample with original counts; full provenance remains in storage/Phase 6 audit reads.

## Phase 7.5 deployed controls

The initial deployment used an SSH tunnel. The user subsequently authorized `scc.rocobroker.com` on 2026-10-08: only the authenticated dashboard/BFF is now served through Nginx on HTTPS, with HTTP redirected for this hostname. Database and Fastify listeners remain private; VPS administration uses SSH keys. Secure HTTP-only SameSite=Strict cookies, exact-origin mutation checks, rate limits, hostname checks, noindex and hostname-scoped HSTS protect the new ingress. Certbot webroot renewal reloads Nginx after validation; only the domain certificate directories are mounted in the proxy. Secrets are external files scoped by process. Node services run as non-root with read-only application files, dropped capabilities and resource caps. PostgreSQL application login is not a superuser. OAuth token exchange accepts only the fixed Google endpoint; redirects, time, response sizes and import cardinality are bounded. Central log serializers remove raw exception messages/stacks and Nginx omits request URLs/IPs. See `OPERATIONS.md` for rotation, file modes, offline recovery keys and remaining offsite/monitoring limitations. These controls are not an independent security certification.

## Integration status boundary

Provider keys remain worker-only. Status/check responses are strict whitelisted DTOs; no credentials, paths, raw provider bodies or full policy/environment are returned. Manual checks require an active HUMAN OPERATOR and BFF origin/CSRF validation; reads retain named read authorization. Fixed-origin metadata requests have bounded time/bytes, no redirects/retries and do not request inference. Manual requests are audited; terminal check history is immutable. See `INTEGRATIONS_STATUS.md`.
