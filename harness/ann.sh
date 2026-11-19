#!/usr/bin/env bash
# ann.sh <run>...: tests that passed only because a known intermittent defect was tolerated
for r in "$@"; do
  f=~/.cache/channels-perf-b/e2e/$r/playwright-report.json
  [ -f "$f" ] || continue
  echo "$r: $(jq -r '[.. | objects | select(has("specs")) | .specs[] | select(any(.tests[]?; any(.annotations[]?; .type=="intermittent-defect"))) | .title | split(" ")[0]] | unique | join(" ")' "$f")"
done
