# Shared SCC staff login deployment

This is an opt-in integration with the independently deployed RocoBroker content admin. It adds no SEO website-write capability. Both VPSs, databases, worker schedules and workflow permissions remain separate.

## Source and service changes

- Browser entry points: `/` for SEO and `/admin` for content; shared login at `/admin/sign-in`.
- The main application owns password hashes, authenticator enrollment/recovery and PostgreSQL sessions. Password-only sessions cannot access either dashboard.
- The dashboard forwards only `__Secure-roco-staff.session_token` as a private `StaffSession` authorization value. The API independently validates every protected request with the main application's session endpoint.
- The website provides the explicitly linked SEO actor ID. SEO takes roles from its existing access registry and validates the actor through its existing HUMAN/active checks. Browser-provided roles and actor headers are never trusted.
- No process-memory session cache is used in staff mode. Revocation, account disable and the hard eight-hour expiry are checked against the authority. Authority outages fail closed; workers keep running.
- Existing private Bearer credentials for service/operations calls remain supported. The old browser credential-login endpoint is disabled only when staff configuration is enabled.

## Prerequisites

The website operator must deploy the additive migration and account scripts, link the initial account to its existing HUMAN actor, prepare mandatory authenticator MFA, allow SCC media uploads, and transfer a newly generated service key. Main-VPS instructions are in the website repository's `docs/scc-staff-deployment.md`. Do not connect to that VPS from this task.

The operator must securely place the key at `/opt/roco-seo/secrets/staff_auth_service_secret` and run:

```sh
/opt/roco-seo/app/scripts/operations/prepare-staff-key.sh
```

The helper expects a 64-character hex key, refuses an existing proxy include, prints no secret, and gives only UID/GID 1000 read permission on the individual app key (`0400`). The parent secrets directory stays root-owned `0700`; Nginx's derived include remains root-readable `0600`. Do not run `nginx -T`, which would disclose that include.

## Activation after the main operator reports readiness

Use the prepared release image/tag, leaving the previous image available. First prepare the staff image explicitly, before changing the running proxy:

```sh
cd /opt/roco-seo/app
test -f /opt/roco-seo/config/https.enabled
test -f /opt/roco-seo/secrets/staff_auth_service_secret
test -f /opt/roco-seo/secrets/staff-proxy-header.conf
staff_image='REPLACE_WITH_THE_PREPARED_STAFF_IMAGE_TAG'
ROCO_APP_IMAGE="$staff_image" docker compose --env-file /opt/roco-seo/config/compose.env \
  -f infrastructure/compose.production.yaml -f infrastructure/compose.https.yaml \
  -f infrastructure/compose.staff.yaml config --quiet
ROCO_APP_IMAGE="$staff_image" docker compose --env-file /opt/roco-seo/config/compose.env \
  -f infrastructure/compose.production.yaml -f infrastructure/compose.https.yaml \
  -f infrastructure/compose.staff.yaml build dashboard
# This checks syntax without replacing the running proxy or printing its config.
ROCO_APP_IMAGE="$staff_image" docker compose --env-file /opt/roco-seo/config/compose.env \
  -f infrastructure/compose.production.yaml -f infrastructure/compose.https.yaml \
  -f infrastructure/compose.staff.yaml run --rm --no-deps proxy nginx -t
printf '%s\n' "$staff_image" > /opt/roco-seo/config/staff-image
chmod 600 /opt/roco-seo/config/staff-image
install -m 600 /dev/null /opt/roco-seo/config/staff.enabled
ROCO_APP_IMAGE="$staff_image" ./scripts/operations/compose.sh up -d --no-deps --wait api dashboard proxy
ROCO_APP_IMAGE="$staff_image" ./scripts/operations/compose.sh ps
curl --fail --silent --show-error -o /dev/null https://scc.rocobroker.com/admin/sign-in
```

The helper reads the nonsecret `config/staff-image` tag while staff mode is enabled, so subsequent operations keep the chosen staff image without changing an existing environment file. Explicit `ROCO_APP_IMAGE` overrides remain available. Do not recreate the worker, database or migration service during this UI/auth cutover. The schema change belongs only to the website database.

`compose.staff.yaml` sets `STAFF_AUTH_URL=https://rocobroker.com/api/admin/staff-session` and the mounted service-key path for API/dashboard; it configures `/seo-static` at build and runtime. Nginx pins the website HTTPS hostname, verifies TLS, sends a dedicated proxy credential, and overwrites forwarded host/scheme/client-IP headers. Only the content admin/API/assets are forwarded; scheduled publication and session introspection are blocked on the public SCC proxy. Content JSON requests get a 1 MiB proxy limit; SEO keeps its existing smaller limits.

Confirm the blog switch, SEO permissions/actor, MFA enrollment, global logout, draft editor, uploads, publication and background-job health using the website handoff checklist. Old SCC sessions are invalidated once; refresh old tabs. Do not treat an HTTP 200 sign-in page alone as proof that the account mapping and MFA flow work.

## Rollback

The operator restores Google mode and its original origin on the website first. On SEO, remove only the staff marker, then recreate API/dashboard/proxy with the previous image:

```sh
rm /opt/roco-seo/config/staff.enabled
previous_image='REPLACE_WITH_THE_RECORDED_PREVIOUS_IMAGE_TAG'
ROCO_APP_IMAGE="$previous_image" ./scripts/operations/compose.sh up -d --no-deps --wait api dashboard proxy
```

Keep the additive website migration and authentication data. Do not remove volumes, reset queues, rewrite audit history, or rotate existing service credentials for this rollback.

## Verification

Run this repository's `pnpm test`, `pnpm typecheck`, `pnpm lint`, production build and existing browser suite. Database integration tests require a disposable loopback `TEST_DATABASE_URL`.

The website's `scripts/verify-staff-auth.ts` can additionally exercise real PostgreSQL-backed MFA sessions through the SEO API by setting `SEO_SOURCE_DIR` to this checkout after building `@roco/api` and the workspace packages. It verifies password-only denial, the actual shared-cookie name, MFA, actor/role preservation, global logout, recovery-code reuse rejection, disabled accounts and hard expiry without production credentials.
