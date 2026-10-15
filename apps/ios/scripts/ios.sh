#!/bin/bash
set -euo pipefail

IOS_ROOT="$(\cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$IOS_ROOT/MacroNative.xcodeproj"
BUILD_DIR="$IOS_ROOT/.build"
BUNDLE_ID="com.macro.app.native"
ACTION="${1:-build}"
DEVICE="${2:-}"

usage() {
  cat <<'EOF'
Usage: apps/ios/scripts/ios.sh <build|test|run|install|devices> [device-id]

build     Build for an available iPhone simulator.
test      Run the unit and UI tests on an iPhone simulator.
run       Build, install, and open on an iPhone simulator.
install   Build, install, and open on a connected physical iPhone; device-id required.
devices   List physical devices and available iPhone simulators.

Simulator commands choose a booted iPhone, or the first available iPhone.
Simulator output is kept in apps/ios/.build; device output in apps/ios/.build-device.
EOF
}

case "$ACTION" in
  devices)
    xcrun devicectl list devices
    xcrun simctl list devices available
    exit 0
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  build|test|run|install) ;;
  *) usage >&2; exit 2 ;;
esac

if [[ "$ACTION" == "install" ]]; then
  BUILD_DIR="$IOS_ROOT/.build-device"
  if [[ -z "$DEVICE" ]]; then
    echo 'Provide a connected iPhone identifier from: apps/ios/scripts/ios.sh devices' >&2
    exit 2
  fi
  xcodebuild -project "$PROJECT" -scheme MacroNative -configuration Debug \
    -destination "id=$DEVICE" -derivedDataPath "$BUILD_DIR" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
  xcrun devicectl device install app --device "$DEVICE" \
    "$BUILD_DIR/Build/Products/Debug-iphoneos/MacroNative.app"
  xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"
  exit 0
fi

if [[ -z "$DEVICE" ]]; then
  DEVICE="$(xcrun simctl list devices available --json | python3 -c '
import json, sys
devices = [device for runtime in json.load(sys.stdin)["devices"].values()
           for device in runtime if device.get("isAvailable") and "iPhone" in device["name"]]
devices.sort(key=lambda device: device["state"] != "Booted")
if not devices:
    sys.exit("No iPhone simulator is installed. Add one in Xcode Settings > Platforms.")
print(devices[0]["udid"])
')"
fi

BUILD_ACTION="build"
if [[ "$ACTION" == "test" ]]; then BUILD_ACTION="test"; fi
xcodebuild -project "$PROJECT" -scheme MacroNative -configuration Debug \
  -destination "platform=iOS Simulator,id=$DEVICE" -derivedDataPath "$BUILD_DIR" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- "$BUILD_ACTION"

if [[ "$ACTION" == "run" ]]; then
  STATE="$(xcrun simctl list devices --json | python3 -c '
import json, sys
print(next(device["state"] for runtime in json.load(sys.stdin)["devices"].values()
           for device in runtime if device["udid"] == sys.argv[1]))
' "$DEVICE")"
  if [[ "$STATE" != "Booted" ]]; then xcrun simctl boot "$DEVICE"; fi
  open -a Simulator
  xcrun simctl bootstatus "$DEVICE" -b
  xcrun simctl install "$DEVICE" "$BUILD_DIR/Build/Products/Debug-iphonesimulator/MacroNative.app"
  xcrun simctl launch "$DEVICE" "$BUNDLE_ID"
fi
