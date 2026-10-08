# Phase 6 Review, Ledger and Measurement

## Boundary

The system records decisions and declared human actions. Approval does not execute a change. No CMS adapter, website writer, publishing, automatic links/redirects or production rollback exists. The dashboard remains unchanged.

`@roco/workflow` owns strict contracts, lifecycle/role policy, concrete value validation, metric rules and deterministic classification. `@roco/db` owns transactions, evidence capture and append-oriented records. Workers operate only on existing stored observations and durable measurement plans through pg-boss.

## Concrete recommendations and review

A recommendation materializes one selected action from a validated Phase 5 Supervisor draft. Its source output, opportunity, page identity, action type and SANDBOX/PRODUCTION mode are immutable. Clients must provide a concrete typed before/after proposal, page type, topic, reason and measurement rule. This does not copy large agent histories: source references remain linked.

Typed change fields: title, meta description, headings, canonical URL, bounded content/schema references, internal-link tuples, URL/redirect target, deletion state or observation note. Exactly the field appropriate to the action type is allowed. Referenced pages must belong to the site; proposed URL fields must remain in approved host scope. Content is stored by reference rather than full article blobs.

Lifecycle:

- DRAFT → READY_FOR_REVIEW by an operator.
- READY_FOR_REVIEW → APPROVED, REJECTED or CHANGES_REQUESTED by the required reviewer.
- An operator revision creates a new immutable version and returns to DRAFT; revising APPROVED appends a SUPERSEDED decision, invalidating earlier approval.
- APPROVED → IMPLEMENTED only after a matching human implementation record.
- Eligible unimplemented states may be CANCELLED. IMPLEMENTED/CANCELLED are terminal; reverts are separate historical facts, not deleted implementations.

Review requests include the expected version and state. Stale/concurrent decisions fail. Revisions cannot retarget another page/change type. Prior versions, decisions and lifecycle events remain immutable. Higher-risk source classifications cannot be lowered through proposal editing.

## Identity and risk

Phase 6 extends the existing bearer approach with a named-actor credential registry in secret environment configuration. Tokens are hashed in API memory; neither tokens nor credentials are written to PostgreSQL. Requests cannot provide reviewer/implementer identities or roles. Database actors must be active; business mutations/review/implementation require HUMAN actors. Scheduled measurements use a configured active SERVICE actor.

- Any configured role may read, subject to active identity.
- OPERATOR creates/submits/revises/cancels recommendations and records implementation/reverts/corrections/baselines/manual measurement requests.
- APPROVER reviews LOW/MEDIUM items.
- SPECIAL_APPROVER is required for HIGH/SPECIAL_APPROVAL review, including rejection/change requests. It may also review lower risks.
- ADMIN is not implicitly a business approver/operator; grant explicit roles where needed.

Risk is inherited from the validated draft and deterministic action floor: ordinary metadata/content/link/schema changes MEDIUM, canonical HIGH, URL/redirect/deletion/major rewrite SPECIAL_APPROVAL. No risk level becomes executable. A dual-person requirement is not invented; roles can be assigned according to the documented human governance decision.

Database guards independently require current-version human approvals and matching ledger values. They supplement server role checks; they are not a replacement for deployment credential/SQL privilege controls. Broader SSO/session/public exposure remains a Phase 7/deployment decision.

## Change Ledger and human attestation

Implementation recording requires the current approved version, exact approved actual-before and actual-after values, active human implementer, implementation time at/after approval and not in the future, notes, external reference and `confirmedApplied: true`. This is an attributable human claim, not automated verification that the production website changed.

Ledger identity links recommendation/version/approval/page/site/mode and source provenance through references. Initial baseline and all three durable plans commit atomically with the implementation record. Repeated identical implementation keys return the same record; changed payloads conflict. SANDBOX records are clearly labelled, including simulated implementation and revert events.

Manual revert records require human attestation, date, reason, resulting typed values and reference. They never perform rollback. CORRECTION events clarify notes without silently changing the original ledger or approved values. A second physical change needs a separately approved recommendation; original history remains intact.

## Baseline and datasets

Default metric window is 28 days; supported windows are 7, 14 and 28, each containing whole-week cycles. Baseline daily data ends on the day before declared implementation. Crawler/PageSpeed baseline state may use observations up to the declared implementation timestamp. These choices and all thresholds are stored in the approved versioned `measurement-v1` rule.

Captured `measurement-sample-v1` aggregates and source row IDs freeze what was available at capture time. Missing data is stored as missing, never fabricated zero performance. Operators may explicitly recapture the same historical baseline window when late imports arrive; each recapture creates a new numbered immutable baseline and audit event. Existing results retain their exact baseline version; new runs use the latest recorded baseline version.

Datasets remain separate:

