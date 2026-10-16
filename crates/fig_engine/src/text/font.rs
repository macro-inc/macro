//! Fonts for laying out text: the bundled Inter and fonts registered at run
//! time (TTF, OTF, collections, WOFF, WOFF2), chosen by family and Figma
//! style name, with variable fonts set to the style's weight, slant, width,
//! and optical size.

use super::woff;
use crate::document::Document;
use crate::geometry;
use serde::Serialize;
use skrifa::instance::{Location, LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::gpos::{PairPos, PositionSubtables};
use skrifa::raw::tables::kern::SubtableKind;
use skrifa::raw::{FileRef, TableProvider};
use skrifa::string::StringId;
use skrifa::{FontRef, GlyphId, MetadataProvider, Tag};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tiny_skia::PathBuilder;

/// Inter, the family new text uses and the stand-in for missing families.
const INTER: &[u8] = include_bytes!("../../fonts/InterVariable.ttf");
pub const DEFAULT_FAMILY: &str = "Inter";

/// Shear of synthesized italics (about 10°).
const SLANT: f32 = 0.18;

const WGHT: Tag = Tag::new(b"wght");
const ITAL: Tag = Tag::new(b"ital");
const SLNT: Tag = Tag::new(b"slnt");
const WDTH: Tag = Tag::new(b"wdth");
const OPSZ: Tag = Tag::new(b"opsz");

/// One face of a registered font file.
pub(crate) struct FontFile {
    data: &'static [u8],
    index: u32,
    family: String,
    /// The face's style name ("Semi Bold Italic"), as the font names it.
    style: String,
    /// The weights it covers: its `wght` axis, or its one weight.
    weights: (f32, f32),
    italic: bool,
    /// Width in percent of normal (its `wdth` default).
    width: f32,
    /// Axes: tag, minimum, default, maximum.
    axes: Vec<(Tag, f32, f32, f32)>,
    /// The face's PostScript name ("Inter-Bold"), when it has one.
    postscript: Option<String>,
    hash: u64,
}

impl FontFile {
    fn font(&self) -> FontRef<'static> {
        FontRef::from_index(self.data, self.index).expect("checked when registered")
    }

    fn has_axis(&self, tag: Tag) -> bool {
        self.axes.iter().any(|a| a.0 == tag)
    }
}

/// A face as the editor sees it after registering a font.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredFace {
    pub family: String,
    pub style: String,
    pub weight: f32,
    /// The heaviest weight a variable font reaches (its `weight` otherwise).
    pub max_weight: f32,
    pub italic: bool,
    pub variable: bool,
}

impl From<&FontFile> for RegisteredFace {
    fn from(f: &FontFile) -> Self {
        RegisteredFace {
            family: f.family.clone(),
            style: f.style.clone(),
            weight: f.weights.0,
            max_weight: f.weights.1,
            italic: f.italic,
            variable: !f.axes.is_empty(),
        }
    }
}

