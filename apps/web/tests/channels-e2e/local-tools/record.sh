#!/usr/bin/env bash
# record.sh <port> <name>: one whole-suite run with a video and a trace of every test, two workers,
# and Playwright's HTML report written to ~/.cache/channels-e2e/runs/report-<name>/.
port=$1; name=$2
R=$HOME/.cache/channels-e2e/runs
export RUN_TAG=video CHANNELS_E2E_VIDEO=1 CHANNELS_E2E_WORKERS=2
export PLAYWRIGHT_HTML_OUTPUT_DIR=$R/report-$name PLAYWRIGHT_HTML_OPEN=never
export PLAYWRIGHT_JSON_OUTPUT_FILE=$R/$port-video/playwright-report.json PLAYWRIGHT_JSON_OUTPUT_NAME=$R/$port-video/playwright-report.json
exec ~/.cache/channels-e2e/run.sh "$port" --reporter=list,json,html --trace on
