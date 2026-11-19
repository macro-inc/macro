#!/usr/bin/env bash
# ABAB on one running stack: main bundle against the top-of-reads bundle, both built with the GraphQL flag on.
set -uo pipefail
D=/home/teo/.cache/channels-perf-b; R=/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
STAGED=$R/infra/local/generated/channels-b/frontend
NODE=/nix/store/lnfxdsvvm1srsa9kk94s7jqw06yq1h2d-nodejs-24.18.0/bin/node
\cd $R
swap() { cp -a $D/tmp/bundle-$1/. $STAGED/; sleep 2; echo "--- bundle $1 $(date -u +%T) served=$(curl -sk https://localhost:31009/app/ | md5sum | cut -c1-8) want=$(md5sum < $D/tmp/bundle-$1/index.html | cut -c1-8)"; }
run() { # tag settle scenario [flags]
  local tag=$1 settle=$2; shift 2
  echo "=== $tag s=$settle $* $(date -u +%T) load=$(cut -d' ' -f1 /proc/loadavg)"
  SESSION_SETTLE_MS=$settle TMPDIR=$D/tmp timeout -k 20 1500 $NODE $D/ab.cjs "$@" --n 4 --sizes medium --tag $tag 2>&1 | grep -E "ERROR|TIMEOUT" | cut -c1-220
}
for round in 1 2 3; do
  for b in main reads; do
    swap $b; t=$b-r$round
    run $t 25000 held; run $t 25000 held --throttle
    run $t 6000 held;  run $t 6000 held --throttle
    run $t 6000 cold_fresh; run $t 6000 cold_fresh --throttle
    run $t 25000 offline
    if [ $b = reads ]; then for s in 6000 9000 12000 25000; do run $t $s probe; done; fi
  done
done
swap reads
echo "ALL_DONE $(date -u +%T)"
