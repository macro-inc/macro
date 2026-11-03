#!/bin/sh
set -eu
fixture_dir=$(dirname "$0")
printf '%s\n' "$*" >> "$fixture_dir/calls"
case "$1" in
  get|agent) cat "$fixture_dir/agent.json" ;;
  read)
    if [ -f "$fixture_dir/unsteady" ]; then
      count=$(cat "$fixture_dir/read-count" 2>/dev/null || printf 0)
      count=$((count + 1))
      printf '%s' "$count" > "$fixture_dir/read-count"
      printf 'Still working: %s\n' "$count"
    else
      printf 'Ready for a prompt\n'
    fi
    ;;
  send) ;;
  *) exit 2 ;;
esac
