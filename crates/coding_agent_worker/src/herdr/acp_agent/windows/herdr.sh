#!/bin/sh
set -eu
fixture_dir=$(dirname "$0")
printf '%s\n' "$*" >> "$fixture_dir/calls"
case "$1 $2" in
  'agent get') cat "$fixture_dir/agent.json" ;;
  'workspace create')
    printf '%s\n' '{"result":{"workspace":{"workspace_id":"w2"},"root_pane":{"pane_id":"w2:p1","tab_id":"w2:t1"}}}'
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
  'tab close'|'tab rename'|'workspace close'|'workspace rename') ;;
  *) exit 2 ;;
esac
