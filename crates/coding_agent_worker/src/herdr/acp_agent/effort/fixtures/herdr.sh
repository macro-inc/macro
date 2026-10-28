#!/bin/sh
cd ROOT
printf '%s\n' "$*" >> calls
stage=$(cat stage)
case "$2" in
  get)
    status=idle
    if [ "$stage" = 3 ] && [ -e fail ]; then status=working; fi
    printf '{"result":{"agent":{"agent_status":"%s","state_change_seq":1}}}\n' "$status" ;;
  read) cat "screen$stage" ;;
  prompt)
    [ "$4" = /model ] || exit 1
    printf 1 > stage ;;
  send-keys)
    case "$stage:$4" in
      1:2) printf 2 > stage ;;
      2:3) printf 3 > stage ;;
      *) exit 1 ;;
    esac ;;
  *) exit 1 ;;
esac
