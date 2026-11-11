#!/usr/bin/env bash
# Regenerates the test vectors under crates/whatsmeow/testdata from
# whatsmeow's own code at the pinned revision. Test tooling only; not run in CI.
#
# Usage: generate.sh [path to a whatsmeow checkout]
# Without a path, it clones whatsmeow into a temporary directory.
set -euo pipefail

REVISION=b2b1e71d45e2ff171153b025b5a42f475bb30ef8
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(cd "$HERE/../.." && pwd)"
CHECKOUT="${1:-}"

if [[ -z "$CHECKOUT" ]]; then
  CHECKOUT="$(mktemp -d)/whatsmeow"
  git clone --quiet https://github.com/tulir/whatsmeow "$CHECKOUT"
fi
git -C "$CHECKOUT" checkout --quiet "$REVISION"

cleanup() {
  for file in "$HERE"/*_test.go; do
    rm -f "$CHECKOUT/zz_rustport_$(basename "$file")"
  done
}
trap cleanup EXIT

for file in "$HERE"/*_test.go; do
  cp "$file" "$CHECKOUT/zz_rustport_$(basename "$file")"
done
(cd "$CHECKOUT" && VECTORS_OUT="$OUT" go test -count=1 -tags rustport -run 'TestGenerate' .)
