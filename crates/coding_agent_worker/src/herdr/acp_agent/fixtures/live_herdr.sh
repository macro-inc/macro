#!/bin/sh
case "$1 $2 $3" in
  "agent get macro-111111111111" | "agent get macro-222222222222" | "agent get macro-444444444444")
    printf '%s\n' '{"result":{"agent":{"agent_status":"idle","state_change_seq":1}}}' ;;
  *)
    printf '%s\n' '{"error":{"code":"agent_not_found"}}' >&2
    exit 1 ;;
esac