fn registry() -> &'static Mutex<Vec<&'static FontFile>> {
    static FONTS: OnceLock<Mutex<Vec<&'static FontFile>>> = OnceLock::new();
    FONTS.get_or_init(|| {
        let faces = faces(INTER, Some(DEFAULT_FAMILY));
        Mutex::new(
            faces
                .into_iter()
                .map(|f| &*Box::leak(Box::new(f)))
                .collect(),
        )
    })
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// The faces in a font file (`sfnt` bytes), named `family` when given.
fn faces(data: &'static [u8], family: Option<&str>) -> Vec<FontFile> {
    let count = match FileRef::new(data) {
        Ok(FileRef::Collection(c)) => c.len(),
        Ok(FileRef::Font(_)) => 1,
        Err(_) => 0,
    };
    let hash = fnv(data);
    (0..count)
        .filter_map(|index| {
            let font = FontRef::from_index(data, index).ok()?;
            let upem = font.head().ok()?.units_per_em();
            if font.hhea().is_err() || !(16..=16384).contains(&upem) {
                return None;
            }
            let name = |ids: &[StringId]| {
                ids.iter().find_map(|&id| {
                    let s = font.localized_strings(id).english_or_first()?;
                    let s: String = s.chars().collect();
                    (!s.trim().is_empty()).then(|| s.trim().to_string())
                })
            };
            let family = match family {
                Some(f) => f.to_string(),
                None => name(&[StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME])?,
            };
            let style = name(&[
                StringId::TYPOGRAPHIC_SUBFAMILY_NAME,
                StringId::SUBFAMILY_NAME,
            ])
            .unwrap_or_else(|| "Regular".into());
            let axes: Vec<(Tag, f32, f32, f32)> = font
                .axes()
                .iter()
                .map(|a| (a.tag(), a.min_value(), a.default_value(), a.max_value()))
                .collect();
            let attrs = font.attributes();
            let axis = |tag: Tag| axes.iter().find(|a| a.0 == tag);
            let weights = match axis(WGHT) {
                Some(a) => (a.1, a.3),
                None => (attrs.weight.value(), attrs.weight.value()),
            };
            let italic = !matches!(attrs.style, skrifa::attribute::Style::Normal)
                || parse_style(&style).italic;
            // Static fonts split per weight may all be named "Regular".
            let style = if axes.is_empty() && (parse_style(&style).weight - weights.0).abs() > 100.0
            {
                style_name(weights.0, italic)
            } else {
                style
            };
            let width = axis(WDTH).map_or(attrs.stretch.ratio() * 100.0, |a| a.2);
            let postscript = name(&[StringId::POSTSCRIPT_NAME]);
            Some(FontFile {
                data,
                index,
                family,
                style,
                weights,
                italic,
                width,
                axes,
                postscript,
                hash,
            })
        })
        .collect()
}

/// Makes a font available for layout: a TTF, OTF, collection, WOFF, or
/// WOFF2 file, under `family` when given (else the family it names).
/// Returns the faces it holds; none when the file does not parse.
/// Registering the same file again changes nothing.
pub fn register_font(bytes: Vec<u8>, family: Option<&str>) -> Vec<RegisteredFace> {
    let Some(sfnt) = woff::to_sfnt(&bytes).map(|s| s.into_owned()) else {
        return Vec::new();
    };
    let hash = fnv(&sfnt);
    let family = family.map(str::trim).filter(|f| !f.is_empty());
    let mut list = registry().lock().expect("font registry");
    let known: Vec<RegisteredFace> = list
        .iter()
        .filter(|f| f.hash == hash && family.is_none_or(|n| f.family == n))
        .map(|f| RegisteredFace::from(*f))
        .collect();
    if !known.is_empty() {
        return known;
    }
    let data: &'static [u8] = Box::leak(sfnt.into_boxed_slice());
    let found = faces(data, family);
    let out = found.iter().map(RegisteredFace::from).collect();
    list.extend(found.into_iter().map(|f| &*Box::leak(Box::new(f))));
    out
}

/// Every registered face (Inter first).
pub fn registered() -> Vec<RegisteredFace> {
    registry()
        .lock()
        .expect("font registry")
        .iter()
        .map(|f| RegisteredFace::from(*f))
        .collect()
}

/// What a Figma style name asks for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StyleRequest {
    /// CSS weight: 100 (Thin) to 900 (Black).
    pub weight: f32,
    pub italic: bool,
    /// Percent of normal width.
    pub width: f32,
    /// An optical size the name gives ("9pt Regular").
    pub optical_size: Option<f32>,
}

fn squash(s: &str) -> String {
    s.to_ascii_lowercase()
        .chars()
        .filter(|c| !matches!(c, ' ' | '-' | '_'))
        .collect()
}

/// Reads a Figma style name ("Semi Bold Italic", "Condensed Medium",
/// "9pt Regular", "45 Light") the way fonts name their styles.
pub fn parse_style(style: &str) -> StyleRequest {
    let s = squash(style);
    let has = |k: &str| s.contains(k);
    let weight = if has("thin") || has("hairline") {
        100.0
    } else if has("extralight") || has("ultralight") {
        200.0
    } else if has("semilight") || has("demilight") {
        350.0
    } else if has("light") {
        300.0
    } else if has("semibold") || has("demibold") {
        600.0
    } else if has("extrabold") || has("ultrabold") {
        800.0
    } else if has("black") || has("heavy") {
        900.0
    } else if has("bold") {
        700.0
    } else if has("medium") {
        500.0
    } else {
        400.0
    };
    let width = if has("ultracondensed") {
        50.0
    } else if has("extracondensed") {
        62.5
    } else if has("semicondensed") {
        87.5
    } else if has("condensed") || has("narrow") {
        75.0
    } else if has("ultraexpanded") {
        200.0
    } else if has("extraexpanded") {
        150.0
    } else if has("semiexpanded") {
        112.5
    } else if has("expanded") || has("wide") {
        125.0
    } else {
        100.0
    };
    let optical_size = s
        .find("pt")
        .and_then(|end| {
            let digits: String = s[..end]
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            digits.parse::<f32>().ok()
        })
        .filter(|v| *v > 0.0);
    StyleRequest {
        weight,
        italic: has("italic") || has("oblique"),
        width,
        optical_size,
    }
}

