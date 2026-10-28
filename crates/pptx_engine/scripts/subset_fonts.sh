#!/usr/bin/env bash
# Regenerates crates/pptx_engine/fonts from system font packages
# (fonts-crosextra-carlito, fonts-crosextra-caladea, fonts-liberation, fonts-dejavu-core)
# and the Noto Arabic and Hebrew fonts (downloaded from notofonts.github.io).
# Requires fonttools (`pip install fonttools`) and curl.
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

# Arabic and Hebrew: their own letters (with the Arabic presentation forms and
# the layout features shaping uses); other text falls back to the faces above.
NOTO="https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for f in NotoNaskhArabic NotoSansArabic; do
  for w in Regular Bold; do
    curl -sSfL -o "$TMP/$f-$w.ttf" "$NOTO/$f/hinted/ttf/$f-$w.ttf"
    pyftsubset "$TMP/$f-$w.ttf" \
      --unicodes='U+0020-007E,U+00A0,U+00AB,U+00BB,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F,U+2010-2027,U+25CC' \
      --layout-features='ccmp,locl,isol,init,medi,fina,rlig,liga,calt,rtlm,kern,mark,mkmk,curs' \
      --no-hinting --desubroutinize --name-IDs='*' --output-file="$OUT/$f-$w.ttf"
  done
done
for f in NotoSansHebrew NotoSerifHebrew; do
  for w in Regular Bold; do
    curl -sSfL -o "$TMP/$f-$w.ttf" "$NOTO/$f/hinted/ttf/$f-$w.ttf"
    pyftsubset "$TMP/$f-$w.ttf" \
      --unicodes='U+0020-007E,U+00A0,U+0590-05FF,U+FB1D-FB4F,U+200C-200F,U+20AA,U+25CC' \
      --layout-features='ccmp,locl,calt,rtlm,kern,mark,mkmk' \
      --no-hinting --desubroutinize --name-IDs='*' --output-file="$OUT/$f-$w.ttf"
  done
done
