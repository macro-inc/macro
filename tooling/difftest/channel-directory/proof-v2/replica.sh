#!/usr/bin/env bash
# A lagging read replica for the gqlchan stack: a hot standby of the stack's
# Postgres, inside the same container on port 5433, that applies each commit
# LAG after it happened. DSS's read-only pool (GraphQL soup lists) is pointed
# at it, so GraphQL reads lag the primary the way a production replica can.
# Usage: replica.sh up [lag] | down | status | lsn | wait <lsn> [timeout_s]
set -euo pipefail
repo="${REPO_ROOT:?set REPO_ROOT to the macro checkout}"
here="$(cd "$(dirname "$0")" && pwd)"
pg=macro-gqlchan-postgres-1
standby=/tmp/standby-gqlchan
compose=(docker compose --project-directory "$repo" -p macro-gqlchan
  -f "$repo/docker/docker-compose.yml"
  -f "$repo/infra/local/generated/gqlchan/docker-compose.override.yml"
  --env-file "$repo/infra/local/generated/gqlchan/local.generated.env")
export COMPOSE_PROJECT_NAME=macro-gqlchan MACRO_ENV_FILE=infra/local/generated/gqlchan/local.generated.env

primary() { docker exec "$pg" psql -U user -d macrodb -Atc "$1"; }
replica() { docker exec "$pg" psql -U user -d macrodb -p 5433 -Atc "$1"; }

case "${1:-status}" in
  up)
    lag="${2:-2s}"
    if ! docker exec -u postgres "$pg" test -d "$standby"; then
      docker exec -u postgres "$pg" pg_basebackup -h 127.0.0.1 -p 5432 -U user \
        -D "$standby" -R -X stream -c fast
    fi
    # A standby left running by an earlier run is reused; the query below
    # prints the lag it applies.
    if ! docker exec -u postgres "$pg" /usr/lib/postgresql/18/bin/pg_ctl -D "$standby" status >/dev/null; then
      docker exec -u postgres "$pg" bash -c "cat >> $standby/postgresql.auto.conf <<EOF
port = 5433
max_connections = 500
shared_preload_libraries = 'pg_stat_statements'
hot_standby = on
recovery_min_apply_delay = '$lag'
EOF"
      docker exec -u postgres "$pg" /usr/lib/postgresql/18/bin/pg_ctl -D "$standby" \
        -l "$standby.log" -w start
    fi
    cat > "$here/dss-replica.compose.yml" <<'EOF'
services:
  document_storage_service:
    environment:
      DATABASE_URL_READONLY: postgres://user:password@postgres:5433/macrodb
EOF
    "${compose[@]}" -f "$here/dss-replica.compose.yml" up -d --no-deps --force-recreate \
      document_storage_service
    # DSS answers 502 until its health check passes.
    for _ in $(seq 90); do
      [ "$(docker inspect macro-gqlchan-document_storage_service-1 --format "{{.State.Health.Status}}")" = healthy ] && break
      sleep 2
    done
    replica "select pg_is_in_recovery(), current_setting('recovery_min_apply_delay')"
    ;;
  down)
    "${compose[@]}" up -d --no-deps --force-recreate document_storage_service
    docker exec -u postgres "$pg" /usr/lib/postgresql/18/bin/pg_ctl -D "$standby" -w stop || true
    # Only the standby directory this script made.
    docker exec -u postgres "$pg" rm -rf /tmp/standby-gqlchan /tmp/standby-gqlchan.log
    ;;
  status)
    docker exec "$pg" bash -c 'ls -d /tmp/standby-gqlchan 2>/dev/null || echo "no standby"'
    replica "select pg_is_in_recovery(), pg_last_wal_replay_lsn(), now() - pg_last_xact_replay_timestamp()" || true
    docker inspect macro-gqlchan-document_storage_service-1 \
      --format '{{range .Config.Env}}{{println .}}{{end}}' | grep READONLY
    ;;
  lsn)
    primary "select pg_current_wal_lsn()"
    ;;
  wait)
    target="$2"
    timeout="${3:-30}"
    started=$(date +%s)
    while :; do
      done_=$(replica "select pg_last_wal_replay_lsn() >= '$target'::pg_lsn")
      [ "$done_" = t ] && exit 0
      [ $(( $(date +%s) - started )) -ge "$timeout" ] && { echo "replica behind $target" >&2; exit 1; }
      sleep 0.2
    done
    ;;
esac
