set -euo pipefail

nix build --impure --option sandbox false --print-build-logs \
  ".#packages.aarch64-darwin.tauri-desktop-apple-linker-smoke"
nix build --impure --option sandbox false --print-build-logs \
  ".#packages.aarch64-darwin.tauri-desktop-dmg"
