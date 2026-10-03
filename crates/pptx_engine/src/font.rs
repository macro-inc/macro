//! Font database: registration, family matching, metrics, kerning, outlines.
//!
//! Presentations name fonts the engine cannot ship (Calibri, Arial...). Each
//! request is mapped to a registered face through a substitution table of
//! metric-compatible replacements, so line breaks match the original layout.

mod symbols;

use crate::path::{Path, Point};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
pub use symbols::{SymbolFont, remap_symbol};

/// Identifies a registered face.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct FaceId(pub u32);

/// Vertical metrics of a face, in em units (fractions of the font size).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaceMetrics {
    /// Ascent above the baseline (positive).
    pub ascent: f32,
    /// Descent below the baseline (positive).
    pub descent: f32,
    /// Extra line gap.
    pub line_gap: f32,
    /// Windows ascent (OS/2 `usWinAscent`).
    pub win_ascent: f32,
    /// Windows descent (OS/2 `usWinDescent`).
    pub win_descent: f32,
    /// Underline offset below the baseline (positive = below).
    pub underline_pos: f32,
    /// Underline thickness.
    pub underline_thickness: f32,
    /// Strikeout offset above the baseline.
    pub strike_pos: f32,
    /// Strikeout thickness.
    pub strike_thickness: f32,
    /// Height of capitals.
    pub cap_height: f32,
}

struct FaceData {
    data: Arc<Vec<u8>>,
    index: u32,
    family: String,
    family_lower: String,
    bold: bool,
    italic: bool,
    metrics: FaceMetrics,
}

/// The result of matching a requested font.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontChoice {
    /// The face to use.
    pub face: FaceId,
    /// Embolden outlines because no bold face exists.
    pub synthetic_bold: bool,
    /// Slant outlines because no italic face exists.
    pub synthetic_italic: bool,
}

/// A set of registered faces plus glyph caches.
#[derive(Default)]
pub struct FontDb {
    faces: Vec<FaceData>,
    outlines: Mutex<HashMap<(u32, u16), Option<Arc<Path>>>>,
    kerning: Mutex<HashMap<(u32, u16, u16), f32>>,
    missing: Mutex<Vec<String>>,
}

/// Families with metric-compatible (or closest available) replacements.
const SUBSTITUTES: &[(&str, &[&str])] = &[
    ("calibri", &["Carlito"]),
    ("calibri light", &["Carlito"]),
    ("cambria", &["Caladea"]),
    ("cambria math", &["Caladea"]),
    ("arial", &["Liberation Sans", "Arimo"]),
    ("helvetica", &["Liberation Sans", "Arimo"]),
    ("helvetica neue", &["Liberation Sans"]),
    ("arial narrow", &["Liberation Sans Narrow", "Liberation Sans"]),
    ("arial black", &["Liberation Sans"]),
    ("times new roman", &["Liberation Serif", "Tinos"]),
    ("times", &["Liberation Serif", "Tinos"]),
    ("courier new", &["Liberation Mono", "Cousine"]),
    ("courier", &["Liberation Mono", "Cousine"]),
    ("consolas", &["Liberation Mono"]),
    ("lucida console", &["Liberation Mono"]),
    ("verdana", &["DejaVu Sans"]),
    ("tahoma", &["DejaVu Sans", "Liberation Sans"]),
    ("segoe ui", &["Liberation Sans"]),
    ("segoe ui light", &["Liberation Sans"]),
    ("segoe ui semibold", &["Liberation Sans"]),
    ("aptos", &["Liberation Sans"]),
    ("aptos display", &["Liberation Sans"]),
    ("georgia", &["Gelasio", "Liberation Serif"]),
    ("garamond", &["Liberation Serif"]),
    ("book antiqua", &["Liberation Serif"]),
    ("palatino linotype", &["Liberation Serif"]),
    ("century", &["Liberation Serif"]),
    ("century schoolbook", &["Liberation Serif"]),
    ("trebuchet ms", &["Liberation Sans"]),
    ("century gothic", &["Liberation Sans"]),
    ("gill sans mt", &["Liberation Sans"]),
    ("franklin gothic book", &["Liberation Sans"]),
    ("franklin gothic medium", &["Liberation Sans"]),
    ("lucida sans", &["DejaVu Sans"]),
    ("lucida sans unicode", &["DejaVu Sans"]),
    ("dejavu sans", &["DejaVu Sans"]),
];

