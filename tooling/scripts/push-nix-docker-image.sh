#!/usr/bin/env bash
# Load a Nix dockerTools image and push it to ECR.
#
# Usage: push-nix-docker-image.sh <flake-attr> <registry/repo:tag>
#
# If NIX_DOCKER_IMAGE_TAR is set, load that archive instead of realizing the
# flake attr. MACRO_REPO_ROOT defaults to the git root of this script.
set -euo pipefail

ATTR="${1:?flake attr (e.g. docker-image-authentication-service)}"
DEST="${2:?destination image ref (registry/repo:tag)}"

ROOT="${MACRO_REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

load_out=""
if [[ -n "${NIX_DOCKER_IMAGE_TAR:-}" ]]; then
  if [[ ! -f "$NIX_DOCKER_IMAGE_TAR" ]]; then
    echo "error: NIX_DOCKER_IMAGE_TAR is not a file: $NIX_DOCKER_IMAGE_TAR" >&2
    exit 1
  fi
  load_out=$(docker load -i "$NIX_DOCKER_IMAGE_TAR")
else
  out_link="${TMPDIR:-/tmp}/macro-${ATTR}"
  nix build --print-build-logs ".#${ATTR}" --out-link "$out_link"
  load_out=$(docker load -i "$out_link")
fi

loaded=$(printf '%s\n' "$load_out" | awk '/Loaded image:/{print $3; exit}')
if [[ -z "$loaded" ]]; then
  loaded=$(printf '%s\n' "$load_out" | awk '/Loaded image ID:/{print $4; exit}')
fi
if [[ -z "$loaded" ]]; then
  echo "error: could not parse docker load output:" >&2
  printf '%s\n' "$load_out" >&2
  exit 1
fi

docker tag "$loaded" "$DEST"
# Keep stdout as the digest Pulumi reads; docker chatter goes to stderr.
docker push "$DEST" >&2
digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$DEST")
if [[ -z "$digest" ]]; then
  echo "error: no RepoDigests for $DEST after push" >&2
  exit 1
fi
printf '%s\n' "$digest"
