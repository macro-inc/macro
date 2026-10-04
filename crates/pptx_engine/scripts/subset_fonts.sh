#!/usr/bin/env bash
# Regenerates crates/pptx_engine/fonts from system font packages
# (fonts-crosextra-carlito, fonts-crosextra-caladea, fonts-liberation, fonts-dejavu-core).
# Requires fonttools: `pip install fonttools`.
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../fonts" && pwd)"
UNI="U+0000-024F,U+0250-02FF,U+0300-036F,U+0370-03FF,U+0400-04FF,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2460-24FF,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+2B00-2BFF,U+FB00-FB06,U+FFFD"
for f in /usr/share/fonts/truetype/crosextra/*.ttf \
  /usr/share/fonts/truetype/liberation/LiberationSans-*.ttf \
  /usr/share/fonts/truetype/liberation/LiberationSerif-*.ttf \
  /usr/share/fonts/truetype/liberation/LiberationMono-*.ttf \
  /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
  /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf; do
  pyftsubset "$f" --unicodes="$UNI" --layout-features='kern,liga,clig,locl,mark,mkmk,ccmp' \
    --no-hinting --desubroutinize --name-IDs='*' --name-languages='*' \
    --output-file="$OUT/$(basename "$f")"
done
