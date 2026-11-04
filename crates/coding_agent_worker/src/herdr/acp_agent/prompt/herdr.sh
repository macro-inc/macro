#!/bin/sh
cd @ROOT@
printf '%s\n' "$*" >> calls
case "$1:$2" in
  agent:get) printf '{"result":{"agent":{"agent_status":"%s","state_change_seq":1}}}\n' "$(cat status)" ;;
  agent:read) ;;
  agent:prompt) cat submitted >> @TRANSCRIPT@ ;;
  *) exit 1 ;;
esac
