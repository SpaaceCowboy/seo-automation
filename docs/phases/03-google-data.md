# Phase 3 - Google Data Integrations

## Objective

Reliably ingest historical Search Console, GA4, and PageSpeed data with clear provenance and repeatable sync behavior.

## In scope

- Least-privilege integration configuration and credential references
- GSC daily page/query/country/device metrics with dimension-set and freshness metadata
- GA4 organic landing-page metrics with documented channel and engagement definitions
- PageSpeed mobile/desktop runs and typed Core Web Vitals/lab metrics
- Backfill, incremental sync, cursor/date-window, quota/rate handling, retries, and partial failure behavior
- URL-to-page mapping with explicit unmatched records/diagnostics
- Integration sync status, counts, latency, and safe errors

## Out of scope

- Opportunity scoring
- Agent analysis or recommendations
- Production changes

## Acceptance criteria

- OAuth/service-account secrets are absent from source control and logs; scopes are documented and least-privilege.
- Contract tests validate representative, empty, malformed, paginated, quota-limited, and permission-denied responses.
- Replaying an identical sync window is idempotent and does not double metrics.
- GSC imports preserve date, page, query, country, device, clicks, impressions, CTR, position, search type, dimension set, and data state.
- Documentation warns against aggregating incompatible GSC dimension sets and tests enforce the selected uniqueness key.
- GA4 organic landing-page scope and every stored metric are defined, including timezone and attribution caveats.
- PageSpeed retains strategy, timestamp, API/version provenance, and missing field-data conditions without inventing values.
- Backfills resume safely after interruption and expose progress/partial failure.
- Unmatched Google URLs remain observable and do not silently disappear.
- Sync summaries reconcile stored row counts/metric totals with controlled fixtures and sampled provider results.
- Quota, retry, timeout, and cost controls are configurable.
- Tests, typecheck, lint, and build pass; integration setup and recovery runbooks are updated.

## Human inputs required

- GSC property, GA4 property/data stream, credential ownership, organic channel definition, desired history window, PageSpeed quota/key policy, and acceptable sync schedule

## Exit artifact

An integration reconciliation report with coverage, unmatched URLs, data caveats, quota behavior, and an explicit stop before Phase 4.
