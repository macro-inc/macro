set -euo pipefail

# Every scenario runs two services with their own connection pools, and
# several scenarios run at once. The setting takes effect when the next step
# restarts the server.
postgres_container="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 == "pgvector/pgvector:pg14" { print $1; exit }')"
docker exec "$postgres_container" psql -U user -d macrodb -c "ALTER SYSTEM SET max_connections = 600;"
