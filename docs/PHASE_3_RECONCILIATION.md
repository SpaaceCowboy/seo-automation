# Phase 3 Integration Reconciliation

## Validation status

Automated validation uses controlled GSC, GA4, and PageSpeed fixtures; it never calls live Google APIs. No Google credential path, GSC property, GA4 property ID, or PageSpeed key was present during Phase 3 completion, so provider record counts remain zero in the development database.

## Dataset reconciliation

| Dataset                   |                                 Fixture result | Idempotency / caveat                                                           |
| ------------------------- | ---------------------------------------------: | ------------------------------------------------------------------------------ |
| GSC page daily            | 3 normalized rows across 2 paginated responses | Natural key includes site/date/page hash/country/device/search type/data state |
| GSC query daily           |        Contract and persistence path validated | Kept separate from page and page/query aggregation                             |
| GSC page/query daily      |        Contract and persistence path validated | Never summed with other dimension sets                                         |
| GA4 organic landing pages |                       1 normalized fixture row | Date and path normalized; scope fixed to `Organic Search`                      |
| PageSpeed                 |                Mobile lab/field fixture parsed | Missing INP remains null; URL/device refresh cache avoids repeat requests      |

The PostgreSQL integration test replays an identical GSC daily observation with changed clicks and verifies one stored row containing the updated value. Sync summaries separately retain `rowsRead`, `rowsWritten`, `requestCount`, and `unmatchedUrlCount`.

## URL coverage

All provider URLs reuse `url-v1` and approved host scope. Exact normalized-hash matches attach to an existing crawler `page_id`. Valid in-scope URLs that have not been crawled remain stored with `page_id = null`. Invalid/out-of-scope URLs are stored in `integration_unmatched_urls` with reason and sync provenance rather than silently disappearing.

## Quota and failure behavior

- GSC page size: at most 25,000 rows/request
- GA4 page size: at most 100,000 rows/request
- Manual PageSpeed target limit: 20 URLs and 2 strategies
- Default PageSpeed refresh window: 168 hours
- Retryable conditions: timeouts, HTTP 429, and HTTP 5xx with bounded exponential backoff
- Permission and validation errors: recorded as safe failures; secret-bearing payloads are not persisted

## Remaining live reconciliation

Follow `docs/runbooks/google-integrations.md`, begin with 1-3 days, then compare provider UI totals to each independent imported dimension set. Record sampled provider totals, stored totals, unmatched URLs, and any privacy-threshold differences before enabling schedules.
