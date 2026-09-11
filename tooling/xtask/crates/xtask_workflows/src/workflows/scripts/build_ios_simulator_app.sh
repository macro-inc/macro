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
  just ios-build-sim prebuilt=true
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

# A bundle with no web assets builds, links, uploads and launches — to a black
# screen. Nothing upstream fails, so the first report comes from whoever opened
# the preview. Prove the frontend is actually in there.
if [ ! -f "$APP/index.html" ] || [ -z "$(ls -A "$APP/assets" 2>/dev/null)" ]; then
  echo "The app bundle carries no frontend: index.html or assets/ is missing." >&2
  echo "frontendDist is most likely absent from the tauri --config override." >&2
  ls -la "$APP" >&2 || true
  exit 1
fi

# `ditto`, not `zip`: the Apple-supported way to archive a bundle, preserving
# the symlinks and exec bits that Appetize (and anyone re-running this locally)
# needs. The same archive is both the CI artifact and the upload payload.
mkdir -p artifacts
ditto -c -k --sequesterRsrc --keepParent "$APP" artifacts/macro-sim.zip
