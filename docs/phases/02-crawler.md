# Phase 2 - SEO Crawler and Technical SEO Engine

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
