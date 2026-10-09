> Shared staff login was activated on 2026-10-09. See [STAFF_LOGIN_DEPLOYMENT.md](STAFF_LOGIN_DEPLOYMENT.md) for the live release and rollback. The older credential-login description below is historical; routine non-auth operational procedures remain applicable.

# Roco SEO production operations

Phase 7.5 deployment only. Phase 8 and production website writes are not authorized. This stack has no website write adapter or write credential.

## Installed environment and dashboard access

VPS: `31.57.24.70`, Ubuntu 24.04, 2 CPUs, approximately 4 GB RAM and 40 GB disk. Install root: `/opt/roco-seo`; source: `/opt/roco-seo/app`. PostgreSQL 17 persists in the `roco-seo_postgres-data` Docker volume. Docker Compose manages one API, worker, Next dashboard and Nginx process.

Open **https://scc.rocobroker.com/sign-in**. The existing named access credential still works; no username or SSH tunnel is required for browser access. Credentials remain in the ignored local `tmp/roco-production-dashboard-credential.txt`. Never send this file to a ticket, commit or shared chat.

The user supplied the A record and authorized this hostname on 2026-10-08. Nginx publishes ports 80 and 443; HTTP redirects to HTTPS except ACME validation. Only the authenticated dashboard/BFF is exposed. API and database have no host ports. Unrecognized hostnames are rejected. The hostname has noindex/nofollow headers and HSTS without includeSubDomains/preload. Docker DNS refresh avoids stale dashboard addresses after recreation.

SSH password login is disabled after verified key access; root permits keys only. The original loopback port 8087 remains for proxy health and redirects to the canonical domain. Next sessions are opaque HTTP-only, Secure, SameSite=Strict cookies over HTTPS; actor credentials stay server-side. One dashboard process is supported; its restart signs everyone out.

## HTTPS certificates and renewal

`infrastructure/compose.https.yaml` overlays the base deployment when `/opt/roco-seo/config/https.enabled` exists. The exact `DASHBOARD_ORIGIN` in `config/compose.env` is `https://scc.rocobroker.com`. The proxy mounts only this hostname's certificate live/archive directories, read-only, plus its ACME webroot.

Certbot was installed because the existing Nginx image has no ACME issuance/renewal client. The first certificate was obtained with standalone HTTP validation before port 80 was published. Renewal uses the mounted `/var/lib/roco-acme` webroot, so it does not stop the dashboard. The [Certbot user guide](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot) describes webroot validation. Its systemd timer handles renewal; the deploy hook validates and reloads Nginx only after successful renewal. The account is registered without an email contact; use timer/journal/expiry monitoring, or add an administrator contact later.

```sh
systemctl status certbot.timer
systemctl list-timers certbot.timer
journalctl -u certbot.service --since yesterday
certbot certificates
certbot renew --cert-name scc.rocobroker.com --dry-run
/opt/roco-seo/app/scripts/operations/reload-tls.sh
```

Certificate state under `/etc/letsencrypt` is included in the encrypted configuration backup when HTTPS is enabled. Keep both ports 80 and 443 reachable for access/renewal. Reverting HTTPS requires restoring the saved pre-HTTPS `compose.env`, removing only `config/https.enabled`, and recreating dashboard/proxy with `compose.sh`; database/worker state is unaffected.

## Deployment and service commands

Run these on the VPS. `compose.sh` consistently loads `/opt/roco-seo/config/compose.env` and the production Compose file:

```sh
cd /opt/roco-seo/app
./scripts/operations/compose.sh config --quiet
./scripts/operations/compose.sh build api
./scripts/operations/compose.sh run --rm migrate
./scripts/operations/compose.sh up -d --wait api worker dashboard proxy
./scripts/operations/compose.sh ps
./scripts/operations/compose.sh restart api worker dashboard
./scripts/operations/compose.sh logs --tail 100 api worker dashboard proxy
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/inspect.js
```

Do not use `down -v`: it deletes the database volume. Back up before migrations. Migrations are append-only; restarting the previous image cannot undo a schema change. Releasing a new image should use a unique tag in `compose.env`, build that tag, migrate, then recreate services. Keep the previous image and encrypted backup until validation passes. Runtime containers use a non-root Node identity, read-only application files, dropped capabilities, memory limits and temporary writable caches. The image currently retains source and build tooling; reducing it is a future optimization.

## Secrets and identity

Secrets live outside source under `/opt/roco-seo/secrets`; parent directory mode 0700 restricts host access. Compose mounts only each process's required files. Mounted files are 0444 so non-root container identities can read them; their host parent remains private. Google keys use a dedicated UID 1000 directory and mode 0400. `production.env` contains nonsecret configuration only. Do not supply both a secret value and its `_FILE` alternative.

The generated human identity has VIEWER, OPERATOR, APPROVER and SPECIAL_APPROVER permissions. The separate SERVICE identity runs measurements. Neither grants website write access. The bootstrap script inserts identities without overwriting existing rows. Rotating actor credentials requires editing `workflow_access`, recreating API, and restarting dashboard to invalidate stored sessions. Do not rerun `init-secrets.py` on an existing installation; it intentionally refuses replacement.

