#!/usr/bin/env bash
# Run a local command while holding a bench host's timed lock
# (TIMED_LOCK, default /srv/locks/timed.lock; blocking, so flock queues us),
# after waiting for the host to be quiet (load < 2, no nixbld/cargo/cc1).
#
#   timed.sh '<host cmd>' <local command...>      e.g. timed.sh "ssh -F cfg bench" ./e2e.py ...
set -euo pipefail
TIMED_LOCK=${TIMED_LOCK:-/srv/locks/timed.lock}
host_cmd=$1; shift
lock_dir=$(dirname "$TIMED_LOCK")
token=$lock_dir/held-by-$USER-$$
$host_cmd "sudo mkdir -p $lock_dir && sudo flock $TIMED_LOCK sh -c 'touch $token; while [ -e $token ]; do sleep 1; done'" &
holder=$!
trap '$host_cmd "sudo rm -f $token" || true; wait $holder || true' EXIT
trap 'exit 143' INT TERM
until $host_cmd "[ -e $token ]"; do sleep 2; done
until $host_cmd "$(cat <<'HOST_CHECK'
awk "{ exit !(\$1 < 2) }" /proc/loadavg && ! pgrep -x "cc1|cc1plus|cargo|rustc" >/dev/null && ! pgrep -u nixbld1 >/dev/null
HOST_CHECK
)"; do
  echo "waiting for a quiet host: $($host_cmd 'cat /proc/loadavg')" >&2
  sleep 15
done
echo "lock held, host quiet: $($host_cmd 'cat /proc/loadavg')" >&2
"$@"
