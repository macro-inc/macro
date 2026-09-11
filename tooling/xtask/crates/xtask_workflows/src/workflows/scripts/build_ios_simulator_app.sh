set -euo pipefail

# Appetize streams iOS *Simulator* builds only (a device .ipa cannot be run), so
# this produces an unsigned arm64 simulator .app rather than anything
# installable on hardware.

# Probe the two things most likely to be missing on a fresh macOS runner. Both
# fail deep inside xcodebuild otherwise, tens of minutes in.
xcodebuild -version
if ! xcrun simctl list runtimes --json | grep -q '"isAvailable" : true'; then
  echo "No available iOS simulator runtime on this runner." >&2
  echo "Install one with: xcodebuild -downloadPlatform iOS" >&2
  xcrun simctl list runtimes
  exit 1
fi

# cargo-tauri, bun, just, wasm-pack and the pinned toolchain (which carries
# aarch64-apple-ios-sim, see rust-toolchain.toml) all come from the dev shell.
nix develop --command bash -euo pipefail -c '
  bun install --frozen-lockfile
  cd apps/web
  just ios-build-sim
'

APP="apps/web/tauri/src-tauri/gen/apple/build/arm64-sim/macro.app"
if [ ! -d "$APP" ]; then
  echo "Expected a simulator .app at $APP" >&2
  find apps/web/tauri/src-tauri/gen/apple/build -maxdepth 3 -name '*.app' >&2 || true
  exit 1
fi

# An iPhoneOS build would upload fine and then refuse to boot, so prove the SDK
# before handing it to Appetize.
if ! plutil -extract DTPlatformName raw "$APP/Info.plist" | grep -q iphonesimulator; then
  echo "Built against the device SDK, not the simulator SDK:" >&2
  plutil -extract DTPlatformName raw "$APP/Info.plist" >&2
  exit 1
fi

# `ditto`, not `zip`: the Apple-supported way to archive a bundle, preserving
# the symlinks and exec bits that Appetize (and anyone re-running this locally)
# needs. The same archive is both the CI artifact and the upload payload.
mkdir -p artifacts
ditto -c -k --sequesterRsrc --keepParent "$APP" artifacts/macro-sim.zip
