# Architecture Decision Log

`Accepted` decisions govern implementation. `Proposed` decisions require validation or human confirmation before becoming binding.

## ADR-001: TypeScript pnpm monorepo

- Status: Accepted
- Decision: Use TypeScript/Node.js in a pnpm workspace with deployable apps and reusable packages.
- Rationale: Shared schemas and types reduce contract drift while keeping deployment boundaries explicit.
- Alternatives: Multiple repositories; a single application package.
- Tradeoffs: Easier reuse and coordinated changes, at the cost of workspace tooling discipline.

## ADR-002: PostgreSQL as system of record and job backend

- Status: Accepted
- Decision: Use PostgreSQL with Drizzle ORM for domain data and pg-boss for durable jobs/schedules.
- Rationale: Fits the existing VPS and avoids operating Redis or a separate queue for the MVP.
- Alternatives: Redis/BullMQ, managed queues, cron-only scheduling.
- Tradeoffs: Lower operational complexity; queue load and domain workload must be monitored on the same database.

## ADR-003: Historical append-oriented observations

- Status: Accepted
- Decision: Keep stable identities separate from immutable or append-oriented run observations. Current state is derived.
- Rationale: The proposal requires comparison between dates and measurable outcomes.
- Alternatives: Overwrite current page rows; external event store.
- Tradeoffs: More storage and careful indexes, in exchange for auditability and reproducibility.

## ADR-004: Deterministic analysis before LLM analysis

- Status: Accepted
- Decision: HTTP, redirect, canonical, robots, sitemap, metadata, link graph, crawl depth, orphan, and technical validation logic is normal tested code.
- Rationale: These checks are reproducible and cheaper without model calls.
- Alternatives: General agent-driven crawling/analysis.
- Tradeoffs: More explicit rule maintenance; much higher predictability, explainability, and cost control.

## ADR-005: Provider-neutral LLM port with schema validation

- Status: Accepted
- Decision: Agents use an internal provider interface and versioned Zod schemas. Invalid output fails closed.
- Rationale: Avoid provider lock-in and prevent free-form output from driving workflows.
- Alternatives: Direct provider SDK calls throughout agents; unstructured text parsing.
- Tradeoffs: Adapter and schema maintenance, offset by portability and safety.

## ADR-006: No production writes in the MVP

- Status: Accepted
- Decision: The MVP produces recommendations, approvals, and execution records but has no production website write credential or code path.
- Rationale: Human control is a core product requirement and reduces early operational risk.
- Alternatives: Automatic metadata/link updates from the start.
- Tradeoffs: Manual execution effort; safer validation of recommendation quality.

## ADR-007: Cheerio-first crawl with controlled Playwright fallback

- Status: Accepted
- Decision: Use standard HTTP plus Cheerio by default. Invoke Playwright only for allowlisted cases where required content cannot be observed otherwise.
- Rationale: Browser rendering is slower and more resource-intensive.
- Alternatives: Browser-only crawling; HTTP-only crawling.
- Tradeoffs: Two fetch paths require parity tests, but capacity remains manageable.

## ADR-008: Separate recommendation, approval, execution, and measurement records

- Status: Accepted
- Decision: Model these as linked, separately attributable records rather than one mutable workflow row.
- Rationale: Approval does not prove execution, and execution does not prove outcome.
- Alternatives: A single recommendation table with many mutable status/date fields.
- Tradeoffs: More joins; clearer audit and version semantics.

## ADR-009: Versioned configurable opportunity scoring

- Status: Accepted
- Decision: Store scoring weights/thresholds as immutable published configurations and retain component scores with each result.
- Rationale: The proposal requires tunable Search Demand, Impact, Confidence, Effort, and Business Value.
- Alternatives: Hardcoded formula; LLM-only prioritization.
- Tradeoffs: Configuration governance is needed; results remain reproducible.

## ADR-010: Single private control-center dashboard

- Status: Accepted
- Decision: Build one focused internal Next.js dashboard backed by a Fastify API.
- Rationale: Matches the proposal and avoids a broad admin-platform scope.
- Alternatives: Multiple dashboards; direct database BI only.
- Tradeoffs: Custom UI work; clearer workflow and access control.

## ADR-011: Raw HTML retention

- Status: Proposed
- Decision: Default to extracted typed fields and hashes. If raw compressed HTML is needed for diagnosis, keep it short-lived under an explicit retention policy.
- Rationale: Reduces storage, privacy, and sensitive-content risk while preserving change detection.
- Alternatives: Keep all HTML forever; keep none.
- Tradeoffs: Short retention may limit later parser replays. Human decision required before Phase 2.

## ADR-012: Dashboard authentication

- Status: Proposed
- Decision: Prefer an existing reverse-proxy/identity-aware SSO mechanism if the organization has one; otherwise implement application authentication with secure sessions and roles.
- Rationale: Reuse reduces identity complexity, but no existing provider is documented.
- Alternatives: VPN-only access, basic auth, bespoke credentials.
- Tradeoffs: Final choice affects deployment and audit detail. Human decision required in Phase 1.

## ADR-013: Partitioning deferred until measured

- Status: Accepted
- Decision: Start with ordinary indexed tables and measure volume/query behavior before partitioning high-volume history tables.
- Rationale: Premature partitioning complicates migrations and uniqueness.
- Alternatives: Partition all observations from day one.
- Tradeoffs: A later online migration may be required; initial development stays simpler.

## ADR-014: Future executor is a separate trust boundary

- Status: Accepted
- Decision: If Phase 8 is approved, deploy a separate executor with its own allowlisted commands and credentials.
- Rationale: Production write access must remain isolated from analysis and LLM components.
- Alternatives: Add write methods to the main worker.
- Tradeoffs: Additional deployment complexity; materially smaller blast radius.

## ADR-015: Node.js 22.12 minimum

- Status: Accepted
- Decision: Require Node.js 22.12 or newer and validate with Node.js 24 in Phase 1.
- Rationale: pg-boss 12 requires Node.js 22.12+, while Fastify 5 and Next.js 16 are compatible with this baseline.
- Alternatives: Use an older pg-boss release or replace pg-boss.
- Tradeoffs: Older VPS Node.js installations must be upgraded; the project remains on maintained runtime lines and keeps the approved queue.

## ADR-016: Local applications with Dockerized PostgreSQL during development

- Status: Accepted
- Decision: Docker Compose runs PostgreSQL only; API, worker, and dashboard run as local Node.js processes during development.
- Rationale: This keeps iteration fast, avoids unnecessary images in Phase 1, and follows the approved simple-infrastructure boundary.
- Alternatives: Containerize every application immediately; install PostgreSQL directly.
- Tradeoffs: Production application images remain future deployment work, while dependency behavior is still reproducible through the pinned workspace and PostgreSQL image.

## ADR-017: Localhost-only dashboard pending authentication decision

- Status: Accepted for Phase 1
- Decision: Bind dashboard development/start commands to `127.0.0.1`; keep the Nginx baseline inactive until authentication is selected.
- Rationale: ADR-012 remains unresolved and the private dashboard must not be exposed without authentication.
- Alternatives: Implement speculative authentication; expose through basic auth.
- Tradeoffs: Remote review requires a secure tunnel or later authentication work, but Phase 1 does not create an unsafe public surface.
