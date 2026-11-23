set -euo pipefail

# The Windows runner has no Nix, so the bundled frontend is built here, from
# the same derivation the AppImage embeds, and handed over as an artifact with
# the release identity `desktop-release.mjs prepare` wrote.

# Vite inlines this at build time (see build_appimage.sh). Release builds must
# carry it; the pull request smoke build leaves it out, so the app it launches
# on the runner never reports to PostHog.
if [ "${REQUIRE_POSTHOG_API_KEY:-}" = true ]; then
  : "${VITE_POSTHOG_API_KEY:?must be set from the POSTHOG_API_KEY secret so desktop feature flags work}"
fi

# --impure only lets evaluation read VITE_POSTHOG_API_KEY; the build stays sandboxed.
nix build \
  --impure \
  --option sandbox true \
  --option download-attempts 10 \
  --print-build-logs \
  --out-link frontend-result \
  ".#tauri-frontend"

rm -rf windows-input
mkdir -p windows-input
cp -R --dereference frontend-result windows-input/dist
chmod -R u+w windows-input/dist
cp apps/web/tauri/desktop-release.json windows-input/desktop-release.json
jq -er '.version' apps/web/tauri/desktop-release.json > windows-input/version
nix develop --command bun apps/web/scripts/desktop-release.mjs tauri-config windows-input/tauri.release.json
