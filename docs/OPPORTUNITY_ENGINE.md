# Phase 4 Opportunity Engine

## Boundary and data contracts

`@roco/opportunities` is pure deterministic analysis. It has no database, HTTP, Google, LLM, publishing, recommendation, or dashboard dependencies. `opportunities-v1` is the detector version. Worker orchestration and `@roco/db` supply validated observations and persist results.

PAGE metrics supply page CTR, decay and link-support detection. PAGE_QUERY metrics supply quick wins, exact-query competition, overlap groups and content-gap candidates. QUERY totals are not added to either dataset. Country/device segments within one dataset are aggregated: clicks and impressions are summed, CTR is recomputed as clicks/impressions, and position is impression-weighted. Evidence retains exact row and sync IDs, observed dates, previous-period rows, crawl/snapshot/graph IDs, configuration, and version.

Only final `web` GSC rows belonging to successful syncs are included. Successful sync windows must cover every analysis date for the relevant dimension set. This establishes import coverage, not exhaustive Google visibility: anonymized queries, provider row limits and low-volume omissions still apply. Summed page/query visibility is not unique query search volume.

GA4 organic landing data and dated mobile/desktop PageSpeed observations are contextual evidence for link opportunities. They do not silently determine business value or change rankings. The latest successful crawl finishing on or before the analysis end date supplies graph/indexability facts; future crawls are excluded from historical windows.

## Configuration and evidence gates

A trigger can pass a partial `config` object. Zod supplies defaults and rejects unknown fields, invalid ranges, zero total weights, and unordered CTR bands. The fully resolved configuration is published immutably under a content hash; the human `version` is descriptive, while `configId`/hash identify the exact version.

Default window: 28 days; supported lengths: 7, 28, 90. End dates must be at least 3 UTC calendar days behind today, configurable upward through `lagDays`. This is a safety buffer, not a promise of Google finality. Previous periods are adjacent and equal in length. Seven/28-day comparisons align weekdays; 90-day comparisons do not control seasonality.

Default minimum: 200 impressions and observations on at least `ceil(windowDays * 0.7)` distinct days per assessed target. Missing rows are never synthesized as zero. Decay requires an adequate previous baseline and matching observed dates shifted by exactly the window length. A well-observed current period may fall below 200 impressions: this is allowed for decay so severe declines are not hidden by a demand gate. Completely absent pages remain insufficient evidence.

Default exclusions: `/login`, `/logout`, `/account` and descendants, matched on path boundaries. Literal case-insensitive query exclusions are configurable through `excludedQueryPatterns`; no semantic filtering is performed. Unicode/Persian URL paths are supported. Query parameters remain part of the versioned URL identity.

## Detection rules and impact

Every component is clamped to 0–100.

| Type                      | Default rule                                                                                                                             | Impact component                                             | Default effort |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------: |
| QUICK_WIN                 | Adequate query/page pair; position 4–20 inclusive                                                                                        | `100 * (maxPosition-position+1)/(maxPosition-minPosition+1)` |             40 |
| CTR                       | Adequate page; CTR below 60% of configured expectation                                                                                   | `100 * (1-actualCtr/expectedCtr)`                            |             20 |
| DECAY                     | Comparable periods; at least one practical decline below                                                                                 | Maximum qualifying relative deterioration × 100              |             50 |
| CANNIBALIZATION_CANDIDATE | At least two adequate pages for one exact query; each ≥100 impressions and ≥20% of observed visibility; or page-pair exact-query overlap | 60 for exact-query competition; `100 * Jaccard` for overlap  |             70 |
| INTERNAL_LINK             | Adequate demand; observed indexable target has ≤2 incoming links, depth >4, or observed orphan status                                    | 90 orphan, otherwise 75 excessive depth, otherwise 60        |             30 |
| CONTENT_GAP_CANDIDATE     | Adequate exact-query demand; all observed landing pages have position ≥20                                                                | 70                                                           |             80 |

CTR expectation bands: position ≤3 → 12%; ≤5 → 6%; ≤10 → 3%. These are provisional operator assumptions, not universal search benchmarks. `ctr.bands` and `ctr.maxRatio` are configurable.

Decay requires **both** relative deterioration ≥30% and an absolute floor: clicks −20, impressions −100, CTR −0.01 (one percentage point), or average position +3. Relative clicks/impressions/CTR losses divide by the previous value. Relative position worsening is `(currentPosition-previousPosition)/previousPosition`. Evidence shows every qualifying signal. These are practical thresholds, not statistical significance claims.

