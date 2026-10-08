#!/bin/bash
set -euo pipefail
umask 077
root=${ROCO_INSTALL_DIR:-/opt/roco-seo}
source "$root/config/backup.env"
: "${ROCO_BACKUP_RECIPIENT:?Set an age public recipient}"
mkdir -p "$root/backups"
exec 9>"$root/backups/.backup.lock"
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$root/backups/roco-$stamp.dump.age"
configuration="$root/backups/roco-config-$stamp.tar.age"
configuration_partial="$configuration.partial"
partial="$target.partial"
trap 'rm -f "$partial" "$configuration_partial"' EXIT
"$root/app/scripts/operations/compose.sh" exec -T postgres sh -c 'export PGPASSWORD="$(cat /run/secrets/database_password)"; exec pg_dump -U roco_seo -d roco_seo --format=custom --no-owner --no-privileges' | age -r "$ROCO_BACKUP_RECIPIENT" -o "$partial"
test -s "$partial"
mv "$partial" "$target"
sha256sum "$target" > "$target.sha256"
tls_paths=()
if [ -f "$root/config/https.enabled" ]; then
  test -d /etc/letsencrypt
  tls_paths=(-C / etc/letsencrypt)
fi
tar -C "$root" --exclude=secrets/backup_identity -czf - config secrets operations/identities.json "${tls_paths[@]}" | age -r "$ROCO_BACKUP_RECIPIENT" -o "$configuration_partial"
test -s "$configuration_partial"
mv "$configuration_partial" "$configuration"
sha256sum "$configuration" > "$configuration.sha256"
find "$root/backups" -name 'roco-*.dump.age*' -mtime +30 -delete
find "$root/backups" -name 'roco-config-*.tar.age*' -mtime +30 -delete
echo "Encrypted database and configuration backup completed: $(basename "$target")"
