#!/bin/bash
set -euo pipefail

# Rebuilds the desktop icons from the canonical Rox artwork in app-icon.png.
icon_dir="$(\cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

resize() {
  magick "$icon_dir/app-icon.png" -filter Lanczos -resize "$1x$1" "$2"
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
magick "$icon_dir/app-icon.png" -define icon:auto-resize=256,64,48,32,24,16 \
  "$icon_dir/icon.ico"
