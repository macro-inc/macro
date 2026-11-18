set -euo pipefail
# Build the wasm packages, reusing unchanged ones from WASM_PKG_CACHE_DIR, then
# keep only the packages this build used and name the set for the cache save.
#
# A failed restore can leave a partial extraction behind, and
# cached-wasm-build.sh reuses any entry directory that exists, so without a
# restored entry start from nothing.
if [ -z "${RESTORED_KEY:-}" ]; then
  rm -rf "$WASM_PKG_CACHE_DIR"
fi
# Restored entries carry the mtimes of the run that saved them. Mark them
# current first, so cached-wasm-build.sh's pruning of week-old entries cannot
# remove one before this build has looked it up.
find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -exec touch {} + 2>/dev/null || true
# cached-wasm-build.sh touches every entry it reuses or stores, so entries not
# newer than `started` belong to builds of other inputs and would only grow the
# saved cache.
started="$(mktemp)"
just build-wasm
find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 \( -name '.tmp-*' -o ! -newer "$started" \) \
  -exec rm -rf {} +
rm -f "$started"
# Entry names hold each package's input key, so the same packages make the same
# set name. The run id keeps the save key new, since a set can come back after
# another replaced it as the newest entry.
packages="$(find "$WASM_PKG_CACHE_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
printf '%s\n' "$packages"
set_prefix="$KEY_PREFIX$(printf '%s\n' "$packages" | sha256sum | cut -c1-32)-"
case "${RESTORED_KEY:-}" in
  "$set_prefix"*) echo "The restored entry holds these packages; nothing to save." ;;
  *) echo "key=$set_prefix$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" >> "$GITHUB_OUTPUT" ;;
esac
