#!/bin/sh
set -eu
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
if [ -f "$root/config/staff.enabled" ]; then
  test -f "$root/config/https.enabled" || { echo "Staff mode requires HTTPS" >&2; exit 1; }
  if [ -z "${ROCO_APP_IMAGE:-}" ]; then
    test -r "$root/config/staff-image" || { echo "Staff image tag is not configured" >&2; exit 1; }
    IFS= read -r ROCO_APP_IMAGE < "$root/config/staff-image"
    case "$ROCO_APP_IMAGE" in roco-seo:staff-*) ;; *) echo "Invalid staff image tag" >&2; exit 1 ;; esac
    export ROCO_APP_IMAGE
  fi
  exec docker compose --env-file "$root/config/compose.env" -f "$root/app/infrastructure/compose.production.yaml" -f "$root/app/infrastructure/compose.https.yaml" -f "$root/app/infrastructure/compose.staff.yaml" "$@"
fi
if [ -f "$root/config/https.enabled" ]; then
  exec docker compose --env-file "$root/config/compose.env" -f "$root/app/infrastructure/compose.production.yaml" -f "$root/app/infrastructure/compose.https.yaml" "$@"
fi
exec docker compose --env-file "$root/config/compose.env" -f "$root/app/infrastructure/compose.production.yaml" "$@"