const SANS_FALLBACK: &str = "Liberation Sans";
const SERIF_FALLBACK: &str = "Liberation Serif";
const MONO_FALLBACK: &str = "Liberation Mono";
/// Faces tried, in order, for characters the chosen face lacks.
const GLYPH_FALLBACKS: &[&str] = &["DejaVu Sans", "Liberation Sans", "Carlito", "Liberation Serif"];

fn read_metrics(face: &ttf_parser::Face<'_>) -> FaceMetrics {
    let upem = f32::from(face.units_per_em().max(1));
    let (win_ascent, win_descent) = face
        .tables()
        .os2
        .map(|os2| (f32::from(os2.windows_ascender()), f32::from(os2.windows_descender()).abs()))
        .unwrap_or((f32::from(face.ascender()), f32::from(face.descender()).abs()));
    let underline = face.underline_metrics();
    let strike = face.strikeout_metrics();
    FaceMetrics {
        ascent: f32::from(face.ascender()) / upem,
        descent: f32::from(face.descender()).abs() / upem,
        line_gap: f32::from(face.line_gap()).max(0.0) / upem,
        win_ascent: win_ascent / upem,
        win_descent: win_descent / upem,
        underline_pos: underline.map_or(0.1, |m| -f32::from(m.position) / upem),
        underline_thickness: underline.map_or(0.05, |m| f32::from(m.thickness).max(1.0) / upem),
        strike_pos: strike.map_or(0.26, |m| f32::from(m.position) / upem),
        strike_thickness: strike.map_or(0.05, |m| f32::from(m.thickness).max(1.0) / upem),
        cap_height: face.capital_height().map_or(0.7, |h| f32::from(h) / upem),
    }
}

fn family_name(face: &ttf_parser::Face<'_>) -> Option<String> {
    let names = face.names();
    // Prefer the typographic family (16), then the legacy family (1).
    for id in [16u16, 1] {
        let found = names
            .into_iter()
            .filter(|n| n.name_id == id && n.is_unicode())
            .find_map(|n| n.to_string());
        if found.is_some() {
            return found;
        }
    }
    None
}

impl FontDb {
    /// An empty database.
    pub fn new() -> Self {
        Self::default()
    }

