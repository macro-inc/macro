#!/usr/bin/env bash
# engine-check.sh <engine build time, epoch s>: fails if the cache engine was built before the last commit to its crates.
root=/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-b
last=$(git -C $root log -1 --format=%ct -- crates/client crates/predicate_index crates/soup_filter_cache_adapter crates/soup_filter_projection)
[ -n "$1" ] && [ "$1" -ge "$last" ] || { echo "STALE ENGINE: built $(date -d @${1:-0} +%FT%T), crates/client last changed $(date -d @$last +%FT%T). Run: cd apps/web && just ensure-cache-wasm (or build-cache-wasm), then rebuild the bundles." >&2; exit 3; }
