#!/usr/bin/env bash
# ios-release.sh — build, sign, and upload the iOS app to App Store Connect /
# TestFlight with no Xcode UI.
#
# Replaces the manual flow (just ios-build → Xcode: Archive → Validate →
# Distribute App → App Store Connect encryption questionnaire):
#   1. Bumps bundle.iOS.bundleVersion in tauri.ios.conf.json   (--no-bump)
#   2. just ios-prepare (sync plist metadata, prepare SwiftPM deps)
#   3. just build-tauri — the frontend + wasm build, on the original (Nix)
#      toolchain, exactly as ios-build.sh does it
#   4. cargo tauri ios build --export-method app-store-connect, with Apple's
#      toolchain activated (ios-native-env.sh) and the prebuilt dist
#      (xcodebuild archive + distribution-signed IPA export; the API key env
#      vars below are forwarded by tauri as xcodebuild -authenticationKey…)
#   5. xcrun altool --validate-app / --upload-app                (--skip-validate)
#   6. Polls the App Store Connect API until the build finishes processing
#      and confirms export compliance is set                     (--no-wait)
#
# The encryption questionnaire is answered at build time by
# ITSAppUsesNonExemptEncryption=false in src-tauri/Info.ios.plist (exempt
# encryption only); step 6 fails if App Store Connect reports the question as
# still unanswered.
#
# Credentials: the App Store Connect team API key (App Manager role) lives in
# Doppler as ios-release/prd APPLE_API_KEY_ID / APPLE_API_ISSUER /
# APPLE_API_PRIVATE_KEY, which this script accepts directly:
#   doppler run --project ios-release --config prd -- just ios-release
# (the key is written to ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8, where
# altool insists on finding it). Or set APPLE_API_KEY=<key id>
# APPLE_API_ISSUER=<issuer id> with the .p8 in that directory or at
# APPLE_API_KEY_PATH.
#
# CI runs this via the `iOS App Store Release` workflow (add the `ios-update`
# label to a PR; see docs/ios-releases.md and
# tooling/xtask/crates/xtask_workflows/src/workflows/ios_app_store_release.rs),
# which handles the runner setup and passes --no-bump — the PR carries the
# version bump (`just ios-bump`).
#
# Usage: scripts/ios-release.sh [--no-bump] [--skip-validate] [--no-wait]

set -euo pipefail

APP_DIR="$(\cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
\cd "$APP_DIR"
source scripts/ios-native-env.sh

IOS_CONF="tauri/src-tauri/tauri.ios.conf.json"
TAURI_CONF="tauri/src-tauri/tauri.conf.json"
IPA_DIR="tauri/src-tauri/gen/apple/build/arm64"

BUMP=1
VALIDATE=1
WAIT=1
for arg in "$@"; do
  case "$arg" in
    --no-bump) BUMP=0 ;;
    --skip-validate) VALIDATE=0 ;;
    --no-wait) WAIT=0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

step "Pre-flight"
command -v bun >/dev/null || fail "bun not installed."
command -v just >/dev/null || fail "just not installed."
command -v cargo-tauri >/dev/null || cargo tauri --version >/dev/null 2>&1 \
  || fail "tauri CLI not installed (cargo install tauri-cli)."
ios_resolve_toolchain aarch64-apple-ios
# Accept Doppler's names (ios-release/prd) as fallbacks for tauri's.
export APPLE_API_KEY="${APPLE_API_KEY:-${APPLE_API_KEY_ID:-}}"
[[ -n "${APPLE_API_KEY:-}" ]] || fail "APPLE_API_KEY not set (App Store Connect API Key ID — see header)."
[[ -n "${APPLE_API_ISSUER:-}" ]] || fail "APPLE_API_ISSUER not set (App Store Connect Issuer ID — see header)."

# altool only searches ./private_keys, ~/private_keys, ~/.private_keys and
# ~/.appstoreconnect/private_keys for AuthKey_<ID>.p8, so make sure the key is
# in the canonical spot; tauri/xcodebuild take an explicit path instead.
CANONICAL_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8"
if [[ ! -f "$CANONICAL_KEY_PATH" && -z "${APPLE_API_KEY_PATH:-}" && -n "${APPLE_API_PRIVATE_KEY:-${APPLE_API_KEY_P8:-}}" ]]; then
  mkdir -p "$(dirname "$CANONICAL_KEY_PATH")"
  (umask 077 && printf '%s\n' "${APPLE_API_PRIVATE_KEY:-${APPLE_API_KEY_P8:-}}" > "$CANONICAL_KEY_PATH")
  echo "Wrote API key from the environment to $CANONICAL_KEY_PATH."