    /// The process-wide database with the bundled fonts (native builds).
    #[cfg(feature = "embedded-fonts")]
    pub fn global() -> &'static FontDb {
        static DB: std::sync::OnceLock<FontDb> = std::sync::OnceLock::new();
        DB.get_or_init(|| {
            let mut db = FontDb::new();
            for data in embedded::FONTS {
                db.register(data.to_vec());
            }
            db
        })
    }

    /// Registers all faces in a TTF/OTF/TTC file. Returns the new face ids.
    pub fn register(&mut self, data: Vec<u8>) -> Vec<FaceId> {
        let data = Arc::new(data);
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        let mut ids = Vec::new();
        for index in 0..count {
            let Ok(face) = ttf_parser::Face::parse(&data, index) else { continue };
            let Some(family) = family_name(&face) else { continue };
            let entry = FaceData {
                family_lower: family.to_lowercase(),
                family,
                bold: face.is_bold() || face.weight().to_number() >= 600,
                italic: face.is_italic() || face.is_oblique(),
                metrics: read_metrics(&face),
                data: Arc::clone(&data),
                index,
            };
            let id = FaceId(self.faces.len() as u32);
            self.faces.push(entry);
            ids.push(id);
        }
        ids
    }

    /// Number of registered faces.
    pub fn len(&self) -> usize {
        self.faces.len()
    }

    /// Whether no faces are registered.
    pub fn is_empty(&self) -> bool {
        self.faces.is_empty()
    }

    /// Family name of a face.
    pub fn family(&self, id: FaceId) -> &str {
        &self.faces[id.0 as usize].family
    }

    /// Metrics of a face.
    pub fn metrics(&self, id: FaceId) -> FaceMetrics {
        self.faces[id.0 as usize].metrics
    }

    /// Whether a family is registered (case-insensitive).
    pub fn has_family(&self, family: &str) -> bool {
        let f = family.to_lowercase();
        self.faces.iter().any(|x| x.family_lower == f)
    }

    /// Families that were requested but resolved to a substitute or fallback.
    pub fn missing_families(&self) -> Vec<String> {
        self.missing.lock().map(|m| m.clone()).unwrap_or_default()
    }

    fn note_missing(&self, family: &str) {
        if let Ok(mut m) = self.missing.lock() {
            if !m.iter().any(|x| x.eq_ignore_ascii_case(family)) {
                m.push(family.to_owned());
            }
        }
    }

    fn best_in_family(&self, family_lower: &str, bold: bool, italic: bool) -> Option<FontChoice> {
        let mut best: Option<(u32, FaceId, &FaceData)> = None;
        for (i, f) in self.faces.iter().enumerate() {
            if f.family_lower != family_lower {
                continue;
            }
            let score = u32::from(f.bold != bold) * 2 + u32::from(f.italic != italic);
            if best.is_none_or(|(s, _, _)| score < s) {
                best = Some((score, FaceId(i as u32), f));
            }
        }
        best.map(|(_, id, f)| FontChoice {
            face: id,
            synthetic_bold: bold && !f.bold,
            synthetic_italic: italic && !f.italic,
        })
    }

    /// Picks a face for `family`, applying substitutions and fallbacks.
    /// Returns `None` only when the database is empty.
    pub fn select(&self, family: &str, bold: bool, italic: bool) -> Option<FontChoice> {
        let lower = family.trim().to_lowercase();
        if let Some(c) = self.best_in_family(&lower, bold, italic) {
            return Some(c);
        }
        if !lower.is_empty() && SymbolFont::from_family(&lower).is_none() {
            self.note_missing(family.trim());
        }
        if let Some((_, subs)) = SUBSTITUTES.iter().find(|(name, _)| *name == lower) {
            for s in *subs {
                if let Some(c) = self.best_in_family(&s.to_lowercase(), bold, italic) {
                    return Some(c);
                }
            }
        }
        let generic = if lower.contains("mono") || lower.contains("courier") || lower.contains("code") {
            MONO_FALLBACK
        } else if lower.contains("serif") && !lower.contains("sans")
            || ["times", "roman", "garamond", "georgia", "book", "minion", "baskerville", "bodoni", "caslon"]
                .iter()
                .any(|k| lower.contains(k))
        {
            SERIF_FALLBACK
        } else {
            SANS_FALLBACK
        };
        self.best_in_family(&generic.to_lowercase(), bold, italic)
            .or_else(|| self.faces.first().map(|_| FontChoice { face: FaceId(0), synthetic_bold: bold, synthetic_italic: italic }))
    }

    fn with_face<R>(&self, id: FaceId, f: impl FnOnce(&ttf_parser::Face<'_>) -> R) -> Option<R> {
        let fd = self.faces.get(id.0 as usize)?;
        let face = ttf_parser::Face::parse(&fd.data, fd.index).ok()?;
        Some(f(&face))
    }

    /// Glyph id for a character in a face.
    pub fn glyph(&self, id: FaceId, ch: char) -> Option<u16> {
        self.with_face(id, |f| f.glyph_index(ch).map(|g| g.0)).flatten().filter(|g| *g != 0)
    }

    /// Maps characters to glyphs and advances (em units) in one face parse.
    pub fn shape_chars(&self, id: FaceId, chars: &[char]) -> Vec<(Option<u16>, f32)> {
        self.with_face(id, |f| {
            let upem = f32::from(f.units_per_em().max(1));
            chars
                .iter()
                .map(|&c| {
                    let g = f.glyph_index(c).filter(|g| g.0 != 0);
                    let adv = g.and_then(|g| f.glyph_hor_advance(g)).map_or(0.0, |a| f32::from(a) / upem);
                    (g.map(|g| g.0), adv)
                })
                .collect()
        })
        .unwrap_or_else(|| chars.iter().map(|_| (None, 0.0)).collect())
    }

    /// Advance of a glyph in em units.
    pub fn advance(&self, id: FaceId, glyph: u16) -> f32 {
        self.with_face(id, |f| {
            let upem = f32::from(f.units_per_em().max(1));
            f.glyph_hor_advance(ttf_parser::GlyphId(glyph)).map_or(0.0, |a| f32::from(a) / upem)
        })
        .unwrap_or(0.0)
    }

    /// A face (other than `prefer`) that has a glyph for `ch`.
    pub fn fallback_for(&self, ch: char, prefer: FaceId, bold: bool, italic: bool) -> Option<FontChoice> {
        for fam in GLYPH_FALLBACKS {
            if let Some(c) = self.best_in_family(&fam.to_lowercase(), bold, italic) {
                if c.face != prefer && self.glyph(c.face, ch).is_some() {
                    return Some(c);
                }
            }
        }
        (0..self.faces.len() as u32)
            .map(FaceId)
            .find(|&id| id != prefer && self.glyph(id, ch).is_some())
            .map(|face| FontChoice { face, synthetic_bold: bold, synthetic_italic: italic })
    }

    /// Pair kerning between two glyphs, in em units (GPOS `kern`, else `kern` table).
    pub fn kerning(&self, id: FaceId, left: u16, right: u16) -> f32 {
        let key = (id.0, left, right);
        if let Some(v) = self.kerning.lock().ok().and_then(|m| m.get(&key).copied()) {
            return v;
        }
        let v = self.with_face(id, |f| pair_kerning(f, left, right)).unwrap_or(0.0);
        if let Ok(mut m) = self.kerning.lock() {
            if m.len() > 200_000 {
                m.clear();
            }
            m.insert(key, v);
        }
        v
    }

    /// Glyph outline in em units, y pointing down, origin on the baseline.
    pub fn outline(&self, id: FaceId, glyph: u16) -> Option<Arc<Path>> {
        let key = (id.0, glyph);
        if let Some(v) = self.outlines.lock().ok().and_then(|m| m.get(&key).cloned()) {
            return v;
        }
        let path = self
            .with_face(id, |f| {
                let upem = f32::from(f.units_per_em().max(1));
                let mut b = OutlineBuilder { path: Path::new(), scale: 1.0 / upem };
                f.outline_glyph(ttf_parser::GlyphId(glyph), &mut b)?;
                Some(Arc::new(b.path))
            })
            .flatten();
        if let Ok(mut m) = self.outlines.lock() {
            if m.len() > 50_000 {
                m.clear();
            }
            m.insert(key, path.clone());
        }
        path
    }
}

