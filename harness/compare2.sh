#!/usr/bin/env bash
# Session scenarios, old against new, interleaved; plain, throttled, and with a 40 s settle (prewarm has run).
set -uo pipefail
cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
NODE=/nix/store/lnfxdsvvm1srsa9kk94s7jqw06yq1h2d-nodejs-24.18.0/bin/node
N=${N:-6}; TAG=cmp
run() { local d=$1; shift
  echo "=== $(basename $d) $* tag=$TAG $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  TMPDIR=$d/tmp $NODE $d/measure.cjs "$@" --n $N --tag $TAG 2>&1 | grep -E "ERROR|FAILED|TIMEOUT" | cut -c1-200
}
for s in "session" "session --throttle"; do
  run /home/teo/.cache/channels-perf $s; run /home/teo/.cache/channels-perf-b $s
done
export SESSION_SETTLE_MS=40000; TAG=cmp-prewarmed
for s in "session" "session --throttle"; do
  run /home/teo/.cache/channels-perf $s; run /home/teo/.cache/channels-perf-b $s
done
echo "ALL_DONE2 $(date -u +%T)"
