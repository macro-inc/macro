#!/bin/bash
set -euo pipefail

# Rebuilds the Linux and Windows desktop icons: the ALPHA badge from the macOS
# artwork, composited onto the bottom right of the Macro logo in app-icon.png.
icon_dir="$(\cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# Badge bounds (with its outline) in the 1024px macOS artwork, then scaled and
# placed against the logo in the 1254px app-icon.png.
magick "$icon_dir/macos/Macro.icon/Assets/mobile.png" \
  -crop 526x200+377+604 +repage -resize 539x205! \
  \( -size 539x205 xc:black -fill white -draw "roundrectangle 0,0 538,204 51,51" \) \
  -alpha off -compose CopyOpacity -composite "$work_dir/badge.png"
magick "$icon_dir/app-icon.png" "$work_dir/badge.png" \
  -geometry +483+750 -compose Over -composite "$work_dir/source.png"

resize() {
  magick "$work_dir/source.png" -filter Lanczos -resize "$1x$1" "$2"
}

for size in 32 64 128; do resize "$size" "$icon_dir/${size}x${size}.png"; done
resize 256 "$icon_dir/128x128@2x.png"
resize 512 "$icon_dir/icon.png"
for size in 30 44 71 89 107 142 150 284 310; do
  resize "$size" "$icon_dir/Square${size}x${size}Logo.png"
done
resize 50 "$icon_dir/StoreLogo.png"

for size in 16 32 128 256 512; do
  resize "$size" "$icon_dir/icon.iconset/icon_${size}x${size}.png"
  resize "$((size * 2))" "$icon_dir/icon.iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$icon_dir/icon.iconset" -o "$icon_dir/icon.icns"
magick "$work_dir/source.png" -define icon:auto-resize=256,64,48,32,24,16 \
  "$icon_dir/icon.ico"