/// How well the fonts can show a family and style.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FontStatus {
    /// The family is registered with this style (or a variable font
    /// covering it).
    Available,
    /// The family is registered, but not this style; the nearest stands in.
    StyleMissing,
    /// The family is not registered; Inter stands in.
    Missing,
}

/// How far a face is from what a style asks for (0: a match).
fn distance(f: &FontFile, style: &str, want: &StyleRequest) -> f32 {
    let (lo, hi) = f.weights;
    let weight = if want.weight < lo {
        lo - want.weight
    } else if want.weight > hi {
        want.weight - hi
    } else {
        0.0
    };
    let slant = if want.italic == f.italic || (want.italic && f.has_axis(ITAL)) {
        0.0
    } else {
        1000.0
    };
    let width = if f.has_axis(WDTH) {
        0.0
    } else {
        (f.width - want.width).abs() * 4.0
    };
    // A face named as asked matches when its weight is near (a "Book" at
    // 350); fonts split per weight often all call themselves "Regular".
    if squash(&f.style) == squash(style) && weight <= 100.0 && slant == 0.0 {
        return 0.0;
    }
    weight + slant + width
}

/// Figma's name for a weight and slant ("Semi Bold Italic").
pub fn style_name(weight: f32, italic: bool) -> String {
    const NAMES: [(f32, &str); 9] = [
        (100.0, "Thin"),
        (200.0, "Extra Light"),
        (300.0, "Light"),
        (400.0, "Regular"),
        (500.0, "Medium"),
        (600.0, "Semi Bold"),
        (700.0, "Bold"),
        (800.0, "Extra Bold"),
        (900.0, "Black"),
    ];
    let name = NAMES
        .iter()
        .min_by(|a, b| (a.0 - weight).abs().total_cmp(&(b.0 - weight).abs()))
        .map_or("Regular", |n| n.1);
    match (name, italic) {
        (_, false) => name.to_string(),
        ("Regular", true) => "Italic".to_string(),
        (_, true) => format!("{name} Italic"),
    }
}

/// The faces that show `family` in `style`, best first (faces sharing its
/// style after it, for files split by script), and how well they match.
fn select(family: &str, style: &str) -> (Vec<&'static FontFile>, FontStatus) {
    let want = parse_style(style);
    let list = registry().lock().expect("font registry");
    let pick = |family: &str| -> Option<(Vec<&'static FontFile>, f32)> {
        let in_family: Vec<&'static FontFile> = list
            .iter()
            .copied()
            .filter(|f| f.family.eq_ignore_ascii_case(family))
            .collect();
        let best = in_family
            .iter()
            .copied()
            .min_by(|a, b| distance(a, style, &want).total_cmp(&distance(b, style, &want)))?;
        let score = distance(best, style, &want);
        let mut faces = vec![best];
        faces.extend(in_family.iter().copied().filter(|f| {
            !std::ptr::eq(*f, best)
                && f.style == best.style
                && f.weights == best.weights
                && f.italic == best.italic
        }));
        Some((faces, score))
    };
    match pick(family) {
        Some((faces, score)) => {
            let status = if score == 0.0 {
                FontStatus::Available
            } else {
                FontStatus::StyleMissing
            };
            (faces, status)
        }
        None => {
            let (faces, _) = pick(DEFAULT_FAMILY).expect("Inter is bundled");
            (faces, FontStatus::Missing)
        }
    }
}

/// A registered face's font file, for engines that read glyphs or embed
/// fonts themselves (the Photoshop and Illustrator engines).
#[derive(Clone, Debug)]
pub struct FaceSource {
    /// The `sfnt` bytes (WOFF and WOFF2 files are stored decoded).
    pub data: &'static [u8],
    /// The face's index in a collection (0 otherwise).
    pub index: u32,
    pub family: String,
    pub style: String,
    pub postscript: Option<String>,
}

