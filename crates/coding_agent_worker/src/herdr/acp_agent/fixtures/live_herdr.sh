#!/bin/sh
# The first lookup of macro-222222222222 fails without saying the agent is
# gone, as a herdr that is briefly unavailable would.
flaked="$(dirname "$0")/flaked"
case "$1 $2 $3" in
  "agent get macro-222222222222")
    if [ ! -e "$flaked" ]; then
      : > "$flaked"
      printf '%s\n' 'herdr: server not responding' >&2
      exit 1
    fi
    printf '%s\n' '{"result":{"agent":{"agent_status":"idle","state_change_seq":1}}}' ;;
  "agent get macro-111111111111" | "agent get macro-444444444444")
    printf '%s\n' '{"result":{"agent":{"agent_status":"idle","state_change_seq":1}}}' ;;
  *)
    printf '%s\n' '{"error":{"code":"agent_not_found"}}' >&2
    exit 1 ;;
esac
