# Phase 2 Technical SEO Rule Catalog

Ruleset version: `technical-v1`

Every occurrence stores a stable code, severity, remediation, rule version, page/run provenance, evidence, and a stable page/code fingerprint. Lifecycle state is derived across analysis runs so source observations remain append-oriented.

| Code                         | Default severity | Condition                                                |
| ---------------------------- | ---------------- | -------------------------------------------------------- |
| `HTTP_4XX`                   | Error            | Page returns a 4xx response                              |
| `HTTP_5XX`                   | Critical         | Page returns a 5xx response                              |
| `REDIRECT_CHAIN`             | Warning          | More than one redirect hop                               |
| `REDIRECT_LOOP`              | Critical         | Redirect returns to an observed hop                      |
| `BROKEN_INTERNAL_LINK`       | Error            | Internal destination observed with 4xx/5xx               |
| `INTERNAL_LINK_TO_REDIRECT`  | Warning          | Link targets a redirecting page                          |
| `NOINDEX`                    | Warning          | Meta/X-Robots directives contain `noindex`               |
| `ROBOTS_BLOCKED`             | Warning          | Matching robots policy disallows the URL                 |
| `SITEMAP_NON_INDEXABLE`      | Error            | Sitemap URL is not indexable                             |
| `CANONICAL_MISSING`          | Warning          | Successful HTML page has no valid canonical              |
| `TITLE_MISSING`              | Error            | Successful HTML page has no title                        |
| `TITLE_LENGTH`               | Warning          | Title is shorter than 10 or longer than 65 characters    |
| `TITLE_DUPLICATE`            | Warning          | Multiple successful pages share a normalized title       |
| `META_DESCRIPTION_MISSING`   | Warning          | Successful HTML page has no meta description             |
| `META_DESCRIPTION_DUPLICATE` | Warning          | Multiple successful pages share a normalized description |
| `H1_MISSING`                 | Warning          | Successful HTML page has no H1                           |
| `H1_MULTIPLE`                | Warning          | Successful HTML page has more than one H1                |
| `THIN_CONTENT`               | Info             | Extracted body contains fewer than 100 words             |
| `IMAGE_ALT_MISSING`          | Warning          | One or more images omit the alt attribute                |
| `CRAWL_DEPTH_EXCESSIVE`      | Warning          | Link-discovered page depth exceeds four                  |
| `ORPHAN_PAGE`                | Error            | Sitemap page has no observed incoming internal link      |

Schema types and breadcrumb presence are extracted and retained, but no generic “missing schema” or “missing breadcrumb” issue is emitted because applicability depends on page type and would create deterministic false positives without an approved page-type policy.
