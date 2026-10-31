#!/bin/bash
set -euo pipefail

icon_dir="$(\cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
output_dir="$(mktemp -d)"
trap 'rm -rf "$output_dir"' EXIT

xcrun actool "$icon_dir/Macro.icon" \
  --compile "$output_dir" \
  --platform macosx \
  --minimum-deployment-target 10.13 \
  --app-icon Macro \
  --output-partial-info-plist "$output_dir/Info.plist" \
  --output-format human-readable-text

# Info.plist holds hand-written keys (usage descriptions, activity types), so
# it is not regenerated; keep its CFBundleIcon* keys in step with --app-icon.
cp "$output_dir/Assets.car" "$output_dir/Macro.icns" "$icon_dir/"
