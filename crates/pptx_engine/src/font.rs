//! Font database: registration, family matching, metrics, kerning, outlines.
//!
//! Presentations name fonts the engine cannot ship (Calibri, Arial...). Each
//! request is mapped to a registered face through a substitution table of
//! metric-compatible replacements, so line breaks match the original layout.

mod symbols;

use crate::path::{Path, Point};
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::cmap::{CmapSubtable, PlatformId};
use skrifa::raw::tables::gpos::{PairPos, PositionSubtables};
use skrifa::raw::tables::kern::SubtableKind;
use skrifa::raw::types::Tag;
use skrifa::raw::{FileRef, FontRef, Offset, TableProvider};
use skrifa::{GlyphId, MetadataProvider};
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

/// Glyph outlines by (face, glyph); `None` for glyphs without one.
type OutlineCache = HashMap<(u32, u16), Option<Arc<Path>>>;

/// A set of registered faces plus glyph caches.
#[derive(Default)]
pub struct FontDb {
    faces: Vec<FaceData>,
    outlines: Mutex<OutlineCache>,
    kerning: Mutex<HashMap<(u32, u16, u16), f32>>,
    missing: Mutex<Vec<String>>,
}

/// Families with metric-compatible (or closest available) replacements,
/// keyed by lowercase family name, best first.
pub const SUBSTITUTES: &[(&str, &[&str])] = &[
    ("calibri", &["Carlito"]),
    ("calibri light", &["Carlito"]),
    ("cambria", &["Caladea"]),
    ("cambria math", &["Caladea"]),
    ("arial", &["Liberation Sans", "Arimo"]),
    ("helvetica", &["Liberation Sans", "Arimo"]),
    ("helvetica neue", &["Liberation Sans"]),
    (
        "arial narrow",
        &["Liberation Sans Narrow", "Liberation Sans"],
    ),
    ("arial black", &["Liberation Sans"]),
    ("times new roman", &["Liberation Serif", "Tinos"]),
    ("times", &["Liberation Serif", "Tinos"]),
    ("courier new", &["Liberation Mono", "Cousine"]),
    ("courier", &["Liberation Mono", "Cousine"]),
    ("consolas", &["Liberation Mono"]),
    ("lucida console", &["Liberation Mono"]),
    ("verdana", &["DejaVu Sans"]),
    // Tahoma is a narrow Verdana: about Arial's width.
    ("tahoma", &["Liberation Sans"]),
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
    // Wider than Arial but narrower than DejaVu Sans: PowerPoint-fitted
    // titles still fit in Liberation Sans and wrap in DejaVu Sans.
    ("century gothic", &["Liberation Sans"]),
    ("gill sans mt", &["Liberation Sans"]),
    ("franklin gothic book", &["Liberation Sans"]),
    ("franklin gothic medium", &["Liberation Sans"]),
    // The ClearType-collection families share Calibri's and Cambria's compact widths.
    ("corbel", &["Carlito"]),
    ("candara", &["Carlito"]),
    ("constantia", &["Caladea"]),
    ("lucida sans", &["DejaVu Sans"]),
    ("lucida sans unicode", &["DejaVu Sans"]),
    ("dejavu sans", &["DejaVu Sans"]),
];

/// Replacement for unknown sans-serif families.
pub const SANS_FALLBACK: &str = "Liberation Sans";
/// Replacement for unknown serif families.
pub const SERIF_FALLBACK: &str = "Liberation Serif";
/// Replacement for unknown monospaced families.
pub const MONO_FALLBACK: &str = "Liberation Mono";
/// Faces tried, in order, for characters the chosen face lacks.
const GLYPH_FALLBACKS: &[&str] = &[
    "DejaVu Sans",
    "Liberation Sans",
    "Carlito",
    "Liberation Serif",
];

/// Parses face `index` of a font file, requiring the tables every face needs.
fn parse_face(data: &[u8], index: u32) -> Option<FontRef<'_>> {
    let font = FontRef::from_index(data, index).ok()?;
    let upem = font.head().ok()?.units_per_em();
    (font.hhea().is_ok() && font.maxp().is_ok() && (16..=16384).contains(&upem)).then_some(font)
}