- GSC PAGE/final/web rows only. Clicks/impressions sum; CTR is clicks/impressions; position is impression-weighted. PAGE_QUERY/QUERY totals are never added.
- GA4 `Organic Search`, `ga4-organic-landing-v1`. Sessions and key events sum; engagement rate is engaged sessions/sessions. GA4_DAILY_USERS is the sum of daily users, not unique users across the window.
- PageSpeed mobile/desktop selection is explicit. Lab performance/LCP/INP/CLS mean values require the configured number of non-null samples. Missing INP remains null.
- Crawler uses a successful bounded crawl, observed valid fetch state and its graph/analysis facts. Indexability means the crawler's deterministic observation, not confirmed Google index status. Incoming counts/issue resolution describe observed crawl scope.

Google daily observations are accepted only from successful syncs. Coverage must include every window date for the relevant provider/dimension. Metric dates retain provider definitions; GSC/GA4 attribution/timezone differences are not silently erased. Crawler/PageSpeed samples are bounded to the analysis window/as-of time to prevent lookahead. Source budgets fail loudly rather than silently trimming evidence.

## Expected metric mapping and configurable rules

The exported `defaultRule(expectedMetric)` maps Phase 5 intent to an initial rule: CLICKS → GSC_CLICKS, IMPRESSIONS → GSC_IMPRESSIONS, CTR → GSC_CTR, POSITION → GSC_POSITION, INCOMING_LINKS → CRAWL_INCOMING_LINKS, INDEXABILITY → CRAWL_INDEXABILITY, NONE → NONE. The operator supplies the concrete rule during materialization/review and can override the primary. Rule changes require a new proposal version/fresh approval.

Additional primary metrics: GA4 sessions/daily users/engagement/key events, PageSpeed lab scores/timings, crawl depth and technical issue counts. NONE yields INSUFFICIENT_DATA rather than a manufactured success.

Provisional defaults:

- Three-day Google lag buffer; measurement readiness also waits until the comparison day has ended.
- At least 80% observed days, matching observed-day counts between baseline/post periods and complete import coverage.
- At least 200 impressions for both GSC periods; clicks-primary also requires 20 clicks.
- GA4 requires 20 organic sessions per period.
- PageSpeed requires three non-null primary-metric samples per period.
- A meaningful result needs both ≥10% relative change and an absolute floor: count metrics 20; CTR/rates 0.005; position/crawl facts 1; lab performance 0.05; CLS 0.02; lab timings 100 ms. Each absolute floor and relative threshold are configurable.

Position, timings, CLS, crawl depth and issue counts are lower-is-better. Other numeric metrics are higher-is-better. Zero baselines allow absolute comparison only when there is adequate observed data; absent data is never converted to zero. Sparse conversion metrics still require operator threshold/configuration review.

## Durable 30/60/90 measurement

Three plans are stored at implementation, independent of worker availability. Nominal due dates are T+30/60/90; data-ready times account for day-end and lag. Post windows end at the horizon and contain only post-change days. An opt-in pg-boss hourly dispatcher scans the durable plans and enqueues generic `workflow.measure-change` commands. There is no second scheduler.

The dispatcher recovers queued commands after delivery failure/restart. Delivery uses stable run IDs and singleton keys. A result is unique to its run; redelivery returns the existing immutable result. Daily automatic retries of insufficient data produce separate dated attempts for up to fourteen days by default. Final insufficient results remain visible; explicit manual remeasurement creates another historical attempt. Infrastructure failures retain status, attempt count, safe code and retry behavior.

## Classification, overlap and reverts

POSITIVE/NEGATIVE require practical thresholds and adequate data; smaller changes are NEUTRAL. Missing metrics, incomplete windows, uneven observed-day counts, thin volume, stale/missing crawler facts or sparse PageSpeed samples yield INSUFFICIENT_DATA with reasons.

Other recorded changes on the same page/window/mode are referenced as overlap IDs. Default policy is INSUFFICIENT_DATA for overlap; configurable `warn` permits an association classification with explicit attribution warning. A recorded human revert produces REVERTED. URL/redirect/deletion identity changes remain insufficient pending separate identity reconciliation, protecting against misleading old-page comparisons.

Every result has `causationClaimed: false`. Improvement after a change does not establish that the change caused the improvement. Seasonality, SERP/query mix, privacy omissions, provider revisions and concurrent/manual changes remain concerns.

Full histories remain in PostgreSQL; API history collections are capped at the latest 100 and lists paginate at ≤100 rows. Business/approval/ledger/baseline/result histories have immutable guards. Projection fields and operational run status remain mutable only to reflect workflow progress.

See `runbooks/workflow-measurement.md` for configuration/API commands and `PHASE_6_VALIDATION.md` for actual sandbox verification. Phase 7 remains unimplemented.
