#!/usr/bin/env bash
# Builds one experimental attr with a fresh nonce so only that derivation misses.
set -euo pipefail
attr=$1
echo "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$GITHUB_JOB-$attr-$ATTEMPT" > .github/ci-speed/nonce
git add .github/ci-speed/nonce
start=$(date +%s); status=0
nix build --max-jobs auto --print-build-logs --out-link result ".#$attr" 2>&1 | tee build.log | grep -E "Finished|Compiling (document_storage_service|agent_harness_service)|error" || true
status=${PIPESTATUS[0]}
end=$(date +%s)
finished=$(grep -oE 'Finished .release. profile.* in .*' build.log | tail -1 || true)
built=$(grep -cE "^building '/nix/store" build.log || true)
echo "RESULT attr=$attr attempt=$ATTEMPT nix_build_s=$((end-start)) status=$status drvs_built=$built cargo='$finished' size=$(du -sb result/bin 2>/dev/null | cut -f1)" | tee -a "$GITHUB_STEP_SUMMARY"
[ -f result/timings/cargo-timing.html ] && python3 .github/ci-speed/timings.py result/timings/cargo-timing.html | tee -a "$GITHUB_STEP_SUMMARY"
exit "$status"
