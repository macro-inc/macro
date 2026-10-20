#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export GOTOOLCHAIN=go1.27.2
pin=v0.0.0-20261017175727-b2b1e71d45e2
patch_sha=$(cat patches/*.patch patches/*.go.txt | shasum -a 256 | cut -d ' ' -f1)
cache="$PWD/.patched/$patch_sha"
if [ ! -f "$cache/go.work" ]; then
    go mod download "go.mau.fi/whatsmeow@$pin"
    mkdir -p "$cache/whatsmeow"
    cp -R "$(go env GOMODCACHE)/go.mau.fi/whatsmeow@$pin/." "$cache/whatsmeow/"
    chmod -R u+w "$cache/whatsmeow"
    cp patches/noise_writer_test.go.txt "$cache/whatsmeow/socket/macro_writer_test.go"
    cp patches/inbound_ack_test.go.txt "$cache/whatsmeow/macro_inbound_test.go"
    for source_patch in "$PWD"/patches/*.patch; do (cd "$cache/whatsmeow" && patch -p1 < "$source_patch"); done
    (cd "$cache" && GOWORK=off go work init "$OLDPWD" && GOWORK="$cache/go.work" go work edit -replace="go.mau.fi/whatsmeow=$cache/whatsmeow")
fi
export GOWORK="$cache/go.work"
exec go "$@"
