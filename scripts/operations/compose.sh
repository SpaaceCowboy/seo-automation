#!/bin/sh
set -eu
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
if [ -f "$root/config/https.enabled" ]; then
  exec docker compose --env-file "$root/config/compose.env" -f "$root/app/infrastructure/compose.production.yaml" -f "$root/app/infrastructure/compose.https.yaml" "$@"
fi
exec docker compose --env-file "$root/config/compose.env" -f "$root/app/infrastructure/compose.production.yaml" "$@"
