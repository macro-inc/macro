postgres_container="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 == "pgvector/pgvector:pg16" { print $1; exit }')"
if [ -z "$postgres_container" ]; then
  echo "pgvector/pgvector:pg16 service container not found" >&2
  docker ps
  exit 1
fi

docker exec -i "$postgres_container" psql -U user -d macrodb <<'SQL'
ALTER SYSTEM SET fsync = off;
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET full_page_writes = off;
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET checkpoint_timeout = '30min';
ALTER SYSTEM SET max_locks_per_transaction = 8192;
SQL
docker restart "$postgres_container"
until docker exec "$postgres_container" pg_isready -U user -d macrodb; do
  sleep 1
done
docker exec "$postgres_container" psql -U user -d macrodb -c "SHOW max_locks_per_transaction;"
