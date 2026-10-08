#!/bin/sh
set -eu
# Only the initial empty-volume boot runs this; changing files never rotates roles.
app_password=$(cat /run/secrets/database_password)
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=app_password="$app_password" <<'SQL'
CREATE ROLE roco_seo LOGIN PASSWORD :'app_password';
ALTER DATABASE roco_seo OWNER TO roco_seo;
GRANT USAGE, CREATE ON SCHEMA public TO roco_seo;
SQL
