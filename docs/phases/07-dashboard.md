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
- Critical alert rules cover widespread 5xx, unintended noindex, sitemap removal, 404 growth, important canonical change, and severe commercial-page decline.
- Weekly/monthly reports use documented metric definitions and do not imply guaranteed causality.
- Keyboard navigation, focus, labels, contrast, and responsive layouts pass agreed accessibility checks.
- Large lists are paginated/filtered server-side and key views meet an agreed performance budget.
- End-to-end tests cover authentication, permissions, evidence navigation, approval, and ledger/measurement review.
- Tests, typecheck, lint, and build pass; operator/user documentation is updated.

## Human inputs required

- Brand/UI constraints, authentication choice, dashboard users/roles, alert channels, critical-page definitions, and report recipients

## Exit artifact

A private control-center acceptance walkthrough, access review, alert/report examples, known UX gaps, and an explicit stop before Phase 8.