fn pair_kerning(face: &ttf_parser::Face<'_>, left: u16, right: u16) -> f32 {
    use ttf_parser::GlyphId;
    use ttf_parser::gpos::{PairAdjustment, PositioningSubtable};
    let upem = f32::from(face.units_per_em().max(1));
    let (l, r) = (GlyphId(left), GlyphId(right));
    if let Some(gpos) = face.tables().gpos {
        let mut found = false;
        let mut total = 0i32;
        for feature in gpos.features.into_iter().filter(|f| &f.tag.to_bytes() == b"kern") {
            for li in feature.lookup_indices {
                let Some(lookup) = gpos.lookups.get(li) else { continue };
                for st in lookup.subtables.into_iter::<PositioningSubtable<'_>>() {
                    let PositioningSubtable::Pair(pair) = st else { continue };
                    let Some(first_index) = pair.coverage().get(l) else { continue };
                    let value = match pair {
                        PairAdjustment::Format1 { sets, .. } => {
                            sets.get(first_index).and_then(|set| set.get(r)).map(|(a, _)| a.x_advance)
                        }
                        PairAdjustment::Format2 { classes, matrix, .. } => {
                            let c = (classes.0.get(l), classes.1.get(r));
                            matrix.get(c).map(|(a, _)| a.x_advance)
                        }
                    };
                    if let Some(v) = value {
                        total += i32::from(v);
                        found = true;
                        break;
                    }
                }
            }
            if found {
                break;
            }
        }
        if found {
            return total as f32 / upem;
        }
    }
    if let Some(kern) = face.tables().kern {
        for st in kern.subtables {
            if st.horizontal && !st.variable {
                if let Some(v) = st.glyphs_kerning(l, r) {
                    return f32::from(v) / upem;
                }
            }
        }
    }
    0.0
}

struct OutlineBuilder {
    path: Path,
    scale: f32,
}

impl OutlineBuilder {
    fn pt(&self, x: f32, y: f32) -> Point {
        Point::new(x * self.scale, -y * self.scale)
    }
}

impl ttf_parser::OutlineBuilder for OutlineBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.pt(x, y);
        self.path.move_to(p);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.pt(x, y);
        self.path.line_to(p);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (c, p) = (self.pt(x1, y1), self.pt(x, y));
        self.path.quad_to(c, p);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (a, b, p) = (self.pt(x1, y1), self.pt(x2, y2), self.pt(x, y));
        self.path.cubic_to(a, b, p);
    }
    fn close(&mut self) {
        self.path.close();
    }
}

