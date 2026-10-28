#!/bin/sh
cd ROOT
printf '%s\n' "$*" >> calls
case "$1:$2" in
  tab:create)
    printf '{"result":{"root_pane":{"tab_id":"w1:t1","pane_id":"w1:p1"}}}\n' ;;
  agent:start) touch started ;;
  agent:get)
    status=idle
    if [ -e submitted ]; then status=working; fi
    printf '{"result":{"agent":{"agent_status":"%s","state_change_seq":1}}}\n' "$status" ;;
  agent:read)
    if [ -e delayed ] && [ ! -e submitted ]; then
      printf 'Starting Codex\n'
    else
      cat footer
    fi ;;
  agent:prompt) touch submitted ;;
  *) exit 1 ;;
esac
