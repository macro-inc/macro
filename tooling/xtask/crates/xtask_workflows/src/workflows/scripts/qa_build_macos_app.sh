set -euo pipefail

# The unsigned Chromium (CEF) app the DMG is made from: everything the QA
# needs, without the signing identity, notarization or PostHog secrets the
# release build requires. Built without --impure, so no telemetry key is
# embedded and nothing the app does here reaches PostHog.
nix build --option sandbox false --print-build-logs \
  --out-link "$RUNNER_TEMP/qa-app-result" \
  ".#tauri-desktop-cef-app"

# Nix outputs are read-only and live in /nix/store; run a writable copy.
app_dir="$RUNNER_TEMP/macro-qa"
rm -rf "$app_dir"
mkdir -p "$app_dir"
cp -a "$RUNNER_TEMP/qa-app-result/Macro.app" "$app_dir/Macro.app"
chmod -R u+w "$app_dir/Macro.app"

# The copy moved the bundle, so seal it again. Ad-hoc is enough to launch a
# locally built app; the release signing identity is not needed for QA.
codesign --force --deep --sign - "$app_dir/Macro.app" ||
  echo "::warning::ad-hoc codesign failed; the bundle-codesign check will say why"

echo "QA_APP=$app_dir/Macro.app" >> "$GITHUB_ENV"
du -sh "$app_dir/Macro.app"
