# Roco SEO - Agent Instructions

## Product boundary

Roco SEO is an internal SEO intelligence and automation layer for the existing RocoBroker website. It is not a website redesign and must remain operationally separate from the production website.

The product-level source of truth is `docs/reference/Roco_SEO_Automation_Proposal_FA_Detailed.pdf`. Engineering interpretation lives in `docs/MASTER_PLAN.md`, with detailed design in the remaining `docs/` files. If implementation and documentation disagree, treat that as a defect.

## Delivery rule

Work only on the explicitly approved phase. Never continue automatically to another phase.

At the end of every implementation task:

1. Run tests.
2. Run typecheck.
3. Run lint.
4. Update affected documentation.
5. Report completed work, files changed, tests, architecture decisions, risks, documentation updates, and the next recommended step.
6. Stop and wait for approval.

## Engineering principles

- Prefer deterministic software for crawling, HTTP, redirects, canonicals, robots directives, sitemap validation, metadata checks, duplicate detection, broken links, crawl depth, orphan detection, internal-link graphs, and technical SEO rules.
- Use LLMs only where semantic judgment adds value. Never let unvalidated free-form model output trigger an action.
- Validate agent inputs and outputs with Zod or an equivalent schema layer.
- Keep the LLM layer provider-independent.
- Preserve history. Crawl runs, page snapshots, link observations, issues, Google metrics, recommendations, approvals, changes, and measurements must be append-oriented and comparable across time.
- During the MVP, no component may write to the production website. Recommendations require human approval. URL changes, deletion, major redirects, and major rewrites require special manual control.
- Use least privilege. Keep analysis credentials separate from any future production-write credentials. Never commit secrets.
- Keep infrastructure appropriate for the existing VPS. Use the approved stack unless a different choice is documented in `docs/DECISIONS.md` with rationale and tradeoffs.
- Jobs must expose structured logs, timestamps, status, retry behavior, and failure information.
- Make every retryable import or job idempotent.

## Approved stack

- TypeScript and Node.js
- pnpm workspace
- Next.js dashboard
- Fastify API
- PostgreSQL and Drizzle ORM
- pg-boss for jobs and schedules
- Cheerio for normal HTML parsing
- Playwright only as a controlled rendering fallback
- Zod for runtime validation
- Pino for structured logs
- Docker Compose and Nginx for deployment

## Repository boundaries

- `apps/`: deployable API, worker, and dashboard processes
- `packages/`: reusable domain and infrastructure libraries
- `infrastructure/`: container, reverse-proxy, and deployment definitions
- `scripts/`: operational and development scripts
- `tests/`: cross-package integration and end-to-end tests
- `docs/`: source-controlled product and engineering documentation

Avoid importing from one app into another. Shared behavior belongs in a package. Keep crawling and analysis code independent from dashboard concerns.

## Security constraints

- Secrets belong in environment variables or a secret manager; only placeholder names belong in `.env.example`.
- Do not log authorization headers, OAuth tokens, page content containing personal data, or raw model prompts containing secrets.
- Dashboard and mutation endpoints require authentication and authorization.
- Approval and ledger events must be attributable and auditable.
- Any future production executor must be a separately deployed component with narrowly scoped credentials and an explicit kill switch.

## Development phases

0. Project specification and documentation
1. Foundation
2. SEO crawler and technical SEO engine
3. Google Search Console, GA4, and PageSpeed
4. Opportunity Engine
5. Agent layer
6. Recommendations, approvals, Change Ledger, and measurement
7. Private SEO Control Center dashboard
8. Controlled automation

The acceptance criteria for each phase are defined in `docs/phases/`.

## Required completion report

Use these headings:

- Completed
- Files Changed
- Tests
- Architecture Decisions
- Problems / Risks
- Documentation Updated
- Next Recommended Step

Then stop.
