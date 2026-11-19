#!/usr/bin/env bash
# fails.sh [report.json]: one short block per failed test from the Playwright JSON report.
r=${1:-$HOME/.cache/channels-e2e/runs/22609/playwright-report.json}; case $r in [0-9]*) r=$HOME/.cache/channels-e2e/runs/$r/playwright-report.json;; esac
jq -r '[.. | objects | select(has("specs")) | .specs[]] | .[] | select(.ok|not) | "## \(.title)\n\(.tests[0].results[-1].error.message // "" | gsub("\u001b\\[[0-9;]*m";"") | split("\n") | .[0:'"${LINES_PER:-14}"'] | join("\n"))\n"' "$r"
