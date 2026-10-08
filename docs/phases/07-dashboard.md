# Phase 7 - Private SEO Control Center

## Objective

Provide one secure, focused internal interface for monitoring, prioritization, approval, ledger review, alerts, and measured outcomes.

## In scope

- Authenticated navigation and role-aware actions
- SEO health and crawl status
- Search performance and trend views
- Technical issues with evidence/history
- Opportunity backlog and scoring explanations
- Recommendation and approval queue
- Change Ledger and measurement results
- Weekly/monthly reporting surfaces and critical alerts
- Accessibility, responsive behavior, pagination/filtering, and operational empty/error/loading states

## Out of scope

- Public pages or website redesign
- Production editing/CMS features
- Automatic approval or execution
- A general-purpose admin builder

## Acceptance criteria

- Unauthenticated users cannot access private data; role permissions are enforced by the server and reflected in the UI.
- The primary areas from the proposal are accessible in a coherent control-center navigation.
- Every issue/opportunity/recommendation view links to evidence and historical context.
- Approval displays exact version, risk, before/after proposal, confidence, and evidence; stale/superseded versions cannot be approved.
- Ledger views distinguish suggested, approved, executed, measured, and reverted states.
- Health surfaces show last successful/failed runs, freshness, partial data, and actionable failures.
- Existing technical findings and failed/partial collection runs are visible. New critical-regression/spike/commercial-page alert rules are excluded by the current Phase 7 request; the older broader criterion is explicitly deferred (ADR-039).
- Weekly/monthly date-window inspection uses documented metric definitions and does not imply guaranteed causality. Scheduled report generation/distribution is explicitly deferred under the current existing-domain scope.
- Keyboard navigation, focus, labels, contrast, and responsive layouts pass agreed accessibility checks.
- Large lists are paginated/filtered server-side and key views meet an agreed performance budget.
- End-to-end tests cover authentication, permissions, evidence navigation, approval, and ledger/measurement review.
- Tests, typecheck, lint, and build pass; operator/user documentation is updated.

## Human inputs required

- Brand/UI constraints, authentication choice, dashboard users/roles, alert channels, critical-page definitions, and report recipients

## Exit artifact

A private control-center acceptance walkthrough, access review, alert/report examples, known UX gaps, and an explicit stop before Phase 8.

## Phase 7 implementation status — 2026-10-07

Phase 6 is approved; Phase 7 is implemented and pending review. The user selected named actor credentials with secure application sessions and a compact light interface. Current scope is the private control center over the existing Phases 1–6 domains, with no Phase 8 work.

Implemented areas: overview, technical findings/crawl history, dimension-specific Google date-window views, opportunity score/evidence/history, grounded agent activity/actions, proposal creation/revision, exact-version review, human-attested implementation, Change Ledger, frozen baselines/horizon/result comparisons, existing failures and independent collection freshness. Read projections are server filtered/paginated; private sessions/CSRF and API role checks are enforced. No database/SEO/approval/measurement engine exists in React.

Acceptance evidence and practical performance/a11y limits are in `../PHASE_7_VALIDATION.md`; operating/authentication/troubleshooting is in `../runbooks/dashboard.md`. Broad critical alert/report distribution requirements remain a visible exception because the current user instruction prohibits new alert rules. Dates, samples and controlled virtual-time results establish UI behavior, not live SEO uplift or production deployment readiness. Phase 8 remains unapproved.
