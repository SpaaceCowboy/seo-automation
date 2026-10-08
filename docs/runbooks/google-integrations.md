# Google Integrations Runbook

## Google Cloud and property setup

1. Create or select a Google Cloud project and enable **Google Search Console API**, **Google Analytics Data API**, and optionally **PageSpeed Insights API**.
2. Create a service account and download its JSON key to a secure path outside this repository.
3. Add the service-account email as a read-only user on the configured Search Console property and as a Viewer on the GA4 property.
4. If using a PageSpeed API key, restrict it to the PageSpeed Insights API and appropriate server/network restrictions.

## Environment

Set these values in the ignored local `.env` or deployment secret injection:

```dotenv
GOOGLE_CREDENTIALS_FILE=C:\secure\roco-seo-google.json
GOOGLE_SITE_ID=<registered Roco SEO site UUID>
GSC_PROPERTY=sc-domain:rocobroker.com
GA4_PROPERTY_ID=<numeric GA4 property ID>
PAGESPEED_API_KEY=<optional restricted key>
GOOGLE_BACKFILL_DAYS=90
GOOGLE_SCHEDULES_ENABLED=false
```

The credential file must be readable only by the worker runtime identity. Do not paste JSON/private keys into `.env`, logs, database fields, tickets, or API requests.

## Controlled validation

Start PostgreSQL, migrate, and run the API/worker. Start with 1-3 days and one dimension set:

```powershell
$siteId = '<site UUID>'
$body = @{ startDate='2026-09-01'; endDate='2026-09-03'; dimensionSet='PAGE' } | ConvertTo-Json
$run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/sites/$siteId/integrations/gsc/sync" -ContentType 'application/json' -Body $body
Invoke-RestMethod "http://127.0.0.1:4000/integration-syncs/$($run.id)"
```

Repeat with `QUERY` and `PAGE_QUERY`; never add totals from the three datasets together. For GA4, change the provider path to `ga4`. For PageSpeed:

```powershell
$body = @{ urls=@('https://rocobroker.com/fa'); strategies=@('mobile','desktop') } | ConvertTo-Json
$run = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/sites/$siteId/integrations/pagespeed/sync" -ContentType 'application/json' -Body $body
```

## Backfills and daily schedules

Use `mode='backfill'` plus explicit `startDate`/`endDate`, or omit dates to use `GOOGLE_BACKFILL_DAYS`. Requests are limited to 480 days. GSC pagination uses at most 25,000 rows/request and GA4 at most 100,000 rows/request.

After controlled validation succeeds, set `GOOGLE_SCHEDULES_ENABLED=true`. The worker dispatches GSC and GA4 data for UTC today minus `GOOGLE_FINALITY_DAYS` (default 3) daily and the canonical origin to PageSpeed weekly. Cron expressions and request/retry controls are configurable in `.env.example`.

## Freshness and recovery

```powershell
Invoke-RestMethod "http://127.0.0.1:4000/sites/$siteId/integrations/freshness"
```

Freshness returns the last successful window, latest state, and most recent safe failure for each provider. Quota/5xx/timeouts are retried with exponential backoff. Repeating the same logical window is safe: sync-run and metric natural keys prevent duplicates. Permission failures require fixing property access; malformed-response failures require reviewing the provider contract before retrying.

An in-scope URL not present in `pages` is stored with `page_id = null`. Out-of-scope or invalid URLs are not persisted as metrics and increment `unmatchedUrlCount` in the run summary.

## Linux production deployment

Use `../OPERATIONS.md` for private authenticated production commands, mounted credentials, Google administrator setup and bounded import limits. The older PowerShell examples above describe request shapes; production commands must use named credentials.
