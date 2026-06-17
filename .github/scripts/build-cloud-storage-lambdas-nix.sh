#!/usr/bin/env bash
set -euo pipefail

# Build all of a service's Lambda handlers via the crane + cargo-zigbuild nix
# packages (.#deploy-lambda-<name>), and assemble the target/lambda/<name>/ zip
# artifact layout the deploy action consumes -- identical to what the old
# cargo-lambda script produced, so nothing downstream changes.
#
# Unlike the cargo-lambda path, this never recompiles unchanged handlers: nix is
# content-addressed, so an unchanged handler is a pure cache hit (substituted
# from the warm /nix lambda disk or Cachix). Independent handler derivations
# also build in parallel within the single `nix build` invocation.

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

echo "Building Lambda artifacts for $SERVICE via nix: ${LAMBDAS[*]}"

cachix_pid=
if command -v cachix >/dev/null 2>&1 && [[ -n "${CACHIX_CACHE_NAME:-}" ]]; then
  cachix watch-store "$CACHIX_CACHE_NAME" >/tmp/cachix-watch-store.log 2>&1 &
  cachix_pid=$!
  trap 'if [[ -n "${cachix_pid:-}" ]]; then kill "$cachix_pid" 2>/dev/null || true; wait "$cachix_pid" 2>/dev/null || true; fi' EXIT
fi

# Build every handler for this service in one nix invocation: independent
# derivations build in parallel, unchanged ones are pure cache hits, and the
# out paths are captured here (stdout) while build logs stream to stderr —
# no per-handler re-invocation of nix.
installables=()
for lambda in "${LAMBDAS[@]}"; do
  installables+=(".#deploy-lambda-${lambda}")
done
mapfile -t outs < <(nix build --no-link --print-build-logs --print-out-paths "${installables[@]}")

# Assemble target/lambda/<name>/*.zip. Each out path is laid out as
# <out>/<handler>/{bootstrap.zip,...} (see deployLambdaPackage in flake.nix),
# so the copy needs no name mapping.
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/target/lambda"
for out in "${outs[@]}"; do
  # Copy the handler dir(s) inside each out path. NOT `cp -a "$out"/.` — that
  # form also applies the store dir's read-only mode onto target/lambda
  # itself, breaking the next iteration's copy in multi-handler services.
  cp -a "$out"/* "$OUTPUT_DIR/target/lambda/"
done
# Store copies are read-only; make the tree writable so a re-run's rm -rf works.
chmod -R u+w "$OUTPUT_DIR"

for lambda in "${LAMBDAS[@]}"; do
  test -f "$OUTPUT_DIR/target/lambda/$lambda/bootstrap.zip"
  if [[ "$lambda" == "call_recording_preview_handler" ]]; then
    test -f "$OUTPUT_DIR/target/lambda/$lambda/ffmpeg-layer.zip"
  fi
  # document_text_extractor dlopen's ./pdfium-lib/linux/libpdfium.so at runtime,
  # so the blob has to be bundled inside bootstrap.zip (see deployLambdaPackage
  # in flake.nix) -- guard against shipping the binary without it.
  if [[ "$lambda" == "document_text_extractor" ]]; then
    unzip -l "$OUTPUT_DIR/target/lambda/$lambda/bootstrap.zip" | grep -q 'pdfium-lib/linux/libpdfium.so' \
      || { echo "document_text_extractor bootstrap.zip is missing pdfium-lib/linux/libpdfium.so" >&2; exit 1; }
  fi
done

tar -C "$OUTPUT_DIR" -czf lambda-artifacts.tar.gz target
