#!/bin/sh
set -eu
fixture_dir=$(dirname "$0")
printf '%s\n' "$*" >> "$fixture_dir/calls"
case "$1 $2" in
  'agent get')
    if [ -f "$fixture_dir/agent-error" ]; then
      printf '%s\n' '{"error":{"code":"connection_failed"}}' >&2
      exit 1
    elif [ -f "$fixture_dir/agent.json" ]; then
      cat "$fixture_dir/agent.json"
    else
      printf '%s\n' '{"error":{"code":"agent_not_found"}}' >&2
      exit 1
    fi
    ;;
  'agent start')
    cp "$fixture_dir/started-agent.json" "$fixture_dir/agent.json"
    printf '%s\n' '{"error":{"code":"launch_unconfirmed"}}' >&2
    exit 1
    ;;
  'agent prompt') ;;
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
      printf '%s\n' '{"result":{"process_info":{"shell_pid":1,"foreground_process_group_id":2,"foreground_processes":[{"pid":2}]}}}'
    else
      printf '%s\n' '{"result":{"process_info":{"shell_pid":1,"foreground_process_group_id":1,"foreground_processes":[{"pid":1}]}}}'
    fi
    ;;
  'workspace close')
    if [ -f "$fixture_dir/close-error" ]; then
      printf '%s\n' '{"error":{"code":"connection_failed"}}' >&2
      exit 1
    fi
    ;;
  'tab close'|'tab rename'|'workspace rename') ;;
  *) exit 2 ;;
esac
