#!/bin/sh
set -eu
fixture_dir=$(dirname "$0")
printf '%s\n' "$*" >> "$fixture_dir/calls"
case "$1 $2" in
  'agent get') cat "$fixture_dir/agent.json" ;;
  'tab create')
    printf '%s\n' '{"result":{"root_pane":{"pane_id":"w1:p2","tab_id":"w1:t2"}}}'
    ;;
  'pane get')
    if [ -f "$fixture_dir/socket-error" ]; then
      printf '%s\n' '{"error":{"code":"connection_failed"}}' >&2
      exit 1
    fi
    if [ -f "$fixture_dir/pane.json" ]; then
      cat "$fixture_dir/pane.json"
    else
      printf '%s\n' '{"error":{"code":"pane_not_found"}}' >&2
      exit 1
    fi
    ;;
  'pane process-info')
    if [ -f "$fixture_dir/occupied" ]; then
      printf '%s\n' '{"result":{"process_info":{"shell_pid":1,"foreground_process_group_id":2}}}'
    else
      printf '%s\n' '{"result":{"process_info":{"shell_pid":1,"foreground_process_group_id":1}}}'
    fi
    ;;
  'tab close'|'tab rename') ;;
  *) exit 2 ;;
esac
