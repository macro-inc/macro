#!/usr/bin/env bash
# Builds a real Lambda job shape with a fresh nonce. Nothing is pushed or uploaded.
set -uo pipefail
arm=$1; shift
echo "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$arm-$ATTEMPT" > .github/ci-speed/nonce
git add .github/ci-speed/nonce
installables=(); for n in "$@"; do installables+=(".#exp-lam-$arm-$n"); done
start=$(date +%s)
nix build --max-jobs auto --no-link --print-build-logs --print-out-paths "${installables[@]}" >outs.txt 2>build.log; status=$?
end=$(date +%s)
third=$(grep -E 'Compiling ' build.log | grep -vc '(/nix/var' || true)
path=$(grep -E 'Compiling ' build.log | grep -c '(/nix/var' || true)
hashes=""; while read -r o; do [ -n "$o" ] || continue; for z in "$o"/*/bootstrap.zip; do hashes+="$(basename "$(dirname "$z")")=$(unzip -p "$z" bootstrap | sha256sum | cut -c1-16) "; done; done <outs.txt
echo "RESULT arm=$arm attempt=$ATTEMPT handlers=$# nix_build_s=$((end-start)) status=$status third_party_compiled=$third path_compiled=$path bootstrap=[$hashes] sandbox=$(nix config show sandbox 2>/dev/null)" | tee -a "$GITHUB_STEP_SUMMARY"
grep -E 'dirty:|fingerprint dirty|stale:|error(\[|:)' build.log | cut -c1-260 | head -12 || true
if [ "$status" != 0 ]; then echo "--- failing log tail"; tail -60 build.log | cut -c1-300; grep -nE 'Text file busy|Permission denied|No such file|error: |CMake Error' build.log | cut -c1-300 | head -20; ls -la /tmp | head -5; fi
exit "$status"
