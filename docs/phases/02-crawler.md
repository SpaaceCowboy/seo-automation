# Phase 2 - SEO Crawler and Technical SEO Engine

Status: Implemented and ready for review.

## Objective

Build a safe, deterministic crawler that creates historical observations and reproducible technical SEO findings.

## In scope

- Site crawl policies, frontier, URL normalization/versioning, deduplication, and cancellation
- HTTP fetcher with rate/concurrency limits, timeouts, size limits, retries, and redirect tracing
- robots.txt and sitemap discovery/parsing with historical observations
- Cheerio extraction for metadata, headings, schema types, breadcrumbs where detectable, images, links, and content fingerprints
- Explicit, budgeted Playwright fallback criteria
- Crawl runs, page identities/snapshots, link edges, robots/sitemap observations, and analysis persistence
- Deterministic rules for status, redirects, canonical, robots/indexability, metadata, headings, schema presence, missing alt, thin/duplicate content signals, broken links, crawl depth, and orphan pages
- Run comparison, issue evidence, resolution/reopen derivation, and structured crawl/issue summaries

## Out of scope

- GSC, GA4, and PageSpeed APIs
- Semantic intent/content judgments
- LLM calls and recommendations
- Production mutations

## Acceptance criteria

- Fixture sites cover 2xx/3xx/4xx/5xx, chains/loops, canonical variants, meta/X-Robots directives, robots rules, sitemap indexes, malformed HTML/XML, duplicate metadata, graph depth, and orphan detection.
- Every fetch attempt produces an attributable run/snapshot result, including safe structured failures.
- Re-running the same crawl creates a new historical run without overwriting the earlier snapshot or link graph.
- A comparison test identifies added/removed links and changed metadata, canonical, indexability, status, and content fingerprints.
- URL normalization tests cover fragments, case/ports, trailing paths, query policy, percent encoding, and Persian/Unicode URLs.
- Scope and SSRF tests prevent crawling unexpected hosts, private addresses, metadata endpoints, and out-of-policy redirects.
- Rate, concurrency, URL-budget, depth, response-size, timeout, cancellation, and robots controls are verified.
- Playwright is not used for ordinary static fixtures and is invoked only under documented fallback rules.
- Issue output includes stable code, severity, evidence, rule version, page/run provenance, and remediation text.
- Crawler restarts/retries do not create duplicate observations inside the same logical run.
- Representative historical and link-graph queries meet an agreed baseline on a production-like fixture volume.
- Tests, typecheck, lint, and build pass; crawler operations and rule catalog are documented.

## Human inputs required

- Approved production/staging origins, host scope, crawl rate/window, URL budget, user agent, robots policy, query-parameter policy, and raw HTML retention

## Exit artifact

A controlled baseline crawl report, rule coverage matrix, load/safety evidence, known false positives, and an explicit stop before Phase 3.

## Implementation evidence

- Ten-page controlled production crawl completed with concurrency 1 and 0.5 requests/second.
- A second three-page crawl created an independent run and snapshot/link history.
- Fixture tests cover normalization, Unicode, scope/SSRF, robots, sitemap indexes, malformed documents, HTML extraction, redirects/loops, response budget, timeout, retries/rate, cancellation, indexability, graph metrics, orphan detection, snapshot comparison, API commands, and worker lifecycle.
- PostgreSQL integration tests apply both migrations and verify same-run idempotency plus independent cross-run snapshots, links, and issue occurrences.
- A rolled-back 1,000-page/10,000-edge PostgreSQL fixture completed the representative incoming-link aggregation in 2.342 ms on the development machine.
- Raw HTML is not retained. Browser fallback is disabled because no allowlist was approved.
- Rule catalog: `docs/TECHNICAL_SEO_RULES.md`; operations: `docs/runbooks/crawling.md`.

Production/staging crawl cadence, larger URL budgets, crawl windows, query-parameter exclusions, and any Playwright allowlist remain human-controlled follow-up decisions. Phase 3 remains unapproved and unimplemented.