impl From<&FontFile> for FaceSource {
    fn from(f: &FontFile) -> Self {
        FaceSource {
            data: f.data,
            index: f.index,
            family: f.family.clone(),
            style: f.style.clone(),
            postscript: f.postscript.clone(),
        }
    }
}

/// The face that shows `family` in `style` (Inter when the family is not
/// registered) and how well it matches.
pub fn face_source(family: &str, style: &str) -> (FaceSource, FontStatus) {
    let (faces, status) = select(family, style);
    (FaceSource::from(faces[0]), status)
}

/// The family and style of the registered face with a PostScript name
/// ("Inter-SemiBold"), compared without case.
pub fn postscript_face(name: &str) -> Option<(String, String)> {
    registry()
        .lock()
        .expect("font registry")
        .iter()
        .find(|f| {
            f.postscript
                .as_deref()
                .is_some_and(|p| p.eq_ignore_ascii_case(name))
        })
        .map(|f| (f.family.clone(), f.style.clone()))
}

/// The family and style a PostScript font name ("MyriadPro-BoldIt")
/// stands for: the registered face with that name, else read from the name
/// ("Myriad Pro", "Bold Italic").
pub fn family_and_style(postscript: &str) -> (String, String) {
    if let Some(found) = postscript_face(postscript) {
        return found;
    }
    let name = postscript.trim();
    let (family, style) = match name.split_once('-') {
        Some((f, s)) => (f, s),
        None => (name, "Regular"),
    };
    let family = family
        .trim_end_matches("PSMT")
        .trim_end_matches("MT")
        .trim_end_matches("PS");
    let style = style.trim_end_matches("MT").trim_end_matches("PS");
    (spaced(family), style_words(style))
}

/// "MyriadPro" as "Myriad Pro" (a capital after a lowercase letter starts a
/// word).
fn spaced(s: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_lowercase() || c.is_ascii_digit();
        out.push(c);
    }
    out
}

/// A PostScript style suffix as style words ("BoldIt" is "Bold Italic").
fn style_words(s: &str) -> String {
    let words = spaced(s);
    let mut out: Vec<String> = Vec::new();
    for w in words.split_whitespace() {
        let w = match w {
            "It" | "Ital" | "Obl" => "Italic",
            "Bd" => "Bold",
            "Semibold" | "Smbd" => "SemiBold",
            "Lt" => "Light",
            "Md" | "Med" => "Medium",
            "Blk" => "Black",
            "Roman" | "Book" | "Regular" | "Reg" => "Regular",
            other => other,
        };
        out.push(w.to_string());
    }
    if out.is_empty() {
        "Regular".into()
    } else {
        out.join(" ")
    }
}

/// Whether text in `family` and `style` lays out in its own font.
pub fn font_status(family: &str, style: &str) -> FontStatus {
    select(family, style).1
}

/// One face set up for a style: its variable axes placed, its kerning
/// pairs found.
struct Face {
    font: FontRef<'static>,
    location: Location,
    upm: f32,
    /// Lookups of the GPOS `kern` feature, each a list of pair subtables.
    kern: Vec<Vec<PairPos<'static>>>,
    /// Identifies the face and its axis values in glyph caches.
    key: u64,
    /// The file the face comes from.
    source: FaceSource,
}

impl Face {
    fn new(file: &'static FontFile, want: &StyleRequest, slant: bool) -> Face {
        let font = file.font();
        let mut settings: Vec<(Tag, f32)> = Vec::new();
        if file.has_axis(WGHT) {
            settings.push((WGHT, want.weight));
        }
        if want.italic && file.has_axis(ITAL) {
            settings.push((ITAL, 1.0));
        } else if want.italic
            && !file.italic
            && let Some(a) = file.axes.iter().find(|a| a.0 == SLNT)
        {
            settings.push((SLNT, a.1));
        }
        if file.has_axis(WDTH) {
            settings.push((WDTH, want.width));
        }
        if let Some(opsz) = want.optical_size
            && file.has_axis(OPSZ)
        {
            settings.push((OPSZ, opsz));
        }
        let location = font.axes().location(settings.iter().copied());
        let upm = font.head().map_or(1000.0, |h| f32::from(h.units_per_em()));
        let mut key = file.hash ^ u64::from(file.index).wrapping_mul(0x9e37_79b9);
        for c in location.coords() {
            key = (key ^ c.to_bits() as u16 as u64).wrapping_mul(0x0100_0000_01b3);
        }
        key ^= u64::from(slant);
        Face {
            kern: kern_lookups(&font),
            font,
            location,
            upm,
            key,
            source: FaceSource::from(file),
        }
    }

