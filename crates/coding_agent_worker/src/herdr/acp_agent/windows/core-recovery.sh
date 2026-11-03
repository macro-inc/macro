#!/bin/sh
set -eu
fixture_dir=$(dirname "$0")
printf '%s\n' "$*" >> "$fixture_dir/calls"
case "$1" in
  get|agent) cat "$fixture_dir/agent.json" ;;
  read) printf 'Ready for a prompt\n' ;;
  send) ;;
  *) exit 2 ;;
esac
