#!/usr/bin/env bash
# Tests macro-agent-pause against a fake systemctl and systemd-run that keep
# the agent unit's state in files. Usage: test-macro-agent-pause.sh <helper>
set -eu

helper=$1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat >"$work/systemctl" <<'EOF'
#!/usr/bin/env bash
# show -P <Property> <unit> | freeze <unit> | thaw <unit> | stop <units…> | restart --no-block <unit>
fake=$FAKE
# Slow, so racing requests interleave.
[ -n "${FAKE_SLOW:-}" ] && sleep 0.05
case "$1" in
  show) cat "$fake/$3" 2>/dev/null ;;
  freeze)
    [ -e "$fake/cannot-freeze" ] && exit 1
    echo frozen >"$fake/FreezerState" ;;
  thaw) echo running >"$fake/FreezerState" ;;
  stop) for name in "${@:2}"; do [ "$name" = macro-agent-autothaw.timer ] && rm -f "$fake/armed"; done ;;
  restart) echo restarted >"$fake/restarted" ;;
esac
exit 0
EOF
cat >"$work/systemd-run" <<'EOF'
#!/usr/bin/env bash
# Records what the dead-man timer would run.
printf '%s\n' "${@: -2}" | tr '\n' ' ' >"$FAKE/armed"
EOF
# This bash, not /usr/bin/env's: the nix build sandbox has no /usr/bin/env.
sed -i "1s|.*|#!$BASH|" "$work/systemctl" "$work/systemd-run"
chmod +x "$work/systemctl" "$work/systemd-run"

reset() {
  rm -rf "$work/fake" "$work/run"
  mkdir -p "$work/fake" "$work/run"
  echo active >"$work/fake/ActiveState"
  echo running >"$work/fake/FreezerState"
}

ask() {
  FAKE=$work/fake \
    FAKE_SLOW=${slow:-} \
    MACRO_AGENT_PAUSE_DIR=$work/run \
    MACRO_AGENT_PAUSE_SYSTEMCTL=$work/systemctl \
    MACRO_AGENT_PAUSE_SYSTEMD_RUN=$work/systemd-run \
    MACRO_AGENT_PAUSE_SELF=helper \
    bash "$helper" "$@"
}

expect() {
  local what=$1 got=$2 want=$3
  if [ "$got" != "$want" ]; then
    echo "FAIL: $what: got '$got', want '$want'" >&2
    exit 1
  fi
  echo "ok: $what"
}

frozen() { cat "$work/fake/FreezerState"; }

reset
expect "a freeze freezes the agent" "$(ask freeze aa)" frozen
expect "and arms the dead-man timer for its drive" "$(cat "$work/fake/armed")" "autothaw aa "
expect "a thaw of that drive thaws it" "$(ask thaw aa)" running
expect "the agent runs again" "$(frozen)" running
expect "and the timer is gone" "$([ -e "$work/fake/armed" ] && echo armed || echo none)" none

reset
ask freeze aa >/dev/null
expect "a newer drive's freeze" "$(ask freeze bb)" frozen
expect "a late thaw of the older drive is superseded" "$(ask thaw aa)" superseded
expect "and leaves the agent frozen" "$(frozen)" frozen
expect "the older drive's keep is superseded too" "$(ask keep aa)" superseded
expect "the newer drive's keep re-arms" "$(ask keep bb)" frozen
expect "for the newer drive" "$(cat "$work/fake/armed")" "autothaw bb "
expect "the newer drive's thaw thaws it" "$(ask thaw bb)" running

reset
ask freeze aa >/dev/null
expect "the dead-man timer thaws a drive nobody kept" "$(ask autothaw aa)" running
expect "the agent runs again after the timer" "$(frozen)" running

reset
ask freeze aa >/dev/null
ask freeze bb >/dev/null
expect "the older drive's timer is superseded" "$(ask autothaw aa)" superseded
expect "and leaves the newer freeze" "$(frozen)" frozen

reset
echo inactive >"$work/fake/ActiveState"
expect "an agent that isn't running has nothing to freeze" "$(ask freeze aa)" idle
touch "$work/run/restart"
expect "its thaw still clears the drive" "$(ask thaw aa)" running
expect "and runs the restart asked for meanwhile" "$(cat "$work/fake/restarted")" restarted

reset
touch "$work/fake/cannot-freeze"
expect "a unit that won't freeze fails the take-over" "$(ask freeze aa)" failed

reset
expect "a drive that isn't hex is refused" "$(ask freeze 'a;b')" refused
expect "an unknown verb is refused" "$(ask unpause aa)" refused
expect "a request on stdin works like arguments" "$(echo 'freeze aa' | ask)" frozen

# A slow late thaw racing a newer freeze, twenty times: whatever the order, the
# newer drive stays frozen.
for round in $(seq 1 20); do
  reset
  ask freeze aa >/dev/null
  slow=1 ask thaw aa >"$work/thaw" &
  # The thaw has read whose freeze it is; then the next take-over comes.
  sleep 0.02
  ask freeze bb >"$work/freeze" &
  wait
  if [ "$(cat "$work/run/paused")" != bb ] || [ "$(frozen)" != frozen ]; then
    echo "FAIL: round $round: a late thaw undid the newer freeze" >&2
    exit 1
  fi
done
echo "ok: a late thaw never undoes a newer freeze (20 races)"
