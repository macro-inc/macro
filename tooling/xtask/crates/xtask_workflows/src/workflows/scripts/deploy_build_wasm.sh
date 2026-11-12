set -euo pipefail
# Build the wasm packages, reusing unchanged ones from WASM_PKG_CACHE_DIR, then
# keep only the packages this build used and name the set for the cache save.
# A package reused or stored here is newer than `started`
# (apps/web/scripts/cached-wasm-build.sh touches it), so older entries belong
# to builds of other inputs and would only grow the saved cache.
# Entries come back from the Actions cache with the mtimes of the run that saved
# them. Mark them current first, so cached-wasm-build.sh's pruning of week-old
# entries cannot remove one before this build has looked it up.
find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -exec touch {} + 2>/dev/null || true
started="$(mktemp)"
just build-wasm
find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 \( -name '.tmp-*' -o ! -newer "$started" \) \
  -exec rm -rf {} +
rm -f "$started"
# Entry names hold each package's input key, so the same set gets the same name
# and an unchanged set is not saved again.
packages="$(find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
printf '%s\n' "$packages"
echo "key=deploy-wasm-pkgs-v1-$(printf '%s\n' "$packages" | sha256sum | cut -c1-32)" >> "$GITHUB_OUTPUT"