## Google setup: required administrator actions

1. In Google Cloud, create/select a project. Enable Google Search Console API and Google Analytics Data API. Enable PageSpeed Insights API if using an API key.
2. Create a dedicated service account, with no project administrator/editor role. Create/download a JSON key using the [Google Cloud key instructions](https://docs.cloud.google.com/iam/docs/keys-create-delete). It contains a private key; keep it outside this repository.
3. Copy its `client_email` into Search Console Settings → Users and permissions for the existing RocoBroker property. Grant Restricted access first and verify Search Analytics access; no ownership is required. See [Search Console permission details](https://support.google.com/webmasters/answer/7687615?hl=en). Record the exact property string: a domain property is `sc-domain:rocobroker.com`; a URL-prefix property must match its exact URL, including trailing slash.
4. In GA4 Admin → Property access management, add the same email as Viewer. Supply the numeric GA4 **property ID**, not the `G-...` measurement ID. Confirm which GA4 property contains rocobroker.com traffic and its reporting timezone.
5. Optionally create an API key restricted to PageSpeed Insights API and the VPS egress address. Save only its value to a private local file; it is mounted exclusively into the worker.
6. Provide the local credential file path, exact Search Console property and numeric GA4 ID. Do not paste keys in chat. The operator can upload securely:

```sh
scp /private/service-account.json root@31.57.24.70:/opt/roco-seo/secrets/google/service-account.json
ssh root@31.57.24.70 'chown 1000:1000 /opt/roco-seo/secrets/google/service-account.json; chmod 400 /opt/roco-seo/secrets/google/service-account.json'
```

On the VPS, edit `/opt/roco-seo/config/production.env`:

```dotenv
GOOGLE_SITE_ID=2be1e815-cd6a-479f-a18c-7bb6a9b4b166
GOOGLE_CREDENTIALS_FILE=/run/google/service-account.json
GSC_PROPERTY=<exact authorized property>
GA4_PROPERTY_ID=<numeric property ID>
GOOGLE_FINALITY_DAYS=3
GOOGLE_SCHEDULES_ENABLED=false
```

Recreate the worker after configuration changes. Start with a 3-day historical window ending at least 3 days ago. Test PAGE, QUERY and PAGE_QUERY separately, then GA4 and PageSpeed. Check rows, dates, URL mappings, failures, quotas and source freshness before a 90-day backfill or enabling schedules. Never add totals from GSC dimension sets together. Missing rows are not zero-performance evidence. Imports stop explicitly at 100 requests or 100,000 rows; reduce the date window rather than accepting truncation.

Default daily schedules target UTC today minus `GOOGLE_FINALITY_DAYS`. GSC requests use finalized data. A delay does not guarantee GA4 finality: inspect property timezone and late-arriving data, and rerun windows where appropriate. The [GSC Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) documents final/incomplete data and row limits; the [GA4 Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart) describes property access for service accounts.

## Safe operational API commands

Create JSON request files in `/opt/roco-seo/operations`, readable by UID 1000. The compiled CLI loads the appropriate mounted credential in-process; credentials never appear in command arguments. It prints only a bounded status summary. Optional full responses are private output files. Example pilot file:

```json
{
  "idempotencyKey": "phase75-pilot-20261008",
  "maxPages": 30,
  "maxDepth": 10,
  "concurrency": 1,
  "requestsPerSecond": 0.5
}
```

```sh
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/crawls /operations/pilot-crawl.json /operations/pilot-result.json
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow GET /crawls/<run-id>/summary
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow POST /crawls/<run-id>/cancel
```

For the full approved bounded run, use a different idempotency key and `maxPages: 500`, keeping concurrency 1 and 0.5 requests/second. Stop on sustained throttling, server errors or scope problems. The budget is an upper limit, not evidence that every URL on the website was discovered. Rendering fallback remains disabled.

Google request file example (replace dates with an explicit approved historical window):

```json
{
  "idempotencyKey": "gsc-page-window-001",
  "startDate": "2026-09-28",
  "endDate": "2026-09-30",
  "dimensionSet": "PAGE"
}
```

```sh
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/integrations/gsc/sync /operations/gsc-page.json /operations/gsc-result.json
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow GET /integration-syncs/<run-id>
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js workflow GET /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/integrations/freshness
```

Repeat GSC with separate QUERY/PAGE_QUERY keys; use the same provider route with `ga4` and dates, or `pagespeed` with `urls` and `strategies` (mobile/desktop). Inspect schema and data before proceeding. After healthy crawl and Google imports, run opportunities through the `opportunities` credential with a request conforming to `docs/runbooks/opportunities.md`:

```sh
./scripts/operations/compose.sh run --rm --no-deps operations node scripts/dist/api-command.js opportunities POST /sites/2be1e815-cd6a-479f-a18c-7bb6a9b4b166/opportunity-runs /operations/opportunity-run.json /operations/opportunity-result.json
```

## AI, approvals and measurements

The user has approved a Supervisor-only OpenAI connection using GPT-6.1 Sol, medium reasoning and a $20/month application cap. `infrastructure/supervisor-policy.json` contains the nonsecret reviewed limits; only the SUPERVISOR route is active. The root local `.env` variable `OPENAIKEY` is explicitly provisioned into the worker-only file secret, not reused through a general ambient fallback. Put the key in `secrets/llm_openai_key`, configure reviewed `LLM_POLICY_JSON` in `production.env`, then recreate worker. Use `docs/runbooks/agents.md` and evaluate 5–15 real opportunities for evidence, schema validity, unsupported claims, cost and failure behavior. Do not reuse an ambient workstation key without approval.

Approval operates only on recommendations and audit history. Approval does not apply website changes. Recording implementation means a human confirms an actual external change and supplies evidence; never record a fictional implementation to create production measurements. Phase 6 integration tests cover T+30/T+60/T+90 plan creation and immutable measurement results. Future plans live in PostgreSQL; the worker reconciles persisted schedules on boot. Pending real changes and healthy Google data, production outcome measurements cannot be verified or described as successful.

## Backups and restore

Daily encrypted database dumps run at 02:30 UTC (06:00 Tehran), with up to 5 minutes jitter and 30-day local retention. Backups include domain tables and pg-boss state. Public age recipient: `/opt/roco-seo/config/backup-recipient.txt`. The recovery identity must be kept OFF the VPS in secure offline storage; the workstation copy is `tmp/roco-production-backup-identity.txt`. Losing this key makes backups unrecoverable. The same daily job produces a separate encrypted configuration/secrets archive; database dumps do not contain them. The archive excludes the private backup recovery identity. Offsite storage must be provisioned separately: local dumps cannot survive VPS/disk loss.

```sh
./scripts/operations/backup.sh
systemctl status roco-backup.timer
systemctl list-timers roco-backup.timer
journalctl -u roco-backup.service --since yesterday
# Temporarily upload the offline identity for a drill, never print it.
./scripts/operations/restore.sh /opt/roco-seo/backups/<dump>.dump.age /private/offline-age-identity roco_restore_drill_001
```

Restore refuses existing targets and accepts only new `roco_restore_*` database names. It verifies the checksum and stops on restore errors. Validate row counts, migrations, constraints and queue records before planning a production cutover. It does not change production connections. Remove any temporary VPS identity after the drill. Do not start a worker against a restored copy on the production network: copied queued work could contact external providers.

## Logging, health and incident response

API logs include request IDs and latency; domain jobs include run IDs, timestamps, status and classified failures. Raw caught error messages/stacks are suppressed to avoid leaking SQL/provider payloads. Nginx logs status, method, request ID and latency without query strings, IP addresses or request paths. Docker logs rotate at 10 MB × 5 per process. Do not enable raw provider bodies, bearer headers, model prompts or credentials in logs.

API readiness checks PostgreSQL and queue schema; worker heartbeat checks event-loop freshness plus database/queue connectivity every 15 seconds. This does not prove each external job succeeds. Docker marks unhealthy services but does not restart merely because of unhealthy status; investigate and restart after correcting the cause. Process crashes restart automatically. Inspect FAILED/PARTIAL domain runs, stale source dates, failed queue counts, disk usage, memory and backup timestamps daily. No outbound alerts or monitoring recipient is configured yet.

For a crawl/import incident: stop new dispatch, cancel affected crawl, inspect safe run failures and service health, reduce window/rate if justified, and reuse logical idempotency keys on retries. Disable Google/measurement flags then recreate worker to remove persisted schedules. Disabling schedules does not cancel already queued jobs. Restarting does not erase delayed work. Never delete history to hide failures.

## Isolated measurement/restart recovery validation

After verifying a restore, this test command clears copied queue work **only in the disposable restored database**, runs fixture approvals/virtual-time measurements, verifies delayed jobs and measurement plans across restart, and prints horizon counts. It refuses any target without the `roco_restore_` prefix. It does not claim that a real recommendation or website change occurred.

```sh
docker compose --env-file /opt/roco-seo/config/compose.env -f /opt/roco-seo/app/infrastructure/compose.production.yaml -f /opt/roco-seo/app/infrastructure/compose.recovery-validation.yaml run --rm --no-deps operations node scripts/dist/validate-recovery.js roco_restore_drill_20261008
```

### Supervisor rollout safeguards

The initial Supervisor can analyze only frozen opportunities scoring at least 75, with a $0.10/run ceiling, one attempt, 12 KB request cap and 2,048 total completion tokens. Truncated output fails safely rather than triggering paid repair calls. No specialist or automatic AI schedule is enabled. The $20 shared monthly cap uses conservative estimated/reserved charges; it does not control other applications using the same provider account. The credential/model metadata probe makes no inference request. Connect Google and generate healthy real opportunities before the first live recommendation evaluation.

## Integrations dashboard

Use the Integrations sidebar view to inspect agent activation, worker health, OpenAI key/model access and the application budget before any analysis. Operators can request a metadata-only check; viewers cannot. Checks also run at startup/every 15 minutes. Worker status expires after 45 seconds and checks after 20 minutes. Google cards show deployment configuration and selected-site stored history, not live credential validation. See `INTEGRATIONS_STATUS.md` for recovery and failure semantics.
