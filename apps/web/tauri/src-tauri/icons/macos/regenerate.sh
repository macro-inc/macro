#!/bin/bash
set -euo pipefail

icon_dir="$(\cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output_dir="$(mktemp -d)"
trap 'rm -rf "$output_dir"' EXIT

# Keep the desktop composition identical to the mobile marketing artwork.
cp "$icon_dir/../../gen/apple/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png" \
  "$icon_dir/Macro.icon/Assets/mobile.png"
xcrun actool "$icon_dir/Macro.icon" \
  --compile "$output_dir" \
  --platform macosx \
  --minimum-deployment-target 10.13 \
  --app-icon Macro \
  --output-partial-info-plist "$output_dir/Info.plist" \
  --output-format human-readable-text

cp "$output_dir/Assets.car" "$output_dir/Macro.icns" "$output_dir/Info.plist" "$icon_dir/"
