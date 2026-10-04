# Phase 6 - Recommendations, Approval, Change Ledger, and Measurement

## Objective

Complete the human-controlled decision loop from evidenced recommendation through approval, manual execution recording, and 30/60/90-day measurement.

## In scope

- Immutable recommendation versions with evidence, rationale, confidence, risk, and proposed before/after values
- Workflow states and append-only approve/reject/request-change/supersede decisions
- Role checks and special approval for high-risk changes
- Manual execution recording in the Change Ledger, including reverts/corrections
- Baseline capture, measurement plan scheduling, 30/60/90 comparisons, and outcome classification
- Audit events, notifications/hooks needed by the workflow, and conflict/overlap warnings

## Out of scope

- Automatic website writes
- Full dashboard experience beyond APIs/minimal operational views needed to test workflows
- Learned autonomous policy changes

## Acceptance criteria

- Editing a recommendation creates a new immutable version and prior approval cannot authorize it.
- Approval, rejection, changes requested, supersession, execution, correction, and revert are separate attributable events.
- Server-side authorization enforces approver and special-approver permissions.
- A recommendation cannot be marked executed without an approved version, actor, timestamp, target, and exact before/after record.
- High-risk types (URL changes, deletion, major redirects, major rewrites) remain manual and require special approval.
- Baseline definitions are versioned and captured before or at declared execution with data sufficiency recorded.
- Measurement plans create due 30/60/90 windows idempotently and handle delayed/missing Google data.
- Results use only `POSITIVE`, `NEUTRAL`, `NEGATIVE`, `INSUFFICIENT_DATA`, or `REVERTED`, with transparent metric evidence.
- Concurrent/overlapping changes to the same target are flagged so attribution is not overstated.
- Workflow transitions, authorization failures, retries, and audit completeness have integration tests.
- No code path modifies the production website.
- Tests, typecheck, lint, and build pass; workflow/measurement runbooks are updated.

## Human inputs required

- Named roles/approvers, risk matrix, SLA/notification policy, execution evidence requirements, metric windows, outcome thresholds, and attribution rules

## Exit artifact

An end-to-end audited example from recommendation to a simulated 30/60/90 result, plus an explicit stop before Phase 7.