fi
if [[ -z "${APPLE_API_KEY_PATH:-}" ]]; then
  [[ -f "$CANONICAL_KEY_PATH" ]] \
    || fail "API key not found at $CANONICAL_KEY_PATH. Put AuthKey_${APPLE_API_KEY}.p8 there or set APPLE_API_KEY_PATH."
  export APPLE_API_KEY_PATH="$CANONICAL_KEY_PATH"
elif [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  fail "APPLE_API_KEY_PATH points to a missing file: $APPLE_API_KEY_PATH"
fi
if [[ ! -f "$CANONICAL_KEY_PATH" ]]; then
  mkdir -p "$(dirname "$CANONICAL_KEY_PATH")"
  cp "$APPLE_API_KEY_PATH" "$CANONICAL_KEY_PATH"
  chmod 600 "$CANONICAL_KEY_PATH"
  echo "Copied API key to $CANONICAL_KEY_PATH (required by altool)."
fi

BUNDLE_ID="$(bun -e "console.log(JSON.parse(require('node:fs').readFileSync('$TAURI_CONF', 'utf8')).identifier)")"

if [[ "$BUMP" == 1 ]]; then
  step "Bumping build number"
  bun scripts/ios-bump-version.mjs --build-only
fi
BUILD_NUMBER="$(bun -e "console.log(JSON.parse(require('node:fs').readFileSync('$IOS_CONF', 'utf8')).bundle.iOS.bundleVersion)")"
MARKETING_VERSION="$(bun -e "console.log(JSON.parse(require('node:fs').readFileSync('$IOS_CONF', 'utf8')).version)")"
echo "Releasing $BUNDLE_ID $MARKETING_VERSION ($BUILD_NUMBER)"

step "Preparing iOS project"
just ios-prepare

# The imported .p12 alone does not disable Xcode cloud signing. Download a
# matching App Store profile for every target and explicitly select manual
# export. Restore tracked project settings even if preparation/build fails.
signing_backup=""
restore_signing() {
  if [[ -n "$signing_backup" ]]; then
    cp "$signing_backup/project.pbxproj" tauri/src-tauri/gen/apple/app.xcodeproj/project.pbxproj
    cp "$signing_backup/ExportOptions.plist" tauri/src-tauri/gen/apple/ExportOptions.plist
    rm -rf "$signing_backup"
    signing_backup=""
  fi
}
if [[ -n "${APPLE_DISTRIBUTION_CERTIFICATE_PATH:-}" ]]; then
  signing_backup="$(mktemp -d)"
  cp tauri/src-tauri/gen/apple/app.xcodeproj/project.pbxproj "$signing_backup/project.pbxproj"
  cp tauri/src-tauri/gen/apple/ExportOptions.plist "$signing_backup/ExportOptions.plist"
  trap restore_signing EXIT
  bun scripts/ios-app-store.mjs prepare-signing
fi

# Same split as ios-build.sh: the web/wasm build keeps its original toolchain,
# Apple's tools take over only for the native build, and Tauri's build hook is
# skipped because it has already run here.
step "Building the frontend bundle"
ios_require_posthog_key
just build-tauri

step "Archiving and exporting IPA (this takes a while)"
ios_activate_toolchain
(\cd tauri/src-tauri && "$ios_cargo" tauri ios build --export-method app-store-connect --ci \
  --config '{"build":{"beforeBuildCommand":"","frontendDist":"../../dist"}}')
restore_signing

IPA="$(ls -t "$IPA_DIR"/*.ipa 2>/dev/null | head -1 || true)"
[[ -n "$IPA" ]] || fail "No IPA found in $IPA_DIR after build."
echo "IPA: $IPA"

if [[ "$VALIDATE" == 1 ]]; then
  step "Validating with App Store Connect"
  xcrun altool --validate-app --type ios -f "$IPA" \
    --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"
fi

step "Uploading to App Store Connect"
xcrun altool --upload-app --type ios -f "$IPA" \
  --apiKey "$APPLE_API_KEY" --apiIssuer "$APPLE_API_ISSUER"

if [[ "$WAIT" == 1 ]]; then
  step "Waiting for App Store Connect to process build $BUILD_NUMBER"
  bun scripts/ios-app-store.mjs wait-build \
    --bundle-id "$BUNDLE_ID" \
    --version "$MARKETING_VERSION" \
    --build "$BUILD_NUMBER"
fi

printf "\n\033[1;32m✓ %s %s (%s) uploaded to App Store Connect.\033[0m\n" \
  "$BUNDLE_ID" "$MARKETING_VERSION" "$BUILD_NUMBER"
if [[ "$BUMP" == 1 ]]; then
  echo "Don't forget to commit the version bump ($IOS_CONF and synced plists)."
fi