    fn location(&self) -> LocationRef<'_> {
        LocationRef::from(&self.location)
    }
}

fn kern_lookups(font: &FontRef<'static>) -> Vec<Vec<PairPos<'static>>> {
    let Ok(gpos) = font.gpos() else {
        return Vec::new();
    };
    let (Ok(features), Ok(lookups)) = (gpos.feature_list(), gpos.lookup_list()) else {
        return Vec::new();
    };
    let lookups = lookups.lookups();
    let kern = Tag::new(b"kern");
    let Some(feature) = features
        .feature_records()
        .iter()
        .filter(|r| r.feature_tag() == kern)
        .find_map(|r| r.feature(features.offset_data()).ok())
    else {
        return Vec::new();
    };
    feature
        .lookup_list_indices()
        .iter()
        .filter_map(|index| {
            let lookup = lookups.get(usize::from(index.get())).ok()?;
            match lookup.subtables().ok()? {
                PositionSubtables::Pair(subtables) => Some(subtables.iter().flatten().collect()),
                _ => None,
            }
        })
        .collect()
}

/// The x-advance adjustment a pair subtable gives `l` then `r`.
fn pair_value(pair: &PairPos<'_>, l: GlyphId, r: GlyphId) -> Option<i16> {
    match pair {
        PairPos::Format1(t) => {
            let first = t.coverage().ok()?.get(l)?;
            let set = t.pair_sets().get(usize::from(first)).ok()?;
            let record = set
                .pair_value_records()
                .iter()
                .flatten()
                .find(|rec| u32::from(rec.second_glyph().to_u16()) == r.to_u32())?;
            record.value_record1().x_advance()
        }
        PairPos::Format2(t) => {
            t.coverage().ok()?.get(l)?;
            let c1 = t.class_def1().ok()?.get(l);
            let c2 = t.class_def2().ok()?.get(r);
            let row = t.class1_records().get(usize::from(c1)).ok()?;
            let cell = row.class2_records().get(usize::from(c2)).ok()?;
            cell.value_record1().x_advance()
        }
    }
}

/// A font set up for one family and style: its faces (the style's, then
/// Inter for characters they lack), glyph lookup with fallback, advances,
/// kerning, metrics, and outlines.
pub struct Font {
    faces: Vec<Face>,
    /// Faked italic: outlines are sheared when no face is italic.
    slant: f32,
}

/// A glyph in one of a [`Font`]'s faces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontGlyph {
    pub face: u8,
    pub id: GlyphId,
}

impl Font {
    pub fn new(family: &str, style: &str) -> Font {
        let (mut files, _) = select(family, style);
        let want = parse_style(style);
        if !files[0].family.eq_ignore_ascii_case(DEFAULT_FAMILY) {
            let (inter, _) = select(DEFAULT_FAMILY, style);
            files.extend(inter);
        }
        let primary = files[0];
        let slant =
            want.italic && !primary.italic && !primary.has_axis(ITAL) && !primary.has_axis(SLNT);
        Font {
            faces: files
                .into_iter()
                .map(|f| Face::new(f, &want, slant))
                .collect(),
            slant: if slant { SLANT } else { 0.0 },
        }
    }

    /// The glyph for `c`, from the first face that has one.
    pub fn glyph(&self, c: char) -> FontGlyph {
        for (k, face) in self.faces.iter().enumerate() {
            if let Some(id) = face.font.charmap().map(c).filter(|g| g.to_u32() != 0) {
                return FontGlyph { face: k as u8, id };
            }
        }
        FontGlyph {
            face: 0,
            id: GlyphId::NOTDEF,
        }
    }

    fn face(&self, g: FontGlyph) -> &Face {
        &self.faces[usize::from(g.face)]
    }

    /// Advance in em.
    pub fn advance(&self, g: FontGlyph) -> f32 {
        let face = self.face(g);
        face.font
            .glyph_metrics(Size::unscaled(), face.location())
            .advance_width(g.id)
            .unwrap_or(0.0)
            / face.upm
    }

