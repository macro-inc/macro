set -euo pipefail

# The Windows runner has no Nix, so the bundled frontend is built here, from
# the same derivation the AppImage embeds, and handed over as an artifact with
# the release identity `desktop-release.mjs prepare` wrote.

# Vite inlines this at build time (see build_appimage.sh). Release builds must
# carry it; the pull request smoke build leaves it out, so the app it launches
# on the runner never reports to PostHog.
if [ "${REQUIRE_POSTHOG_API_KEY:-}" = true ]; then
  : "${VITE_POSTHOG_API_KEY:?must be set from the POSTHOG_API_KEY secret so desktop feature flags work}"
  if [ -n "${DEVTOOLS_PORT:-}" ]; then
    echo "A release build never opens the WebView2 DevTools port" >&2
    exit 1
  fi
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

# The pull request smoke build opens WebView2's DevTools port, so its launch
# check can read the page. Tauri passes these switches in place of its
# defaults, so they repeat wry's (`--disable-features=...` and, with autoplay
# on, `--autoplay-policy=...`). Tauri's --config replaces the windows array
# whole, so this copies the Windows window config and adds the switches.
if [ -n "${DEVTOOLS_PORT:-}" ]; then
  jq -e --arg args "--remote-debugging-port=$DEVTOOLS_PORT --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required" \
    '{ app: { windows: [.app.windows[] | .additionalBrowserArgs = $args] } }' \
    apps/web/tauri/src-tauri/tauri.windows.conf.json > windows-input/tauri.devtools.json
fi
