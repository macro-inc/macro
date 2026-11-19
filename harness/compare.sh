#!/usr/bin/env bash
# Old (baseline instance) against new (channels-b), interleaved per scenario so both see the same machine load.
set -uo pipefail
cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
NODE=/nix/store/lnfxdsvvm1srsa9kk94s7jqw06yq1h2d-nodejs-24.18.0/bin/node
N=${N:-6}; TAG=${TAG:-cmp}
run() { # dir scenario...
  local d=$1; shift
  echo "=== $(basename $d) $* $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  TMPDIR=$d/tmp $NODE $d/measure.cjs "$@" --n $N --tag $TAG 2>&1 | grep -E "ERROR|FAILED" | cut -c1-200
}
for s in "cold_fresh" "session" "jump_old" "jump_reply" "cold_login" "cold_fresh --throttle" "session --throttle"; do
  run /home/teo/.cache/channels-perf $s
  run /home/teo/.cache/channels-perf-b $s
done
export SESSION_SETTLE_MS=40000; TAG=${TAG}-prewarmed
run /home/teo/.cache/channels-perf session
run /home/teo/.cache/channels-perf-b session
run /home/teo/.cache/channels-perf session --throttle
run /home/teo/.cache/channels-perf-b session --throttle
echo "ALL_DONE $(date -u +%T)"
