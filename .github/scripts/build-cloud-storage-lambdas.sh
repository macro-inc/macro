#!/usr/bin/env bash
set -euo pipefail

SERVICE="${SERVICE:?SERVICE is required}"
OUTPUT_DIR="${OUTPUT_DIR:-lambda-artifacts}"
CONFIG_PATH="${CONFIG_PATH:-.github/services-config.json}"

if ! jq -e --arg service "$SERVICE" '.services | has($service)' "$CONFIG_PATH" >/dev/null; then
  echo "Service '$SERVICE' not found in $CONFIG_PATH" >&2
  exit 1
fi

mapfile -t LAMBDAS < <(jq -r --arg service "$SERVICE" '.services[$service].deploy_lambdas[]? // empty' "$CONFIG_PATH")

if [[ ${#LAMBDAS[@]} -eq 0 ]]; then
  echo "No deploy_lambdas configured for $SERVICE"
  exit 0
fi

echo "Building Lambda artifacts for $SERVICE: ${LAMBDAS[*]}"

LAMBDAS_ENV="${LAMBDAS[*]}" nix develop .# -c bash -lc '
  set -euo pipefail
  cd rust/cloud-storage
  for lambda in $LAMBDAS_ENV; do
    echo "::group::Build $lambda"
    ulimit -n 10240
    just "$lambda/build"
    test -f "target/lambda/$lambda/bootstrap.zip"
    if [[ "$lambda" == "call_recording_preview_handler" ]]; then
      test -f "target/lambda/$lambda/ffmpeg-layer.zip"
    fi
    echo "::endgroup::"
  done
'

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/target/lambda"
for lambda in "${LAMBDAS[@]}"; do
  mkdir -p "$OUTPUT_DIR/target/lambda/$lambda"
  cp -a "rust/cloud-storage/target/lambda/$lambda/." "$OUTPUT_DIR/target/lambda/$lambda/"
done

tar -C "$OUTPUT_DIR" -czf lambda-artifacts.tar.gz target
