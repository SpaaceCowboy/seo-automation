# Roco SEO Master Plan

## 1. Purpose

Roco SEO is an internal decision system that continuously detects SEO conditions, combines technical and Google performance data, prioritizes opportunities, produces reviewable recommendations, records approved changes, and measures outcomes.

The governing loop is:

`Detect -> Understand -> Prioritize -> Recommend -> Approve -> Execute -> Measure -> Learn`

The existing RocoBroker website remains the production delivery system. Roco SEO operates alongside it. The MVP does not automatically modify the website.

## 2. Source of truth and scope

The product source of truth is `docs/reference/Roco_SEO_Automation_Proposal_FA_Detailed.pdf` (version 1.0, dated 2026-08-27). This plan translates the proposal into engineering requirements. It deliberately does not promise a fixed traffic increase or ranking outcome.

### In scope for the MVP

- Repeatable crawling and historical page snapshots
- Deterministic technical SEO analysis
- Internal-link graph and orphan detection
- Google Search Console, GA4, and PageSpeed ingestion
- Opportunity detection and configurable scoring
- Provider-independent, schema-validated semantic analysis
- Recommendations and human approval
- Change Ledger and 30/60/90-day measurements
- Private operational dashboard, reports, and alerts

### Out of scope for the MVP

- Website redesign
- Bulk AI content publishing
- Unreviewed production changes
- Automatic URL changes, deletions, major redirects, or major rewrites
- Ranking or traffic guarantees
- A general-purpose CMS or enterprise workflow suite

## 3. Engineering requirements

### Functional requirements

| ID     | Requirement                                                                                                                                                      | Primary phase |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| FR-001 | Register one or more sites with canonical host, crawl policy, and timezone.                                                                                      | 1             |
| FR-002 | Schedule, start, cancel, retry, and observe durable background jobs.                                                                                             | 1             |
| FR-003 | Create an immutable crawl run and page snapshot for every fetch attempt.                                                                                         | 2             |
| FR-004 | Capture status, redirects, headers, canonicals, robots directives, metadata, headings, schema, images, content fingerprint, response time, and discovered links. | 2             |
| FR-005 | Parse robots.txt and XML sitemaps and retain observations by run.                                                                                                | 2             |
| FR-006 | Deterministically calculate indexability, broken links, redirect chains/loops, duplicate metadata, crawl depth, orphan pages, and technical issues.              | 2             |
| FR-007 | Preserve link edges and issue occurrences so two runs can be compared.                                                                                           | 2             |
| FR-008 | Import historical GSC page/query/country/device metrics idempotently.                                                                                            | 3             |
| FR-009 | Import organic landing-page and engagement metrics from GA4 idempotently.                                                                                        | 3             |
| FR-010 | Import mobile and desktop PageSpeed/Core Web Vitals measurements with provenance.                                                                                | 3             |
| FR-011 | Detect quick wins, CTR opportunities, content gaps, cannibalization, decay, and internal-link opportunities.                                                     | 4             |
| FR-012 | Score opportunities using configurable Search Demand, Impact, Confidence, Effort, and Business Value inputs and retain the scoring version.                      | 4             |
| FR-013 | Expose a provider-neutral LLM interface with usage, latency, model, prompt/schema version, and cost metadata.                                                    | 5             |
| FR-014 | Return only schema-validated agent results; invalid results fail safely and cannot create executable actions.                                                    | 5             |
| FR-015 | Coordinate Technical SEO, Opportunity/Keyword, Content, and Internal Linking analysis through an SEO Supervisor.                                                 | 5             |
| FR-016 | Create versioned recommendations with rationale, evidence, confidence, risk, proposed before/after values, and target.                                           | 6             |
| FR-017 | Require attributable approval decisions and special handling for high-risk actions.                                                                              | 6             |
| FR-018 | Record execution as a separate, attributable Change Ledger event; approval alone does not imply execution.                                                       | 6             |
| FR-019 | Capture baselines and schedule 30/60/90-day measurements with positive, neutral, negative, insufficient-data, or reverted outcomes.                              | 6             |
| FR-020 | Present crawl health, performance, issues, opportunities, approvals, ledger events, alerts, and measurements in a private dashboard.                             | 7             |
| FR-021 | Generate weekly/monthly reports and immediate alerts for defined critical regressions.                                                                           | 7             |
| FR-022 | After explicit approval, allow only allowlisted low-risk automation with dry-run, idempotency, audit, rate limits, and a kill switch.                            | 8             |

### Non-functional requirements

| ID      | Requirement                                                                                        |
| ------- | -------------------------------------------------------------------------------------------------- |
| NFR-001 | Historical records are append-oriented; derived current views must not erase source observations.  |
| NFR-002 | Imports and jobs are idempotent under retries and duplicate delivery.                              |
| NFR-003 | All external calls have bounded timeouts, rate limits, retry policy, and structured failure data.  |
| NFR-004 | Logs correlate job, run, site, and request identifiers without leaking secrets.                    |
| NFR-005 | All external payloads and agent outputs are runtime-validated.                                     |
| NFR-006 | Production website access is read-only throughout the MVP.                                         |
| NFR-007 | Credentials follow least privilege and are isolated by component and environment.                  |
| NFR-008 | The system can run on the existing VPS using Docker Compose, PostgreSQL, and Nginx.                |
| NFR-009 | Configuration is environment-driven and documented in `.env.example` when application code begins. |
| NFR-010 | Database migrations are forward, reviewable, tested, and never silently destructive.               |
| NFR-011 | Retention and deletion policies preserve business history while limiting unnecessary raw payloads. |
| NFR-012 | Opportunity and recommendation decisions retain evidence and algorithm/model version provenance.   |

