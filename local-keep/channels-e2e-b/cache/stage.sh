#!/usr/bin/env bash
# stage.sh <name>: serve bundle <name> from my instance.
set -euo pipefail
d=$HOME/.cache/channels-e2e-b
dest=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b/infra/local/generated/$(cat $HOME/.cache/channels-e2e-b/inst)/frontend
test -f "$d/bundles/$1/index.html"
find "$dest" -mindepth 1 -delete
cp -a "$d/bundles/$1/." "$dest/"
echo "$1" > $d/staged
