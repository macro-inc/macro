#!/usr/bin/env bash
r=$HOME/.cache/channels-e2e-b/runs/${1:-main}/playwright-report.json
jq -r '[.. | objects | select(has("specs")) | .specs[]] | .[] | select(.ok|not) | "## \(.title)\n\(.tests[0].results[-1].error.message // "" | gsub("\u001b\\[[0-9;]*m";"") | split("\n") | .[0:'"${LINES_PER:-14}"'] | join("\n"))\n"' "$r"
