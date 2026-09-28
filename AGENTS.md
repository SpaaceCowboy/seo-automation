Roco SEO — Agent Instructions
Project
Roco SEO is an internal agentic SEO intelligence and automation system for the existing RocoBroker website.
The website already exists. This project is not a website redesign.
The intended system flow is:
Existing RocoBroker Website
→ SEO Crawler
→ PostgreSQL SEO Data Store
→ Google Search Console / GA4 / PageSpeed
→ Opportunity Engine
→ SEO Supervisor
→ Recommendations
→ Human Approval
→ Change Ledger
→ 30 / 60 / 90 day measurement
→ Feedback / Learning
The original proposal at docs/reference/Roco_SEO_Automation_Proposal_FA_Detailed.pdf is the product-level source of truth.
Core Engineering Rules
1. Work incrementally
Never attempt to build the whole system in one task.
Work only on the currently approved phase.
At the end of every phase:
1. Run tests.
2. Run typecheck.
3. Run lint.
4. Update documentation.
5. Explain what changed.
6. Explain unresolved problems.
7. STOP.
Do not start the next phase without explicit approval.
2. Deterministic code before AI
Do not use an LLM for tasks that normal software can reliably perform.
Examples that should be deterministic:
- HTTP status checks
- redirect detection and redirect chains
- canonical validation
- robots directives
- sitemap validation
- title/description presence
- duplicate metadata
- broken links
- crawl depth
- orphan detection
- internal link graph generation
- technical SEO validation
Use LLMs mainly where semantic judgment adds value, such as:
- search intent analysis
- content gap analysis
- recommendation generation
- title/meta suggestions
- semantic cannibalization analysis
- prioritization assistance
3. Historical data is mandatory
Do not store only the latest state of a page.
The system must preserve:
- crawl runs
- page snapshots
- metadata history
- canonical history
- indexability history
- internal link history
- issue history
- Google performance history
- recommendation history
- approval history
- change history
- measurement results
We must be able to compare the state of a URL between different dates.
4. Human approval is mandatory
During the MVP, agents must not directly modify the production website.
Agents produce recommendations. Recommendations enter an approval queue.
Important changes require human approval.
High-risk changes such as URL changes, page deletion, major redirects, and major rewrites must remain manually controlled.
5. Agent outputs must be structured
Agent responses must use validated schemas.
Use Zod or an equivalent validation layer.
Free-form LLM output must never directly trigger production actions.
6. LLM provider independence
Do not tightly couple the application to one AI provider.
Create a provider abstraction so models/providers can be changed without rewriting the SEO application.
7. Keep infrastructure simple
We already have a VPS. Avoid unnecessary paid infrastructure.
Preferred stack unless a strong technical reason is documented:
- TypeScript
- Node.js
- pnpm workspace
- Next.js
- Fastify
- PostgreSQL
- Drizzle ORM
- pg-boss
- Cheerio
- Playwright fallback
- Zod
- Pino
- Docker Compose
- Nginx
Do not replace a major technology without documenting the reason, alternatives considered, advantages, and disadvantages in docs/DECISIONS.md.
8. Security
Never commit:
- API keys
- OAuth secrets
- database passwords
- service account credentials
- production credentials
Use environment variables and provide .env.example when application code begins.
Production website write access must be isolated from analysis components.
9. Documentation is part of the codebase
Important architectural changes must update the relevant documentation.
Documentation that contradicts the implementation is considered a bug.
Development Phases
- Phase 0 — Project specification and documentation
- Phase 1 — Foundation
- Phase 2 — SEO crawler and technical SEO engine
- Phase 3 — Google Search Console, GA4 and PageSpeed
- Phase 4 — Opportunity Engine
- Phase 5 — Agent layer
- Phase 6 — Recommendations, approvals, Change Ledger and measurement
- Phase 7 — Private SEO Control Center dashboard
- Phase 8 — Controlled automation
Never automatically continue to the next phase.
Required Completion Report
At the end of every implementation task provide:
Completed
What was implemented.
Files Changed
Important files created or modified.
Tests
Tests that were executed and their result.
Architecture Decisions
Any architectural choices made.
Problems / Risks
Anything unresolved.
Documentation Updated
Documentation changed during the task.
Next Recommended Step
What should happen next.
Then STOP.