/// The bundled font files, compiled in with the `embedded-fonts` feature
/// (always on wasm32, where the browser worker has no font directory).
#[cfg(any(feature = "embedded-fonts", target_arch = "wasm32"))]
pub mod embedded {
    /// Every bundled font file.
    pub const FONTS: &[&[u8]] = &[
        include_bytes!("../fonts/Carlito-Regular.ttf"),
        include_bytes!("../fonts/Carlito-Bold.ttf"),
        include_bytes!("../fonts/Carlito-Italic.ttf"),
        include_bytes!("../fonts/Carlito-BoldItalic.ttf"),
        include_bytes!("../fonts/Caladea-Regular.ttf"),
        include_bytes!("../fonts/Caladea-Bold.ttf"),
        include_bytes!("../fonts/Caladea-Italic.ttf"),
        include_bytes!("../fonts/Caladea-BoldItalic.ttf"),
        include_bytes!("../fonts/LiberationSans-Regular.ttf"),
        include_bytes!("../fonts/LiberationSans-Bold.ttf"),
        include_bytes!("../fonts/LiberationSans-Italic.ttf"),
        include_bytes!("../fonts/LiberationSans-BoldItalic.ttf"),
        include_bytes!("../fonts/LiberationSerif-Regular.ttf"),
        include_bytes!("../fonts/LiberationSerif-Bold.ttf"),
        include_bytes!("../fonts/LiberationSerif-Italic.ttf"),
        include_bytes!("../fonts/LiberationSerif-BoldItalic.ttf"),
        include_bytes!("../fonts/LiberationMono-Regular.ttf"),
        include_bytes!("../fonts/LiberationMono-Bold.ttf"),
        include_bytes!("../fonts/LiberationMono-Italic.ttf"),
        include_bytes!("../fonts/LiberationMono-BoldItalic.ttf"),
        include_bytes!("../fonts/DejaVuSans.ttf"),
        include_bytes!("../fonts/DejaVuSans-Bold.ttf"),
    ];
}

/// Font files a browser host should offer, keyed by the family they provide.
pub const BUNDLED_FONT_FILES: &[(&str, &str)] = &[
    ("Carlito", "Carlito-Regular.ttf"),
    ("Carlito", "Carlito-Bold.ttf"),
    ("Carlito", "Carlito-Italic.ttf"),
    ("Carlito", "Carlito-BoldItalic.ttf"),
    ("Caladea", "Caladea-Regular.ttf"),
    ("Caladea", "Caladea-Bold.ttf"),
    ("Caladea", "Caladea-Italic.ttf"),
    ("Caladea", "Caladea-BoldItalic.ttf"),
    ("Liberation Sans", "LiberationSans-Regular.ttf"),
    ("Liberation Sans", "LiberationSans-Bold.ttf"),
    ("Liberation Sans", "LiberationSans-Italic.ttf"),
    ("Liberation Sans", "LiberationSans-BoldItalic.ttf"),
    ("Liberation Serif", "LiberationSerif-Regular.ttf"),
    ("Liberation Serif", "LiberationSerif-Bold.ttf"),
    ("Liberation Serif", "LiberationSerif-Italic.ttf"),
    ("Liberation Serif", "LiberationSerif-BoldItalic.ttf"),
    ("Liberation Mono", "LiberationMono-Regular.ttf"),
    ("Liberation Mono", "LiberationMono-Bold.ttf"),
    ("Liberation Mono", "LiberationMono-Italic.ttf"),
    ("Liberation Mono", "LiberationMono-BoldItalic.ttf"),
    ("DejaVu Sans", "DejaVuSans.ttf"),
    ("DejaVu Sans", "DejaVuSans-Bold.ttf"),
];

/// The bundled family that will serve a requested family (for lazy loading hosts).
pub fn bundled_family_for(requested: &str) -> &'static str {
    let lower = requested.trim().to_lowercase();
    if let Some(b) = BUNDLED_FONT_FILES.iter().find(|(fam, _)| fam.to_lowercase() == lower) {
        return b.0;
    }
    if let Some((_, subs)) = SUBSTITUTES.iter().find(|(name, _)| *name == lower) {
        if let Some(s) = subs.iter().find(|s| BUNDLED_FONT_FILES.iter().any(|(f, _)| f == *s)) {
            return BUNDLED_FONT_FILES.iter().find(|(f, _)| f == s).map_or(SANS_FALLBACK, |b| b.0);
        }
    }
    if SymbolFont::from_family(&lower).is_some() {
        return "DejaVu Sans";
    }
    SANS_FALLBACK
}

#[cfg(test)]
mod test;
