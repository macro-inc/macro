#!/usr/bin/env bash
# Private Postgres 14 for this worktree's sqlx builds, tests and plans.
# Usage: pg.sh start | stop | url
set -euo pipefail
PG=/nix/store/znsip1g1bhnpqp918d709gcmx3lm0vcn-postgresql-and-plugins-14.23/bin
DATA=/home/teo/.herdr/worktrees/macro/synoet-email-focus-linked/target/focus-linked-pg
PORTFILE=$DATA.port

case "$1" in
start)
  if [ ! -d "$DATA" ]; then
    LANG=C LC_ALL=C "$PG/initdb" -D "$DATA" -U postgres --locale=C -E UTF8 -A trust >/dev/null
  fi
  # Pick a port nobody listens on.
  while :; do
    port=$(( (RANDOM % 20000) + 40000 ))
    ss -ltnH "sport = :$port" | grep -q . || break
  done
  "$PG/pg_ctl" -D "$DATA" -l "$DATA.log" -w -o "-p $port -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c max_connections=300 -c fsync=off" start >/dev/null
  echo "$port" > "$PORTFILE"
  got=$("$PG/psql" -h 127.0.0.1 -p "$port" -U postgres -Atc 'SHOW data_directory')
  if [ "$got" != "$DATA" ]; then
    echo "port $port is not my server ($got)" >&2
    exit 1
  fi
  echo "postgres://postgres@127.0.0.1:$port"
  ;;
stop)
  "$PG/pg_ctl" -D "$DATA" -m immediate stop
  ;;
url)
  echo "postgres://postgres@127.0.0.1:$(cat "$PORTFILE")"
  ;;
esac