    /// Kerning between two glyphs, in em (zero across faces).
    pub fn kerning(&self, a: FontGlyph, b: FontGlyph) -> f32 {
        if a.face != b.face {
            return 0.0;
        }
        let face = self.face(a);
        if !face.kern.is_empty() {
            let total: i32 = face
                .kern
                .iter()
                .filter_map(|lookup| lookup.iter().find_map(|p| pair_value(p, a.id, b.id)))
                .map(i32::from)
                .sum();
            return total as f32 / face.upm;
        }
        if let Ok(kern) = face.font.kern() {
            for st in kern.subtables().flatten() {
                if !st.is_horizontal() || st.is_variable() {
                    continue;
                }
                let value = match st.kind() {
                    Ok(SubtableKind::Format0(t)) => t.kerning(a.id, b.id),
                    Ok(SubtableKind::Format2(t)) => t.kerning(a.id, b.id),
                    Ok(SubtableKind::Format3(t)) => t.kerning(a.id, b.id),
                    _ => None,
                };
                if let Some(v) = value {
                    return v as f32 / face.upm;
                }
            }
        }
        0.0
    }

    /// The glyph's outline as a blob (em units, y up), stored once.
    pub fn outline(
        &self,
        doc: &mut Document,
        cache: &mut HashMap<(u64, u32), Option<u32>>,
        g: FontGlyph,
    ) -> Option<u32> {
        let key = (self.face(g).key, g.id.to_u32());
        if let Some(&blob) = cache.get(&key) {
            return blob;
        }
        let blob = self
            .path(g)
            .map(|path| doc.blobs.push(&geometry::encode_blob(&path)));
        cache.insert(key, blob);
        blob
    }

    /// The glyph's outline in em units, y up (synthesized italics sheared);
    /// `None` for glyphs that draw nothing.
    pub fn path(&self, g: FontGlyph) -> Option<tiny_skia::Path> {
        let face = self.face(g);
        let mut pen = Pen {
            pb: PathBuilder::new(),
            scale: 1.0 / face.upm,
            slant: self.slant,
        };
        face.font
            .outline_glyphs()
            .get(g.id)
            .and_then(|o| {
                o.draw(
                    DrawSettings::unhinted(Size::unscaled(), face.location()),
                    &mut pen,
                )
                .ok()
            })
            .and_then(|_| pen.pb.finish())
    }

    /// The font file and face index a glyph comes from, for embedding the
    /// font in an exported file.
    pub fn face_source(&self, g: FontGlyph) -> FaceSource {
        self.faces[usize::from(g.face)].source.clone()
    }

    /// Ascender, descender (negative), and line gap, in em.
    pub fn metrics(&self) -> (f32, f32, f32) {
        let face = &self.faces[0];
        let m = face.font.metrics(Size::unscaled(), face.location());
        (
            m.ascent / face.upm,
            m.descent / face.upm,
            m.leading / face.upm,
        )
    }

    /// Top and thickness of an underline or strikethrough, in em above the
    /// baseline.
    pub fn decoration(&self, strike: bool) -> (f32, f32) {
        let face = &self.faces[0];
        let m = face.font.metrics(Size::unscaled(), face.location());
        let d = if strike { m.strikeout } else { m.underline };
        match d {
            Some(d) if d.thickness > 0.0 || d.offset != 0.0 => {
                (d.offset / face.upm, d.thickness.max(1.0) / face.upm)
            }
            _ if strike => (0.3, 0.07),
            _ => (-0.1, 0.07),
        }
    }
}

struct Pen {
    pb: PathBuilder,
    scale: f32,
    slant: f32,
}

impl Pen {
    fn p(&self, x: f32, y: f32) -> (f32, f32) {
        let (x, y) = (x * self.scale, y * self.scale);
        (x + y * self.slant, y)
    }
}

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.p(x, y);
        self.pb.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let (x, y) = self.p(x, y);
        self.pb.line_to(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x1, y1) = self.p(x1, y1);
        let (x, y) = self.p(x, y);
        self.pb.quad_to(x1, y1, x, y);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x1, y1) = self.p(x1, y1);
        let (x2, y2) = self.p(x2, y2);
        let (x, y) = self.p(x, y);
        self.pb.cubic_to(x1, y1, x2, y2, x, y);
    }
    fn close(&mut self) {
        self.pb.close();
    }
}