fn units_per_em(font: &FontRef<'_>) -> f32 {
    font.head()
        .map_or(1.0, |h| f32::from(h.units_per_em().max(1)))
}

/// OS/2 `fsSelection` bits.
const ITALIC: u16 = 1 << 0;
const BOLD: u16 = 1 << 5;
const USE_TYPO_METRICS: u16 = 1 << 7;
const OBLIQUE: u16 = 1 << 9;

fn selection(font: &FontRef<'_>) -> (u16, u16) {
    font.os2()
        .map_or((0, 0), |os2| (os2.version(), os2.fs_selection().bits()))
}

/// Ascender, descender, and line gap in font units, chosen the way FreeType
/// does: typographic metrics when the font asks for them, else `hhea` with
/// OS/2 fallbacks for zero values.
fn vertical_metrics(font: &FontRef<'_>) -> (i16, i16, i16) {
    let os2 = font.os2().ok();
    let (version, flags) = selection(font);
    if let Some(os2) = &os2
        && version >= 4
        && flags & USE_TYPO_METRICS != 0
    {
        return (
            os2.s_typo_ascender(),
            os2.s_typo_descender(),
            os2.s_typo_line_gap(),
        );
    }
    let (h_asc, h_desc, h_gap) = font.hhea().map_or((0, 0, 0), |h| {
        (
            h.ascender().to_i16(),
            h.descender().to_i16(),
            h.line_gap().to_i16(),
        )
    });
    let (mut asc, mut desc, mut gap) = (h_asc, h_desc, h_gap);
    if let Some(os2) = &os2 {
        if asc == 0 {
            asc = match os2.s_typo_ascender() {
                0 => os2.us_win_ascent() as i16,
                v => v,
            };
        }
        if desc == 0 {
            desc = match os2.s_typo_descender() {
                0 => (os2.us_win_descent() as i16).wrapping_neg(),
                v => v,
            };
        }
        // The line gap falls back when the ascender or descender is zero.
        if h_asc == 0 || h_desc == 0 {
            gap = if os2.s_typo_ascender() != 0 || os2.s_typo_descender() != 0 {
                os2.s_typo_line_gap()
            } else {
                0
            };
        }
    }
    (asc, desc, gap)
}

fn read_metrics(font: &FontRef<'_>) -> FaceMetrics {
    let upem = units_per_em(font);
    let (ascender, descender, line_gap) = vertical_metrics(font);
    let os2 = font.os2().ok();
    let (win_ascent, win_descent) =
        os2.as_ref()
            .map_or((f32::from(ascender), f32::from(descender).abs()), |os2| {
                (
                    f32::from(os2.us_win_ascent() as i16),
                    f32::from(os2.us_win_descent() as i16).abs(),
                )
            });
    let underline = font.post().ok().map(|post| {
        (
            post.underline_position().to_i16(),
            post.underline_thickness().to_i16(),
        )
    });
    let strike = os2
        .as_ref()
        .map(|os2| (os2.y_strikeout_position(), os2.y_strikeout_size()));
    FaceMetrics {
        ascent: f32::from(ascender) / upem,
        descent: f32::from(descender).abs() / upem,
        line_gap: f32::from(line_gap).max(0.0) / upem,
        win_ascent: win_ascent / upem,
        win_descent: win_descent / upem,
        underline_pos: underline.map_or(0.1, |(pos, _)| -f32::from(pos) / upem),
        underline_thickness: underline.map_or(0.05, |(_, t)| f32::from(t).max(1.0) / upem),
        strike_pos: strike.map_or(0.26, |(pos, _)| f32::from(pos) / upem),
        strike_thickness: strike.map_or(0.05, |(_, t)| f32::from(t).max(1.0) / upem),
        cap_height: os2
            .and_then(|os2| os2.s_cap_height())
            .map_or(0.7, |h| f32::from(h) / upem),
    }
}

