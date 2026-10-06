#!/usr/bin/env bash
set -euo pipefail

# This migration reached PostgreSQL 16 dev before failing on PostgreSQL 14 prod.
# Its replacement uses an ordinary unique constraint plus a partial unique
# index with the same semantics under the table's all-or-none NULL check.
# Accept only the exact original/replacement pair; never disable SQLx validation.
: "${DATABASE_URL:?DATABASE_URL must point to the database being migrated}"
script_dir="$(\cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migration="$script_dir/migrations/20260930171728_slack_archive_import.sql"
original=50664e463b281bb142eaa1b6c8f34fe2d3c81e0bfb761276ca9e2eb31988c6f2825393e56396c2d1c0f86df0f7ce919a
replacement=9c725b318569bc826b32a8e1dd06f9a3fbccd340ab9e5ed65445a375a05c823729cdb4f56a4744697a35bc82c7914fa3
actual="$(openssl dgst -sha384 "$migration")"
if [[ "${actual##* }" != "$replacement" ]]; then
  echo 'Refusing checksum reconciliation: unexpected Slack archive migration contents.' >&2
  exit 1
fi

psql --dbname="$DATABASE_URL" -X --set=ON_ERROR_STOP=1 \
  --set=original="$original" --set=replacement="$replacement" <<'SQL'
SELECT to_regclass('public._sqlx_migrations') IS NOT NULL AS has_history \gset
\if :has_history
BEGIN;
UPDATE public._sqlx_migrations
SET checksum = decode(:'replacement', 'hex')
WHERE version = 20260930171728
  AND success
  AND checksum = decode(:'original', 'hex');
COMMIT;
\endif
SQL
