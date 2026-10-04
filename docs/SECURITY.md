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
