set -euo pipefail

# Appetize streams iOS *Simulator* builds only (a device .ipa cannot be run), so
# this produces an unsigned arm64 simulator .app rather than anything
# installable on hardware.

# Probe before the ~6 minutes of frontend build, so a runner missing its iOS
# bits fails in seconds instead of at the very last step.
#
# The SDK is the check that matters, and it is not implied by the others: since
# Xcode 16 platforms are downloaded separately, so `xcodebuild -version` and
# even `simctl` can look healthy on a runner with no iPhoneSimulator SDK. Tauri
# then dies reading SDKSettings.plist out of it.
xcodebuild -version
echo "Developer dir: $(xcode-select -p)"

SIMULATOR_SDK="$(xcrun --sdk iphonesimulator --show-sdk-path 2>/dev/null || true)"
if [ -z "$SIMULATOR_SDK" ] || [ ! -f "$SIMULATOR_SDK/SDKSettings.plist" ]; then
  echo "No iPhoneSimulator SDK on this runner." >&2
  echo "Install it with: xcodebuild -downloadPlatform iOS" >&2
  echo "--- installed SDKs ---" >&2
  xcodebuild -showsdks >&2 || true
  echo "--- platforms ---" >&2
  ls -1 "$(xcode-select -p)/Platforms" >&2 || true
  exit 1
fi
echo "iPhoneSimulator SDK: $SIMULATOR_SDK"

if ! xcrun simctl list runtimes --json | grep -q '"isAvailable" : true'; then
  echo "No available iOS simulator runtime on this runner." >&2
  echo "Install one with: xcodebuild -downloadPlatform iOS" >&2
  xcrun simctl list runtimes >&2
  exit 1
fi

# The simulator SDK is present and parseable, yet tauri still failed reading
# "Xcode SDKSettings.plist" — so it is looking somewhere else. Runners install
# Xcode at a versioned path (/Applications/Xcode_26.3.app) and tools that
# hardcode /Applications/Xcode.app break on exactly that. Provide both the
# symlink and DEVELOPER_DIR; neither is harmful if tauri wanted something else.
echo "--- Xcode installs ---"
ls -1d /Applications/Xcode*.app 2>/dev/null || true
echo "--- platforms ---"
ls -1 "$(xcode-select -p)/Platforms" 2>/dev/null || true

DEVELOPER_DIR="$(xcode-select -p)"
export DEVELOPER_DIR
if [ ! -e /Applications/Xcode.app ]; then
  echo "Linking /Applications/Xcode.app -> ${DEVELOPER_DIR%/Contents/Developer}"
  sudo ln -sfn "${DEVELOPER_DIR%/Contents/Developer}" /Applications/Xcode.app ||
    echo "Could not create the symlink; continuing." >&2
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
