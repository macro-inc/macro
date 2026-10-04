//! Font selection and text measurement for layout.
//!
//! Word measures with GDI metrics: a line of "single" spacing is the font's
//! Windows ascent plus descent plus whatever external leading the `hhea`
//! line gap adds beyond them. The bundled substitutes (Liberation, Carlito,
//! Caladea) share their originals' advance widths and vertical metrics, so
//! line breaks and line heights match the originals.

mod widths;

pub use widths::Widths;

use pptx_engine::font::{FaceId, FontChoice, FontDb, SymbolFont, remap_symbol};
use std::cell::RefCell;
use std::collections::HashMap;

/// Vertical metrics of a face in em units, as Word uses them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VMetrics {
    /// Ascent above the baseline.
    pub ascent: f32,
    /// Descent below the baseline.
    pub descent: f32,
    /// External leading Word adds to single line spacing.
    pub leading: f32,
}

impl VMetrics {
    /// Height of a single-spaced line, in em.
    pub fn line(&self) -> f32 {
        self.ascent + self.descent + self.leading
    }
}

/// Vertical metrics (units per em, win ascent, win descent, hhea ascender,
/// hhea descender, hhea line gap) of the fonts Word documents name most,
/// taken from the Microsoft originals. Layout uses them whenever a document
/// asks for one of these families, so line heights match Word even where
/// the bundled substitute's vertical metrics differ (Caladea's do, and the
/// Unicode face that draws Symbol and Wingdings bullets).
const TRUE_METRICS: &[(&str, [f32; 6])] = &[
    (
        "times new roman",
        [2048.0, 1825.0, 443.0, 1825.0, 443.0, 87.0],
    ),
    ("arial", [2048.0, 1854.0, 434.0, 1854.0, 434.0, 67.0]),
    ("calibri", [2048.0, 1950.0, 550.0, 1536.0, 512.0, 452.0]),
    (
        "calibri light",
        [2048.0, 1950.0, 550.0, 1536.0, 512.0, 452.0],
    ),
    ("cambria", [2048.0, 1946.0, 455.0, 1946.0, 455.0, 0.0]),
    ("courier new", [2048.0, 1705.0, 615.0, 1705.0, 615.0, 0.0]),
    ("verdana", [2048.0, 2059.0, 430.0, 2059.0, 430.0, 0.0]),
    ("tahoma", [2048.0, 2049.0, 423.0, 2049.0, 423.0, 0.0]),
    ("georgia", [2048.0, 1878.0, 449.0, 1878.0, 449.0, 0.0]),
    (
        "simplified arabic",
        [2048.0, 2416.0, 979.0, 2416.0, 979.0, 0.0],
    ),
    (
        "traditional arabic",
        [2048.0, 2095.0, 1044.0, 2095.0, 1044.0, 0.0],
    ),
    ("symbol", [2048.0, 2059.0, 443.0, 2059.0, 443.0, 0.0]),
    ("wingdings", [2048.0, 1841.0, 420.0, 1841.0, 420.0, 0.0]),
];

/// Arabic families drawn with a Noto substitute: how wide their letters
/// are relative to the substitute's, and their space (em), measured from
/// the originals so lines break where Word breaks them.
const ARABIC_WIDTHS: &[(&str, f32, f32)] = &[("simplified arabic", 0.875, 0.317)];

/// Families drawn by squeezing their wider substitute: Arial Narrow is
/// Arial at 82% of its width; Lucida Sans runs a little narrower than the
/// DejaVu Sans that stands in for it.
const CONDENSED: &[(&str, f32)] = &[
    ("arial narrow", 0.82),
    ("liberation sans narrow", 0.82),
    ("helvetica narrow", 0.82),
    ("helvetica condensed", 0.82),
    ("lucida sans", 0.965),
    ("lucida sans unicode", 0.965),
];

/// A face whose `n` is at least this wide (em) is not a condensed face.
const REGULAR_N_WIDTH: f32 = 0.5;

/// Average advance (em) of Arabic letters in joined text (Simplified
/// Arabic, Arial, Times New Roman measure about this much).
const ARABIC_ADVANCE: f32 = 0.35;
/// Average advance (em) of Hebrew letters.
const HEBREW_ADVANCE: f32 = 0.5;

