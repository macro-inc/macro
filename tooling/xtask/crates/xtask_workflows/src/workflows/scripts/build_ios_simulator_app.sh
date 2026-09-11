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

# cargo-mobile2 locates the SDK by shelling out to `xcode-select -p`, which
# returns $DEVELOPER_DIR whenever that is set — and nix's Darwin stdenv sets it
# to nix's own Apple SDK, which has no Platforms/iPhoneSimulator.platform. So
# the SDK is genuinely there for every command run out here, and genuinely
# absent for anything run inside `nix develop`, which is what made tauri report
# a bare NotFound for a file this script can see.
#
# Carry the real developer dir in under a name nix has no opinion about, and
# restore DEVELOPER_DIR once inside the shell.
MACRO_DEVELOPER_DIR="$(xcode-select -p)"
export MACRO_DEVELOPER_DIR

# cargo-tauri, bun, just, wasm-pack and the pinned toolchain (which carries
# aarch64-apple-ios-sim, see rust-toolchain.toml) all come from the dev shell.
# Phase 1 — the web and wasm build, in the dev shell exactly as it comes. It
# needs nix's bun, wasm-pack and cc wrapper, and must not see Apple's.
nix develop --command bash -euo pipefail -c '
  bun install --frozen-lockfile
  cd apps/web
  just build-tauri-dev
'

# Phase 2 — everything Xcode drives, with Apple's toolchain in front.
#
# The dev shell ships its own: DEVELOPER_DIR points at nix's apple-sdk and
# `xcodebuild` is the xcbuild reimplementation, which rejects real flags. But
# swapping only those two desyncs nix's cc wrapper from its SDK and host
# proc-macro links then fail on -liconv, so the compiler and linker have to
# come from Apple too. Hence one dir at the front of PATH rather than a couple
# of overrides — and hence phase 1 being a separate shell, since the wasm build
# wants the nix cc it was configured against.
nix develop --command bash -euo pipefail -c '
  echo "before: DEVELOPER_DIR=$(xcode-select -p 2>&1), xcodebuild=$(command -v xcodebuild || echo none)"

  export DEVELOPER_DIR="$MACRO_DEVELOPER_DIR"
  APPLE_TOOLS="$(mktemp -d)"
  for tool in xcodebuild xcrun xcode-select simctl actool ibtool plutil ditto \
              clang clang++ cc c++ ld ar ranlib libtool lipo strip nm \
              install_name_tool codesign dsymutil; do
    [ -x "/usr/bin/$tool" ] && ln -sf "/usr/bin/$tool" "$APPLE_TOOLS/$tool"
  done
  export PATH="$APPLE_TOOLS:$PATH"

  # nix'"'"'s wrapper flags name its own sysroot; Apple'"'"'s clang would either
  # ignore them or trip over them.
  unset NIX_CFLAGS_COMPILE NIX_LDFLAGS SDKROOT || true

  echo "after:  DEVELOPER_DIR=$(xcode-select -p 2>&1), xcodebuild=$(command -v xcodebuild), cc=$(command -v cc)"
  xcodebuild -version

  cd apps/web
  # Positional: `prebuilt=true` would be passed as the literal argument
  # "prebuilt=true", silently rebuilding the frontend a second time here.
  just ios-build-sim true
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

# Everything above can pass on an app that launches to a black screen: the
# frontend is embedded in the binary by generate_context!(), so there is no
# file whose absence gives it away, and build/link/zip/upload all succeed
# regardless. The only honest check is to run it.
#
# Boot the same simulator Appetize would, launch the app, and photograph it.
# The screenshot is uploaded either way — it is the single most useful artifact
# when a preview misbehaves.
mkdir -p artifacts
DEVICE="$(xcrun simctl create ios-preview-smoke com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro)"
trap 'xcrun simctl delete "$DEVICE" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$DEVICE"
xcrun simctl bootstatus "$DEVICE" -b

xcrun simctl install "$DEVICE" "$APP"
xcrun simctl launch "$DEVICE" com.macro.app.prod

# The webview needs a moment to load and paint before the shot is worth taking.
sleep 25
xcrun simctl io "$DEVICE" screenshot artifacts/launch.png

# The app's own log, filtered by process name as AGENTS.md prescribes for
# diagnosing iOS freezes. Kept whether or not the shot looks right — it is what
# says *why* a screen was blank.
xcrun simctl spawn "$DEVICE" log show --predicate 'process == "macro"' \
  --last 3m --style compact >artifacts/launch.log 2>&1 || true
echo "--- last 40 app log lines ---"
tail -40 artifacts/launch.log || true

if [ ! -f artifacts/launch.png ]; then
  echo "simctl produced no screenshot." >&2
  exit 1
fi

# A blank screen compresses to almost nothing, while any real UI carries
# detail. This is a coarse signal deliberately: it cannot say the app is
# correct, only that it painted something other than a void.
SHOT_BYTES="$(stat -f%z artifacts/launch.png)"
echo "Launch screenshot: ${SHOT_BYTES} bytes"
if [ "$SHOT_BYTES" -lt 40000 ]; then
  echo "The app launched to a blank screen (${SHOT_BYTES}-byte screenshot)." >&2
  echo "See the launch.png artifact; the log archive is beside it." >&2
  exit 1
fi

# `ditto`, not `zip`: the Apple-supported way to archive a bundle, preserving
# the symlinks and exec bits that Appetize (and anyone re-running this locally)
# needs. The same archive is both the CI artifact and the upload payload.
ditto -c -k --sequesterRsrc --keepParent "$APP" artifacts/macro-sim.zip