Overlap candidates require ≥3 shared adequate exact queries and Jaccard similarity ≥0.5. Jaccard is shared query IDs divided by the union of both pages' query IDs. No stemming, embeddings or inferred query intent is used. Overlap and exact-query candidates have different fingerprints and may coexist.

Link sources must be observed/indexable, have adequate PAGE data and ≥20 clicks, and lack an observed existing edge to the target. Relationships require shared adequate exact queries or at least two shared leading path segments. Only the top five sources by clicks are retained. Crawl age defaults to ≤30 days. All link results remain candidates: bounded crawling cannot prove site-wide orphanhood or complete incoming-link counts, and path relationships do not prove semantic relevance. Empty source lists remain visible as a support gap, never fabricated anchor text.

Cannibalization/content-gap groups have no arbitrary primary page or inferred commercial value. Evidence names the competing landing pages and query identifiers. These signals require later human/semantic review.

## Scoring

Let `D`, `I`, `C`, `E`, `B` denote demand, impact, evidence confidence, effort and business value, each on 0–100. Higher effort reduces priority.

```text
D = clamp(100 * log(1 + impressions) / log(1 + demandSaturation))
C = clamp(100 * min(1, impressions / confidenceSaturation)
              * observedDays / windowDays)
score = round((25*D + 30*I + 20*C + 15*(100-E) + 10*B) / 100, 2)
```

Defaults: demand saturation 10,000 impressions; confidence saturation 2,000. Decay uses **previous-period impressions** for demand/confidence, preserving the importance of a page whose current visibility collapsed. Other detectors use their own dataset's current visibility. Confidence is an evidence-strength heuristic, not a predicted probability of uplift.

Weights and every per-type effort are configurable (`weights`, `effortByType`). The denominator is the sum of active weights, so weights need not sum to 100. **Unknown business value is null and its weight is omitted**, giving denominator 90 with defaults. It is never invented or treated as a known zero. If only an unavailable component has positive weight, score is zero.

Business value comes solely from `businessRules: [{pathPrefix:"/fa/example",value:80}]`. Longest matching path prefix wins; prefix matching respects segment boundaries. Defaults contain no business rules. Query-group candidates retain unassigned business value. Scores always expose components and the exact weighting configuration through immutable observations.

## Lifecycle and history

- Stable identity: SHA-256 of type plus deterministic page/query/group target, scoped uniquely to the site.
- Repeated detection updates the current projection and appends a new scored observation per run. Same-run retries do not append duplicates.
- OPEN is new/reopened detection. ACKNOWLEDGED survives repeated detection. DISMISSED suppresses automatic reopening/resolution while new evidence can still be retained.
- RESOLVED requires successful evaluation of that exact fingerprint with adequate evidence and a negative rule result. Disappearance from an import is insufficient.
- STALE marks unevaluated evidence older than `staleAfterDays` (default 90), using detection timestamps. It does not assert recovery. Stale/resolved items can reopen upon detection.
- Operator acknowledgement, dismissal and explicit reopen require the configured active actor, expected current status and a reason. They append audit events. No approval or execution workflow is introduced.
- Historical runs cannot replace a newer successful site's current projection. Historical-only identities are stored STALE. Rescoring with a new configuration publishes a new config and retains new observations.

Run states: QUEUED, RUNNING, SUCCEEDED, FAILED. Inputs are captured under repeatable read and frozen on first successful capture. A retry reuses them. Successful runs, captured input, published configs, scored observations and detector events are protected against mutation/deletion. Site-level transaction locks serialize result projection and operator decisions. Result persistence and success status commit atomically.

Default command idempotency is site + end date + configuration hash + detector version. Use a new explicit `idempotencyKey` when intentionally reanalysing corrected imports for the same window. A reused key with different parameters is rejected.

## Operational limits

No detector makes outbound calls. Inputs are bounded to 100,000 rows per metric/observation collection, 10,000 sync coverage records, 2,000 crawl pages for link-source analysis, 500 pages for pairwise query-overlap analysis and 5,000 opportunities. Budget overflow fails the run; it never silently truncates findings or resolves from partial analysis. Database statements/lock waits are bounded to 30 seconds; pg-boss jobs expire after 30 minutes and have two retries with 30-second exponential backoff. Increase ceilings only after measuring VPS capacity and reviewing the implementation.

List APIs paginate at ≤100 results, ordered by descending score then identity. Detail includes the newest 100 observations, detector events and operator decisions; complete history remains in PostgreSQL. The API strips frozen input from run-summary responses, exposing status, timings, attempts, counts, errors and capture state instead.

See `docs/runbooks/opportunities.md` for commands and `docs/PHASE_4_CALIBRATION.md` for validation and limitations.
