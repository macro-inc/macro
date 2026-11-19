#!/usr/bin/env bash
# Main on a stack whose database also has the branch's migrations: let main's migrate run
# pass over migrations it does not know (they only add a table and an index).
shim=$(dirname "$(readlink -f "$0")")
real=$(PATH=$(printf %s "$PATH" | tr : "\n" | grep -vx "$shim" | paste -sd:) command -v sqlx)
if [ "${1:-} ${2:-}" = "migrate run" ]; then shift 2; exec "$real" migrate run --ignore-missing "$@"; fi
exec "$real" "$@"
