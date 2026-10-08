# Workflow and Measurement Operations

## Setup

Apply reviewed migrations with `pnpm db:migrate`. Keep services private; earlier routes still require localhost/private deployment. No website credentials or write adapter are needed.

Configure `WORKFLOW_ACCESS_JSON` through secret environment injection. It is a JSON array of named-actor credentials:

```json
[
  {
    "token": "<operator credential, at least 32 random characters>",
    "actorId": "<active human actor UUID>",
    "roles": ["VIEWER", "OPERATOR"]
  },
  {
    "token": "<reviewer credential, at least 32 random characters>",
    "actorId": "<active human actor UUID>",
    "roles": ["VIEWER", "APPROVER"]
  },
  {
    "token": "<special reviewer credential, at least 32 random characters>",
    "actorId": "<active human actor UUID>",
    "roles": ["VIEWER", "SPECIAL_APPROVER"]
  }
]
```

Use distinct private credentials; never place real tokens in tracked files or tickets. The actor UUIDs must exist in `actors` and be active. Service actors cannot approve or record implementation. Role memberships are deployment-managed in this phase; no general user-management UI is introduced.

Optional schedules:

```dotenv
WORKFLOW_SCHEDULES_ENABLED=false
WORKFLOW_MEASUREMENT_ACTOR_ID=<active SERVICE actor UUID>
WORKFLOW_MEASUREMENT_SCHEDULE=15 * * * *
```

Enable schedules only after actor/data checks. The worker registers both queues; manual eligible measurements work without the dispatcher schedule. Disabling schedules explicitly removes its persisted dispatcher schedule. Existing ledger/plans/results remain durable.

## Materialize a concrete recommendation

Inspect a validated Phase 5 draft and select one action. Prepare a complete proposal with real before values, bounded after values/references, primary measurement rule and SANDBOX/PRODUCTION mode. Proposed type/page must match that selected action. For safe validation use SANDBOX; do not falsely record an unapplied production change.

Example body for a title action, saved as `recommendation.json` locally:

```json
{
  "agentOutputId": "<validated Supervisor output UUID>",
  "actionIndex": 0,
  "mode": "SANDBOX",
  "idempotencyKey": "sandbox-title-example",
  "proposal": {
    "pageId": "<source target page UUID>",
    "changeType": "TITLE",
    "pageType": "article",
    "topic": "forex education",
    "before": { "title": "<observed before title>" },
    "after": { "title": "<concrete proposed title>" },
    "reason": "Review title alignment against supplied evidence.",
    "rule": { "primary": "GSC_CTR" }
  }
}
```

Bash commands below assume `siteId`, `recommendationId`, `versionId`, `changeId` and private `WORKFLOW_TOKEN` are already set. Choose the credential appropriate to each action; reviewer identity is derived from it.

```bash
curl --fail-with-body -X POST "http://127.0.0.1:4000/sites/$siteId/workflow/recommendations" \
  -H "Authorization: Bearer $WORKFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @recommendation.json
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/workflow/recommendations?state=READY_FOR_REVIEW&limit=50&offset=0" \
  -H "Authorization: Bearer $WORKFLOW_TOKEN"
curl --fail-with-body "http://127.0.0.1:4000/sites/$siteId/workflow/recommendations/$recommendationId" \
  -H "Authorization: Bearer $WORKFLOW_TOKEN"
```

## Submit/review/revise

POST `/sites/:siteId/workflow/recommendations/:id/decisions` with:

```json
{
  "expectedVersionId": "<current version UUID>",
  "expectedState": "DRAFT",
  "action": "SUBMIT",
  "reason": "Ready for human review."
}
```

Review uses expected state READY_FOR_REVIEW and action APPROVE, REJECT or REQUEST_CHANGES. HIGH/SPECIAL_APPROVAL requires SPECIAL_APPROVER. Approval changes database workflow state only.

POST `/sites/:siteId/workflow/recommendations/:id/versions` with `expectedVersionId` and a complete new `proposal` to revise. Approved revisions invalidate prior approval and return to DRAFT. Reload on HTTP 409; stale UI state/version must never be retried blindly. CANCEL is an explicit operator decision for eligible unimplemented states.

## Record human implementation

Only after applying a real change outside this system, POST `/sites/:siteId/workflow/recommendations/:id/implementation`:

```json
{
  "versionId": "<approved current version UUID>",
  "implementedAt": "<actual ISO UTC timestamp>",
  "actualBefore": { "title": "<exact approved before title>" },
  "actualAfter": { "title": "<exact approved after title>" },
  "notes": "<human implementation notes; clearly mark sandbox simulation>",
  "externalReference": "<ticket/manual evidence reference>",
  "confirmedApplied": true,
  "idempotencyKey": "<stable implementation command key>"
}
```

The mode is inherited from the recommendation and cannot be changed while recording. Values differing from approval are rejected; revise/re-review the proposal instead. Implementation time must follow approval and not be in the future. Ledger, initial baseline and three plans commit together. No production request is sent.

GET `/sites/:siteId/workflow/changes/:id` shows linked recommendation/version/approval, actual values, actor/date/reference, baselines, plans and events.

## Measurement and missing data

GET `/sites/:siteId/workflow/changes/:id/measurements` exposes results/history. Matured manual requests use POST `/sites/:siteId/workflow/changes/:id/measurements/30` (or 60/90), with `{"idempotencyKey":"<stable attempt key>"}`. Early requests are rejected; API callers cannot override the clock, comparison dates or approval history.

Jobs consume existing GSC/GA4/PageSpeed/crawl observations; they do not call vendors. Inspect run metadata in `measurement_runs`, immutable `measurement_results`, safe worker logs and returned result reasons. The dispatcher can retry delayed/insufficient datasets daily within the configured allowance, preserving each attempt.

Missing baseline data stays recorded as missing. After historical imports arrive, an operator may POST `/sites/:siteId/workflow/changes/:id/baselines` with `reason` and `idempotencyKey`. A new immutable baseline version is captured over the same pre-change window. New manual/scheduled attempts can use it; past results keep their original baseline.

Review overlap warnings, sparse/uneven daily coverage, provider finality, lab sample variability and URL identity changes before interpreting results. Positive means performance improved afterward under the rule, not proven causation.

## Revert/correction tracking

After a human actually reverts outside this system, POST `/sites/:siteId/workflow/changes/:id/reverts`:

```json
{
  "revertedAt": "<actual ISO UTC timestamp>",
  "values": { "title": "<resulting title>" },
  "reason": "<human reason>",
  "externalReference": "<manual evidence reference>",
  "confirmedApplied": true,
  "idempotencyKey": "<stable revert key>"
}
```

This records a fact and never performs rollback. A later measurement records REVERTED. Original ledger/results remain immutable. Metadata clarification uses `/corrections` with `reason`, `note`, `idempotencyKey`; corrections do not rewrite approved values or original implementation.

## Verification and rollout

```bash
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL='<disposable isolated database URL>' pnpm test:integration
pnpm build
pnpm format:check
```

Integration tests truncate their disposable database. Never use a shared/project/production database for those commands. Controlled validation uses SANDBOX, fake draft sources and an injected clock; no real website modification or 30/60/90-day wait is involved.

Before deployment, register named operators/reviewers/special reviewers/service actor, verify concrete value/risk/metric defaults and configure identity-aware private access. Enable data schedules only after checking stored imports and failure recovery. No notifications are sent by Phase 6: durable audit/history/worker logs are the operational surfaces; outbound channels require a separately authorized setup.