## 4. Delivery phases

| Phase | Outcome                                                     | Explicit exclusions                   |
| ----- | ----------------------------------------------------------- | ------------------------------------- |
| 0     | Approved engineering specification and phase gates          | Runtime implementation                |
| 1     | Runnable, observable monorepo foundation                    | Crawling and external integrations    |
| 2     | Historical crawler and deterministic technical SEO engine   | Google APIs and LLMs                  |
| 3     | Reliable Google data ingestion                              | Opportunity scoring and agents        |
| 4     | Deterministic opportunities and configurable prioritization | Recommendation generation             |
| 5     | Provider-neutral, validated agent analysis                  | Approval/execution workflow           |
| 6     | Recommendations, approval, ledger, and measurement loop     | Dashboard polish and automatic writes |
| 7     | Private SEO Control Center                                  | Production automation                 |
| 8     | Narrow, controlled low-risk automation                      | High-risk autonomous change           |

Detailed scope and acceptance criteria are in `docs/phases/`.

## 5. Global definition of done

A phase is complete only when:

- Its documented acceptance criteria are demonstrated.
- Tests, typecheck, and lint pass.
- Database migrations and operational runbooks are updated when relevant.
- Security and privacy implications are reviewed.
- Documentation matches the implementation.
- Known problems and deferred work are reported.
- The implementation stops at the phase boundary pending human approval.

## 6. Risks and open decisions

### Major risks

- Incorrect canonical/indexability logic could generate misleading priorities.
- Unbounded crawling or dynamic rendering could overload RocoBroker or the VPS.
- GSC row limits, aggregation, and delayed data can distort conclusions.
- GA4 attribution definitions can differ from GSC page/query reporting.
- PageSpeed variability requires multiple samples or cautious interpretation.
- Sparse early data can produce false confidence; minimum evidence gates are required.
- Semantic agents can hallucinate or propose unsafe changes; all outputs need evidence, schemas, and approval.
- Measurement can confuse correlation with causation when several changes overlap.
- URL normalization mistakes can fragment or incorrectly merge history.
- Persian/English content and locale handling may affect normalization and intent analysis.

### Human decisions required before or during Phase 1

1. Confirm production and staging origins, canonical host rules, supported locales, and whether subdomains belong to the same site.
2. Confirm expected URL count, normal crawl cadence, allowed crawl windows, and acceptable request rate.
3. Select private-dashboard authentication: reverse-proxy SSO, identity-aware proxy, or application authentication.
4. Confirm VPS operating system, CPU/RAM/storage, PostgreSQL placement, backup target, and deployment process.
5. Name the initial operators, approvers, and special approvers for high-risk changes.
6. Define retention for raw HTML, API payloads, and detailed query data.
7. Confirm GSC properties, GA4 property/data stream, service-account/OAuth ownership, and PageSpeed quota strategy.
8. Confirm the production CMS/change mechanism for later manual execution and Phase 8 evaluation.
9. Define business-value inputs and which page types are commercially critical.
10. Decide whether raw HTML should be stored at all; the recommended default is fingerprints plus selected extracted fields, with optional short-lived compressed HTML for diagnosis.

## 7. Recommended Phase 1 objective

Create the monorepo foundation, shared configuration and validation, PostgreSQL/Drizzle migration system, pg-boss connection, Fastify health/readiness API, worker health and example no-op job, Next.js dashboard shell, structured logging, Docker Compose development environment, CI-quality checks, and operational documentation. Do not crawl the website in Phase 1.

## 8. Current delivery boundary

Phases 1–7 have been completed and approved by the user. Phase 7.5 hardening and private VPS deployment are implemented; full live acceptance remains pending real Google access and the dependent opportunity/recommendation checks. The Supervisor-only provider connection and $20 policy are installed; semantic inference evaluation remains pending genuine source data. Operational instructions are in `OPERATIONS.md`; real validation evidence and remaining blockers are recorded in `PHASE_7_5_VALIDATION.md`. Phase 8 remains unapproved and unimplemented.

The current Phase 7 instruction explicitly limits alerts to existing domain data. New critical-regression alert rules and scheduled report delivery from FR-021 are deferred for a separately approved scope; the dashboard exposes existing operational failures, technical findings and selectable performance windows. This is an explicit MVP limitation, not evidence that those new rules have been implemented.

## Initial AI rollout clarification

The original proposal's section 22 recommends activating the SEO Supervisor first, then adding specialists after MVP value is demonstrated. The five implemented roles remain available for staged future activation. On 2026-10-08 the user authorized only Supervisor activation with GPT-6.1 Sol, medium reasoning and a $20 monthly cap. Keyword/Technical preference is GPT-6 Luna for a later stage; Content/Internal Linking remain deferred. No automatic site execution is authorized.