/// Bold by `fsSelection` or by a weight class of 600 or more.
fn is_bold(font: &FontRef<'_>) -> bool {
    let (_, flags) = selection(font);
    let weight = font.os2().map_or(400, |os2| os2.us_weight_class());
    flags & BOLD != 0 || weight >= 600
}

/// Italic or oblique by `fsSelection`, or slanted by a nonzero italic angle.
fn is_italic(font: &FontRef<'_>) -> bool {
    let (version, flags) = selection(font);
    let angle = font.post().map_or(0.0, |post| post.italic_angle().to_f32());
    flags & ITALIC != 0 || (version >= 4 && flags & OBLIQUE != 0) || angle != 0.0
}

fn family_name(font: &FontRef<'_>) -> Option<String> {
    let name = font.name().ok()?;
    let storage = name.string_data().as_bytes();
    // Prefer the typographic family (16), then the legacy family (1), from
    // Unicode or Windows symbol/BMP records, in table order.
    for id in [16u16, 1] {
        let found = name
            .name_record()
            .iter()
            .filter(|n| {
                n.name_id().to_u16() == id
                    && (n.platform_id() == 0 || (n.platform_id() == 3 && n.encoding_id() <= 1))
            })
            .find_map(|n| {
                let start = n.string_offset().to_usize();
                let bytes = storage.get(start..start + usize::from(n.length()))?;
                let units: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_be_bytes([c[0], c[1]]))
                    .collect();
                String::from_utf16(&units).ok()
            });
        if found.is_some() {
            return found;
        }
    }
    None
}

/// The glyph for `ch` from the first Unicode `cmap` subtable that maps it.
fn glyph_index(font: &FontRef<'_>, ch: char) -> Option<u16> {
    let cmap = font.cmap().ok()?;
    for record in cmap.encoding_records() {
        let Ok(subtable) = record.subtable(cmap.offset_data()) else {
            continue;
        };
        let unicode = match record.platform_id() {
            PlatformId::Unicode => true,
            PlatformId::Windows => {
                record.encoding_id() == 1
                    || (record.encoding_id() == 10
                        && matches!(
                            subtable,
                            CmapSubtable::Format12(_) | CmapSubtable::Format13(_)
                        ))
            }
            _ => false,
        };
        if !unicode {
            continue;
        }
        // Glyph 0 is "not mapped": a later Unicode subtable may still have one.
        if let Some(glyph) = subtable.map_codepoint(ch).filter(|g| g.to_u32() != 0) {
            return u16::try_from(glyph.to_u32()).ok();
        }
    }
    None
}