/// The typical advance (em) of a character of a script no bundled face
/// covers, so layout keeps the text's length without the font.
pub fn missing_advance(c: char) -> Option<f32> {
    if is_wide(c) {
        // Every CJK font draws these one em wide.
        return Some(1.0);
    }
    match c as u32 {
        // Vowel marks and other combining signs take no room.
        0x064B..=0x065F
        | 0x0670
        | 0x06D6..=0x06ED
        | 0x0591..=0x05BD
        | 0x05BF
        | 0x05C1
        | 0x05C2
        | 0x05C4
        | 0x05C5
        | 0x05C7 => Some(0.0),
        0x0600..=0x06FF | 0x0750..=0x077F | 0x08A0..=0x08FF | 0xFB50..=0xFDFF | 0xFE70..=0xFEFF => {
            Some(ARABIC_ADVANCE)
        }
        0x0590..=0x05FF | 0xFB1D..=0xFB4F => Some(HEBREW_ADVANCE),
        _ => None,
    }
}

/// Whether a character is East Asian wide or full-width (ideographs, kana,
/// hangul, CJK punctuation and full-width forms): one em in any CJK font.
pub fn is_wide(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x115F | 0x2E80..=0x303E | 0x3041..=0x33FF | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF | 0xA000..=0xA4CF | 0xA960..=0xA97F | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF | 0xFE10..=0xFE19 | 0xFE30..=0xFE6F | 0xFF01..=0xFF60
        | 0xFFE0..=0xFFE6 | 0x20000..=0x2FFFD | 0x30000..=0x3FFFD)
}

/// A resolved font: face plus synthesis flags.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Font {
    /// The face.
    pub face: FaceId,
    /// Embolden outlines.
    pub synthetic_bold: bool,
    /// Slant outlines.
    pub synthetic_italic: bool,
    /// Characters are remapped from a symbol font encoding.
    pub symbol: Option<SymbolKind>,
    /// The advances of the font the face stands in for, when known.
    pub widths: Option<Widths>,
}

/// A symbol font encoding (hashable mirror of [`SymbolFont`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SymbolKind {
    /// Wingdings.
    Wingdings,
    /// Wingdings 2.
    Wingdings2,
    /// Wingdings 3.
    Wingdings3,
    /// Symbol.
    Symbol,
    /// Webdings.
    Webdings,
}

impl SymbolKind {
    fn from_font(f: SymbolFont) -> Self {
        match f {
            SymbolFont::Wingdings => SymbolKind::Wingdings,
            SymbolFont::Wingdings2 => SymbolKind::Wingdings2,
            SymbolFont::Wingdings3 => SymbolKind::Wingdings3,
            SymbolFont::Symbol => SymbolKind::Symbol,
            SymbolFont::Webdings => SymbolKind::Webdings,
        }
    }

    fn to_font(self) -> SymbolFont {
        match self {
            SymbolKind::Wingdings => SymbolFont::Wingdings,
            SymbolKind::Wingdings2 => SymbolFont::Wingdings2,
            SymbolKind::Wingdings3 => SymbolFont::Wingdings3,
            SymbolKind::Symbol => SymbolFont::Symbol,
            SymbolKind::Webdings => SymbolFont::Webdings,
        }
    }
}

/// A measured character.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Glyph {
    /// The face that draws it (the requested one or a fallback).
    pub font: Font,
    /// Glyph id (0 = none).
    pub id: u16,
    /// Advance in em units.
    pub advance: f32,
}

/// Fonts plus measurement caches. Interior mutability keeps layout code
/// free to measure through shared references.
pub struct Fonts<'a> {
    db: &'a FontDb,
    choices: RefCell<HashMap<(String, bool, bool), Font>>,
    glyphs: RefCell<HashMap<(Font, char), Glyph>>,
    metrics: RefCell<HashMap<FaceId, VMetrics>>,
}

impl<'a> Fonts<'a> {
    /// Wraps a font database.
    pub fn new(db: &'a FontDb) -> Self {
        Self {
            db,
            choices: RefCell::new(HashMap::new()),
            glyphs: RefCell::new(HashMap::new()),
            metrics: RefCell::new(HashMap::new()),
        }
    }

