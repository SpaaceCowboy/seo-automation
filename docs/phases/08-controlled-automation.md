# Phase 8 - Controlled Automation

## Objective

After the recommendation system proves value, add narrowly scoped, reversible automation for explicitly approved low-risk change types without weakening human control.

## Entry conditions

- Phases 1-7 are accepted and operational.
- Recommendation precision and measurement history meet human-approved thresholds.
- A threat model, production integration design, rollback method, and ownership/on-call plan are approved.
- The user explicitly approves Phase 8 scope; this phase is never entered automatically.

## In scope

- Separately deployed executor with isolated, least-privilege credentials
- Explicit allowlist of low-risk action types, fields, targets, and environments
- Dry-run/diff, approval binding, idempotency, rate/daily limits, maintenance windows, and global/per-site kill switches
- Post-write verification, rollback commands, immutable audit, and anomaly alerts
- Gradual rollout from staging to canary production targets

## Permanently manual unless separately authorized

- URL changes
- Page deletion
- Major redirects
- Major rewrites
- Any action outside the executor allowlist

## Acceptance criteria

- Analysis/API/agent services cannot access executor credentials.
- Every command references an approved immutable recommendation version and expires after a defined period.
- Dry-run produces an exact machine- and human-readable diff with policy validation.
- Duplicate delivery is idempotent and cannot apply the same change twice.
- Executor enforces target/action allowlists, rate/daily limits, maintenance windows, and approval/risk policy independently of callers.
- Kill switches stop new actions immediately and are tested.
- Each write is followed by source/read-back verification; mismatch triggers alert and no further dependent actions.
- Rollback is tested in staging and canary exercises before broader enablement.
- Audit records command, approval, actor, executor version, before/after, response, verification, and rollback linkage.
- Failure injection covers timeout, partial provider failure, stale content, concurrent manual edit, credential revocation, and rollback failure.
- Canary rollout has explicit success/error thresholds and automatic pause criteria.
- High-risk/manual categories cannot be executed even if a caller forges a request.
- Tests, typecheck, lint, build, security review, recovery drill, and documentation pass.

## Human inputs required

- Exact CMS/API, first allowlisted change type, staging environment, approval validity window, rollout targets, limits, rollback owner, and on-call escalation

## Exit artifact

A signed-off threat model and canary report. Expansion to another action type requires a new explicit approval and acceptance exercise.
