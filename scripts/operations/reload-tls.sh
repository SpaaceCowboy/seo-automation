#!/bin/sh
set -eu
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
"$root/app/scripts/operations/compose.sh" exec -T proxy nginx -t
exec "$root/app/scripts/operations/compose.sh" exec -T proxy nginx -s reload
