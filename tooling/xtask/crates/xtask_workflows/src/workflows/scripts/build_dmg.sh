set -euo pipefail

# Record the derivations before building so completed dependencies can be saved
# even if a later compilation or packaging step fails.
nix path-info --derivation --impure \
  ".#packages.aarch64-darwin.tauri-desktop-apple-linker-smoke" \
  ".#packages.aarch64-darwin.tauri-desktop-dmg" \
  > "$RUNNER_TEMP/desktop-cache-roots"

nix build --impure --option sandbox false --print-build-logs \
  ".#packages.aarch64-darwin.tauri-desktop-apple-linker-smoke"
nix build --impure --option sandbox false --print-build-logs \
  ".#packages.aarch64-darwin.tauri-desktop-dmg"
