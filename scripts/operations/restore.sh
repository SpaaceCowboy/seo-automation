#!/bin/bash
set -euo pipefail
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
backup=${1:?Provide an encrypted dump}
identity=${2:?Provide the offline age identity file}
target=${3:?Provide a NEW database name starting roco_restore_}
[[ "$target" =~ ^roco_restore_[a-z0-9_]+$ ]] || { echo 'Restore target must be a new roco_restore_ database'; exit 1; }
sha256sum --check "$backup.sha256"
compose="$root/app/scripts/operations/compose.sh"
# createdb fails if the target already exists. No --clean/drop is allowed here.
"$compose" exec -T postgres sh -c 'export PGPASSWORD="$(cat /run/secrets/postgres_password)"; exec createdb -U postgres -O roco_seo "$1"' sh "$target"
age -d -i "$identity" "$backup" | "$compose" exec -T postgres sh -c 'export PGPASSWORD="$(cat /run/secrets/database_password)"; exec pg_restore -U roco_seo --exit-on-error --no-owner --no-privileges -d "$1"' sh "$target"
echo "Restore completed in isolated database $target; production has not been switched."
