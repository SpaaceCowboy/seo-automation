# Crawler Operations

## Safety baseline

The Phase 2 crawler is read-only and uses HTTP GET only. Its environment values are ceilings; API callers can request smaller values but cannot raise them. Defaults are one concurrent request, one request per second, 30 pages, six link levels, a 15-second timeout, a 2 MB response cap, five redirects, and two retries.

The worker rejects hosts outside `site_hosts`, URL credentials, private/loopback/link-local DNS results, out-of-scope redirects, and non-HTTP(S) URLs. It respects robots.txt by default and increases its delay when a matching `Crawl-delay` is more conservative. Raw HTML is not stored.

## Local preparation

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f infrastructure/compose.yaml up -d postgres
pnpm db:migrate
pnpm site:upsert -- "RocoBroker" "https://rocobroker.com" "Asia/Tehran"
```

If port 5432 is already used locally, add `POSTGRES_PORT=55432` to `.env` and use port 55432 in `DATABASE_URL` and `TEST_DATABASE_URL`.

Run `pnpm dev:api` and `pnpm dev:worker` in separate terminals. Use the API examples in the README to start, inspect, summarize, or cancel a crawl.

## Configuration

| Variable                      |                  Default | Purpose                               |
| ----------------------------- | -----------------------: | ------------------------------------- |
| `CRAWLER_MAX_PAGES`           |                       30 | Hard URL budget per run               |
| `CRAWLER_MAX_DEPTH`           |                        6 | Maximum internal-link discovery depth |
| `CRAWLER_CONCURRENCY`         |                        1 | Maximum simultaneous page work        |
| `CRAWLER_REQUESTS_PER_SECOND` |                        1 | Start-rate ceiling                    |
| `CRAWLER_REQUEST_TIMEOUT_MS`  |                    15000 | Per-request timeout                   |
| `CRAWLER_MAX_RESPONSE_BYTES`  |                  2000000 | Body-size ceiling                     |
| `CRAWLER_MAX_REDIRECTS`       |                        5 | Redirect-hop ceiling                  |
| `CRAWLER_RETRY_LIMIT`         |                        2 | Retry limit for transient failures    |
| `CRAWLER_USER_AGENT`          | identified RocoSEO agent | HTTP user agent                       |

Query parameters are preserved and sorted by default. Ignored parameters require an approved policy. Playwright fallback is disabled because no production URL patterns have been approved; static pages always use HTTP and Cheerio.

## Inspecting persistence

The status and summary APIs are the normal interface. Operators may also inspect `crawl_runs`, `page_snapshots`, `link_edges`, `issue_occurrences`, and `page_metrics` in PostgreSQL. Every crawl receives a new run ID. Retrying delivery for the same logical run upserts its unique run/page observations rather than duplicating them.

## Test procedure

```powershell
pnpm test
$env:TEST_DATABASE_URL='postgresql://roco_seo:roco_seo_dev@127.0.0.1:5432/roco_seo_test'
pnpm test:integration
Remove-Item Env:TEST_DATABASE_URL
pnpm lint
pnpm typecheck
pnpm build
```

Production validation must begin with 10–50 pages, concurrency 1, and no more than one request per second. Review robots.txt, worker logs, stored failures, summary counts, and response times before approving a larger crawl.
