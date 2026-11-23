set -euo pipefail

# Each stack runs services with their own connection pools. The next step
# restarts Postgres to apply the limit.
postgres_container="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 == "pgvector/pgvector:pg14" { print $1; exit }')"
docker exec -i "$postgres_container" psql -X -v ON_ERROR_STOP=1 -U user -d macrodb \
  -v max_connections="$POSTGRES_MAX_CONNECTIONS" <<'SQL'
ALTER SYSTEM SET max_connections = :'max_connections';
SQL