/// Horizontal advance of a glyph in font units.
fn glyph_advance(font: &FontRef<'_>, glyph: u16) -> Option<u16> {
    let glyphs = font.maxp().ok()?.num_glyphs();
    if glyph >= glyphs {
        return None;
    }
    font.hmtx().ok()?.advance(GlyphId::new(u32::from(glyph)))
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
        let count = match FileRef::new(&data) {
            Ok(FileRef::Collection(collection)) => collection.len(),
            _ => 1,
        };
        let mut ids = Vec::new();
        for index in 0..count {
            let Some(face) = parse_face(&data, index) else {
                continue;
            };
            let Some(family) = family_name(&face) else {
                continue;
            };
            let entry = FaceData {
                family_lower: family.to_lowercase(),
                family,
                bold: is_bold(&face),
                italic: is_italic(&face),
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
        if let Ok(mut m) = self.missing.lock()
            && !m.iter().any(|x| x.eq_ignore_ascii_case(family))
        {
            m.push(family.to_owned());
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
        let generic =
            if lower.contains("mono") || lower.contains("courier") || lower.contains("code") {
                MONO_FALLBACK
            } else if lower.contains("serif") && !lower.contains("sans")
                || [
                    "times",
                    "roman",
                    "garamond",
                    "georgia",
                    "book",
                    "minion",
                    "baskerville",
                    "bodoni",
                    "caslon",
                ]
                .iter()
                .any(|k| lower.contains(k))
            {
                SERIF_FALLBACK
            } else {
                SANS_FALLBACK
            };
        self.best_in_family(&generic.to_lowercase(), bold, italic)
            .or_else(|| {
                self.faces.first().map(|_| FontChoice {
                    face: FaceId(0),
                    synthetic_bold: bold,
                    synthetic_italic: italic,
                })
            })
    }

    fn with_face<R>(&self, id: FaceId, f: impl FnOnce(&FontRef<'_>) -> R) -> Option<R> {
        let fd = self.faces.get(id.0 as usize)?;
        let face = FontRef::from_index(&fd.data, fd.index).ok()?;
        Some(f(&face))
    }

    /// Glyph id for a character in a face.
    pub fn glyph(&self, id: FaceId, ch: char) -> Option<u16> {
        self.with_face(id, |f| glyph_index(f, ch))
            .flatten()
            .filter(|g| *g != 0)
    }

    /// Maps characters to glyphs and advances (em units) in one face parse.
    pub fn shape_chars(&self, id: FaceId, chars: &[char]) -> Vec<(Option<u16>, f32)> {
        self.with_face(id, |f| {
            let upem = units_per_em(f);
            chars
                .iter()
                .map(|&c| {
                    let g = glyph_index(f, c).filter(|g| *g != 0);
                    let adv = g
                        .and_then(|g| glyph_advance(f, g))
                        .map_or(0.0, |a| f32::from(a) / upem);
                    (g, adv)
                })
                .collect()
        })
        .unwrap_or_else(|| chars.iter().map(|_| (None, 0.0)).collect())
    }

    /// Advance of a glyph in em units.
    pub fn advance(&self, id: FaceId, glyph: u16) -> f32 {
        self.with_face(id, |f| {
            glyph_advance(f, glyph).map_or(0.0, |a| f32::from(a) / units_per_em(f))
        })
        .unwrap_or(0.0)
    }

    /// A face (other than `prefer`) that has a glyph for `ch`.
    pub fn fallback_for(
        &self,
        ch: char,
        prefer: FaceId,
        bold: bool,
        italic: bool,
    ) -> Option<FontChoice> {
        for fam in GLYPH_FALLBACKS {
            if let Some(c) = self.best_in_family(&fam.to_lowercase(), bold, italic)
                && c.face != prefer
                && self.glyph(c.face, ch).is_some()
            {
                return Some(c);
            }
        }
        (0..self.faces.len() as u32)
            .map(FaceId)
            .find(|&id| id != prefer && self.glyph(id, ch).is_some())
            .map(|face| FontChoice {
                face,
                synthetic_bold: bold,
                synthetic_italic: italic,
            })
    }

    /// Pair kerning between two glyphs, in em units (GPOS `kern`, else `kern` table).
    pub fn kerning(&self, id: FaceId, left: u16, right: u16) -> f32 {
        let key = (id.0, left, right);
        if let Some(v) = self.kerning.lock().ok().and_then(|m| m.get(&key).copied()) {
            return v;
        }
        let v = self
            .with_face(id, |f| pair_kerning(f, left, right))
            .unwrap_or(0.0);
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
                let mut b = OutlineBuilder {
                    path: Path::new(),
                    scale: 1.0 / units_per_em(f),
                    drawn: false,
                };
                let outline = f.outline_glyphs().get(GlyphId::new(u32::from(glyph)))?;
                let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
                outline.draw(settings, &mut b).ok()?;
                // Glyphs without contours (spaces) have no outline.
                b.drawn.then(|| Arc::new(b.path))
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

fn pair_kerning(face: &FontRef<'_>, left: u16, right: u16) -> f32 {
    let upem = units_per_em(face);
    let (l, r) = (
        GlyphId::new(u32::from(left)),
        GlyphId::new(u32::from(right)),
    );
    if let Some(total) = gpos_kerning(face, l, r) {
        return total as f32 / upem;
    }
    if let Ok(kern) = face.kern() {
        for st in kern.subtables().flatten() {
            if !st.is_horizontal() || st.is_variable() {
                continue;
            }
            let value = match st.kind() {
                Ok(SubtableKind::Format0(t)) => t.kerning(l, r),
                Ok(SubtableKind::Format2(t)) => t.kerning(l, r),
                Ok(SubtableKind::Format3(t)) => t.kerning(l, r),
                _ => None,
            };
            if let Some(v) = value {
                return v as f32 / upem;
            }
        }
    }
    0.0
}

/// The summed `kern`-feature pair adjustments of the first GPOS `kern`
/// feature that has any for this pair (one per lookup), in font units.
fn gpos_kerning(face: &FontRef<'_>, l: GlyphId, r: GlyphId) -> Option<i32> {
    let gpos = face.gpos().ok()?;
    let features = gpos.feature_list().ok()?;
    let lookups = gpos.lookup_list().ok()?.lookups();
    let kern = Tag::new(b"kern");
    for record in features.feature_records() {
        if record.feature_tag() != kern {
            continue;
        }
        let Ok(feature) = record.feature(features.offset_data()) else {
            continue;
        };
        let mut found = false;
        let mut total = 0i32;
        for index in feature.lookup_list_indices() {
            let Ok(lookup) = lookups.get(usize::from(index.get())) else {
                continue;
            };
            let Ok(PositionSubtables::Pair(subtables)) = lookup.subtables() else {
                continue;
            };
            // The first subtable with a value for the pair applies.
            if let Some(v) = subtables
                .iter()
                .flatten()
                .find_map(|pair| pair_value(&pair, l, r))
            {
                total += i32::from(v);
                found = true;
            }
        }
        if found {
            return Some(total);
        }
    }
    None
}

/// The x-advance adjustment a pair-positioning subtable gives `l` then `r`.
fn pair_value(pair: &PairPos<'_>, l: GlyphId, r: GlyphId) -> Option<i16> {
    match pair {
        PairPos::Format1(t) => {
            let first_index = t.coverage().ok()?.get(l)?;
            let set = t.pair_sets().get(usize::from(first_index)).ok()?;
            let record = set
                .pair_value_records()
                .iter()
                .flatten()
                .find(|rec| u32::from(rec.second_glyph().to_u16()) == r.to_u32())?;
            Some(record.value_record1().x_advance().unwrap_or(0))
        }
        PairPos::Format2(t) => {
            t.coverage().ok()?.get(l)?;
            let c1 = t.class_def1().ok()?.get(l);
            let c2 = t.class_def2().ok()?.get(r);
            let row = t.class1_records().get(usize::from(c1)).ok()?;
            let cell = row.class2_records().get(usize::from(c2)).ok()?;
            Some(cell.value_record1().x_advance().unwrap_or(0))
        }
    }
}

struct OutlineBuilder {
    path: Path,
    scale: f32,
    /// Whether any contour was drawn.
    drawn: bool,
}

impl OutlineBuilder {
    fn pt(&self, x: f32, y: f32) -> Point {
        Point::new(x * self.scale, -y * self.scale)
    }
}

impl OutlinePen for OutlineBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.pt(x, y);
        self.drawn = true;
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
    if let Some(b) = BUNDLED_FONT_FILES
        .iter()
        .find(|(fam, _)| fam.to_lowercase() == lower)
    {
        return b.0;
    }
    if let Some((_, subs)) = SUBSTITUTES.iter().find(|(name, _)| *name == lower)
        && let Some(s) = subs
            .iter()
            .find(|s| BUNDLED_FONT_FILES.iter().any(|(f, _)| f == *s))
    {
        return BUNDLED_FONT_FILES
            .iter()
            .find(|(f, _)| f == s)
            .map_or(SANS_FALLBACK, |b| b.0);
    }
    if SymbolFont::from_family(&lower).is_some() {
        return "DejaVu Sans";
    }
    SANS_FALLBACK
}

#[cfg(test)]
mod test;
