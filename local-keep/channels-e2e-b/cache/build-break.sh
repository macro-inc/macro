#!/usr/bin/env bash
# build-break.sh <patch>: apply a product break, build bundle break-<name>, undo the break. Stages nothing.
set -uo pipefail
d=$HOME/.cache/channels-e2e-b
patch=$(realpath "$1"); name=$(basename "$patch" .patch)
\cd /home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
git apply --check "$patch" || { echo "patch does not apply: $name"; exit 2; }
git apply "$patch"
$d/build-bundle.sh "break-$name"; built=$?
git apply -R "$patch"
[ "$built" -eq 0 ] && echo "built break-$name" || { echo "build failed: $name"; tail -20 $d/logs/bundle-break-$name.log; exit 2; }