    /// The database.
    pub fn db(&self) -> &'a FontDb {
        self.db
    }

    /// The font for a family name and style.
    pub fn select(&self, family: &str, bold: bool, italic: bool) -> Option<Font> {
        let key = (family.to_owned(), bold, italic);
        if let Some(f) = self.choices.borrow().get(&key) {
            return Some(*f);
        }
        let lower = family.trim().to_lowercase();
        let symbol = SymbolFont::from_family(&lower).map(SymbolKind::from_font);
        let choice: FontChoice = if symbol.is_some() {
            // Symbol fonts are drawn from a face with the Unicode equivalents.
            self.db.select("DejaVu Sans", bold, italic)?
        } else {
            self.db.select(family, bold, italic)?
        };
        let font = Font {
            face: choice.face,
            synthetic_bold: choice.synthetic_bold,
            synthetic_italic: choice.synthetic_italic,
            symbol,
            widths: Widths::for_family(&lower, bold),
        };
        self.choices.borrow_mut().insert(key, font);
        Some(font)
    }

    /// Vertical metrics for text a document set in `family`, drawn with
    /// `face`: the original font's when known, else the face's own.
    pub fn vmetrics_for(&self, family: &str, face: FaceId) -> VMetrics {
        let lower = family.trim().to_lowercase();
        if let Some((_, m)) = TRUE_METRICS.iter().find(|(name, _)| *name == lower) {
            let [upem, wa, wd, ha, hd, gap] = *m;
            let leading = (gap - ((wa + wd) - (ha + hd))).max(0.0);
            return VMetrics {
                ascent: wa / upem,
                descent: wd / upem,
                leading: leading / upem,
            };
        }
        self.vmetrics(face)
    }

    /// Horizontal scale that makes `face` as wide as `family` when the face
    /// substitutes a condensed family at regular width (else 1).
    pub fn width_factor(&self, family: &str, face: FaceId) -> f32 {
        let lower = family.trim().to_lowercase();
        let Some((_, factor)) = CONDENSED.iter().find(|(name, _)| *name == lower) else {
            return 1.0;
        };
        let n = self
            .db
            .glyph(face, 'n')
            .map_or(0.0, |g| self.db.advance(face, g));
        if n >= REGULAR_N_WIDTH { *factor } else { 1.0 }
    }

    /// For an Arabic family drawn by a substitute: the scale of its
    /// letters' advances and its space's advance (em).
    pub fn arabic_widths(&self, family: &str) -> Option<(f32, f32)> {
        let family = family.trim();
        ARABIC_WIDTHS
            .iter()
            .find(|(name, _, _)| name.eq_ignore_ascii_case(family))
            .map(|&(_, letters, space)| (letters, space))
    }

    /// Vertical metrics of a face.
    pub fn vmetrics(&self, face: FaceId) -> VMetrics {
        if let Some(m) = self.metrics.borrow().get(&face) {
            return *m;
        }
        let fm = self.db.metrics(face);
        let (mut ascent, mut descent) = (fm.win_ascent, fm.win_descent);
        if ascent + descent <= 0.0 {
            ascent = fm.ascent;
            descent = fm.descent;
        }
        let hhea = fm.ascent + fm.descent;
        let leading = (fm.line_gap - ((ascent + descent) - hhea)).max(0.0);
        let m = VMetrics {
            ascent,
            descent,
            leading,
        };
        self.metrics.borrow_mut().insert(face, m);
        m
    }

    /// Measures one character in `font`, falling back to another face when
    /// the font has no glyph for it.
    pub fn glyph(&self, font: Font, ch: char) -> Glyph {
        if let Some(g) = self.glyphs.borrow().get(&(font, ch)) {
            return *g;
        }
        let mapped = match font.symbol {
            Some(s) => remap_symbol(s.to_font(), ch),
            None => ch,
        };
        let g = match self.db.glyph(font.face, mapped) {
            Some(id) => Glyph {
                font,
                id,
                advance: font
                    .widths
                    .and_then(|w| w.advance(mapped))
                    .unwrap_or_else(|| self.db.advance(font.face, id)),
            },
            None => {
                let fallback = self.db.fallback_for(
                    mapped,
                    font.face,
                    font.synthetic_bold,
                    font.synthetic_italic,
                );
                match fallback.and_then(|c| self.db.glyph(c.face, mapped).map(|id| (c, id))) {
                    Some((c, id)) => Glyph {
                        font: Font {
                            face: c.face,
                            synthetic_bold: c.synthetic_bold,
                            synthetic_italic: c.synthetic_italic,
                            symbol: None,
                            widths: None,
                        },
                        id,
                        advance: self.db.advance(c.face, id),
                    },
                    None => {
                        // No face has it: the script's typical advance, else
                        // a space's so text keeps its shape.
                        let space = self.db.glyph(font.face, ' ');
                        Glyph {
                            font,
                            id: 0,
                            advance: missing_advance(ch).unwrap_or_else(|| {
                                space.map_or(0.25, |s| self.db.advance(font.face, s))
                            }),
                        }
                    }
                }
            }
        };
        self.glyphs.borrow_mut().insert((font, ch), g);
        g
    }

    /// Pair kerning in em units.
    pub fn kerning(&self, face: FaceId, left: u16, right: u16) -> f32 {
        self.db.kerning(face, left, right)
    }
}

#[cfg(test)]
mod test;
