#!/usr/bin/env bash
# Load one or more `stream-docker-image-*` flake outputs into the local Docker
# daemon. Each attr is realized with `nix build` and piped to `docker load`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
mkdir -p target/nix

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <flake-attr> [flake-attr...]" >&2
  echo "       $0 --infra-farm" >&2
  exit 2
fi

load_stream() {
  local attr="$1"
  local link="target/nix/${attr}"
  nix build --print-build-logs ".#${attr}" --out-link "$link"
  sh -c 'exec "$1" | docker load' nix-stream "$link"
}

if [ "$1" = "--infra-farm" ]; then
  nix build --print-build-logs .#local-infra-image-streams --out-link target/nix/local-infra-image-streams
  for stream in target/nix/local-infra-image-streams/*; do
    [ -e "$stream" ] || continue
    sh -c 'exec "$1" | docker load' nix-stream "$stream"
  done
  exit 0
fi

for attr in "$@"; do
  load_stream "$attr"
done
