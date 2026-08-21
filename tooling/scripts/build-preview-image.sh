#!/usr/bin/env bash
# Build the Fly preview VM image (or the scratch hot-update carrier) from a
# staged context directory using Nix dockerTools.
set -euo pipefail

ATTR="${1:?docker-image-preview or docker-image-preview-update}"
SRC="${2:?path to staged preview-ctx}"
TAG="${3:?docker tag to apply after load}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$(cd "$SRC" && pwd)"
cd "$ROOT"

out_link="$(mktemp -d)/result"
nix build --impure --print-build-logs --out-link "$out_link" --expr "
  let
    flake = builtins.getFlake \"${ROOT}\";
    pkgs = flake.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
    src = /. + \"${SRC}\";
  in (pkgs.callPackage (flake.outPath + \"/nix/_containers/preview.nix\") { inherit src; }).${ATTR}
"
docker load -i "$out_link"
docker tag "${ATTR#docker-image-}:latest" "$TAG" 2>/dev/null || true
# Prefer the name dockerTools assigned.
if docker image inspect macro-preview:latest >/dev/null 2>&1 && [[ "$ATTR" == docker-image-preview ]]; then
  docker tag macro-preview:latest "$TAG"
fi
if docker image inspect macro-preview-update:latest >/dev/null 2>&1 && [[ "$ATTR" == docker-image-preview-update ]]; then
  docker tag macro-preview-update:latest "$TAG"
fi
