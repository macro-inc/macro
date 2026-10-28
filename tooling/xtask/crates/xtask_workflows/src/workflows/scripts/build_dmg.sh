set -euo pipefail

# Vite inlines this into the bundle at build time; without it the shipped
# desktop app never initializes PostHog and every feature flag reads as off.
# Everything below is already `--impure`, which is what lets Nix evaluation
# see it — including the path-info pass, so the recorded cache roots match
# what the builds produce.
: "${VITE_POSTHOG_API_KEY:?must be set from the POSTHOG_API_KEY secret so desktop feature flags work}"

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
