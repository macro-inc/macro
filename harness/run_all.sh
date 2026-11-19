#!/usr/bin/env bash
# Run every browser measurement sequentially. Logs to run_all.log; results in results/*.json.
set -uo pipefail
cd /home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
export TMPDIR=/home/teo/.cache/channels-perf-b/tmp
NODE=/nix/store/lnfxdsvvm1srsa9kk94s7jqw06yq1h2d-nodejs-24.18.0/bin/node
M=/home/teo/.cache/channels-perf-b/measure.cjs
N=${N:-10}
for s in "cold_fresh" "session" "jump_old" "jump_reply" "cold_login" "cold_fresh --throttle" "session --throttle" "cold_login --throttle"; do
  echo "=== $s $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  $NODE $M $s --n $N || echo "FAILED: $s"
done
echo "ALL_DONE $(date -u +%T)"
