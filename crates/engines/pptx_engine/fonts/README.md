# Bundled fonts

Metric-compatible, freely licensed stand-ins for the fonts most presentations use.
Each file is a subset (Latin, Greek, Cyrillic, punctuation, currency, arrows, math,
box drawing, geometric shapes, dingbats; the Noto faces only Arabic or Hebrew) with
hinting removed; kerning and the basic layout features are kept (for Arabic, the
joining forms and required ligatures shaping uses). Regenerate with `scripts/subset_fonts.sh`.

| File | Stands in for | License |
| --- | --- | --- |
| `Carlito-*.ttf` | Calibri (identical advance widths) | SIL OFL 1.1, `LICENSE-Carlito.txt` |
| `Caladea-*.ttf` | Cambria (identical advance widths) | SIL OFL 1.1, `LICENSE-Caladea.txt` |
| `LiberationSans-*.ttf` | Arial, Helvetica | SIL OFL 1.1, `LICENSE-Liberation.txt` |
| `LiberationSerif-*.ttf` | Times New Roman | SIL OFL 1.1, `LICENSE-Liberation.txt` |
| `LiberationMono-*.ttf` | Courier New | SIL OFL 1.1, `LICENSE-Liberation.txt` |
| `DejaVuSans*.ttf` | Verdana-like fallback, symbols, Wingdings/Symbol remaps | Bitstream Vera / DejaVu, `LICENSE-DejaVu.txt` |
| `STIXTwoMath-Regular.ttf` | Cambria Math's symbols, large operators, and stretchy glyphs in equations (letters and digits come from Caladea); subset with its `MATH` table by `scripts/subset_math_font.sh` (~200 KB) | SIL OFL 1.1, `LICENSE-STIX.txt` |
| `NotoNaskhArabic-*.ttf` | Arabic in serif fonts (Times New Roman, Simplified/Traditional Arabic) | SIL OFL 1.1, `LICENSE-Noto.txt` |
| `NotoSansArabic-*.ttf` | Arabic in sans-serif fonts (Arial, Tahoma, Segoe UI) | SIL OFL 1.1, `LICENSE-Noto.txt` |
| `NotoSerifHebrew-*.ttf` | Hebrew in serif fonts (Times New Roman, David, Frank Ruehl) | SIL OFL 1.1, `LICENSE-Noto.txt` |
| `NotoSansHebrew-*.ttf` | Hebrew in sans-serif fonts (Arial, Tahoma, Segoe UI) | SIL OFL 1.1, `LICENSE-Noto.txt` |
