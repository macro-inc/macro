#!/usr/bin/env bash
# Rebuild the committed @ironcalc/wasm package in pkg/ from the vendored
# sources. Requires the repository's Rust toolchain (rust-toolchain.toml,
# with the wasm32-unknown-unknown target), wasm-bindgen-cli matching the
# wasm-bindgen crate in Cargo.lock, wasm-opt (binaryen) and bun.
#
#   ./build.sh          rebuild pkg/
#   ./build.sh --check  rebuild into a temporary directory and fail if pkg/ differs
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

check=false
[ "${1:-}" = "--check" ] && check=true
out="$here/pkg"
work="$(mktemp -d)"
$check && out="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
  if $check; then rm -rf "$out"; fi
}
trap cleanup EXIT

expected="$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' Cargo.lock)"
actual="$(wasm-bindgen --version | awk '{ print $2 }')"
if [ "$expected" != "$actual" ]; then
  echo "wasm-bindgen $actual found; Cargo.lock needs $expected:" >&2
  echo "  cargo install wasm-bindgen-cli --version $expected --locked" >&2
  exit 1
fi
command -v wasm-opt >/dev/null || {
  echo "wasm-opt (binaryen) is required." >&2
  exit 1
}

cargo build --lib --release --target wasm32-unknown-unknown -p wasm
wasm-bindgen target/wasm32-unknown-unknown/release/wasm.wasm \
  --out-dir "$work" --out-name wasm --target web
wasm-opt -O "$work/wasm_bg.wasm" -o "$work/wasm_bg.wasm"
rm -f "$work/.gitignore"

rm -rf "$out"
mkdir -p "$out"
cp -r "$work"/. "$out"/
cp bindings/wasm/README.pkg.md "$out/README.md"
cp LICENSE-MIT LICENSE-Apache-2.0 "$out/"
bun "$here/scripts/package.ts" "$out"

if $check; then
  diff -r "$out" "$here/pkg"
  echo "pkg/ matches the vendored sources."
fi
