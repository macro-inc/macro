//! Laying out text the editor changed.
//!
//! Text in a `.fig` file comes with Figma's own glyph layout, which the
//! renderer draws as is. When an edit changes a text layer's characters or
//! size, the engine lays it out again here with a bundled font (Inter,
//! Figma's default, as a variable font) or one registered with
//! [`register_font`]: greedy word wrap, explicit line breaks, alignment,
//! line height, letter spacing, and pair kerning from the font's `kern`
//! feature. Glyph outlines are stored as blobs in em units, y up, exactly as
//! Figma stores them, so drawing and saving need nothing new.

use crate::document::{Document, NodeIdx};
use crate::error::Result;
use crate::geometry;
use crate::model::{Glyph, TextLayout, TextStyle, Vec2};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tiny_skia::PathBuilder;
use ttf_parser::{Face, GlyphId, Tag};

/// Inter, the family new text uses and the fallback for unknown families.
const INTER: &[u8] = include_bytes!("../fonts/InterVariable.ttf");
pub const DEFAULT_FAMILY: &str = "Inter";

struct FontFile {
    family: String,
    data: &'static [u8],
}

fn fonts() -> &'static Mutex<Vec<FontFile>> {
    static FONTS: OnceLock<Mutex<Vec<FontFile>>> = OnceLock::new();
    FONTS.get_or_init(|| {
        Mutex::new(vec![FontFile {
            family: DEFAULT_FAMILY.into(),
            data: INTER,
        }])
    })
}

/// Makes another font family available for layout (a TTF or OTF file).
/// Returns the family name it registered, if the file parses.
pub fn register_font(bytes: Vec<u8>) -> Option<String> {
    let data: &'static [u8] = Box::leak(bytes.into_boxed_slice());
    let face = Face::parse(data, 0).ok()?;
    let family = face
        .names()
        .into_iter()
        .filter(|n| {
            n.name_id == ttf_parser::name_id::TYPOGRAPHIC_FAMILY
                || n.name_id == ttf_parser::name_id::FAMILY
        })
        .find_map(|n| n.to_string())?;
    let mut list = fonts().lock().ok()?;
    list.push(FontFile {
        family: family.clone(),
        data,
    });
    Some(family)
}

fn font_data(family: &str) -> (&'static [u8], bool) {
    let list = fonts().lock().expect("font list");
    match list
        .iter()
        .rev()
        .find(|f| f.family.eq_ignore_ascii_case(family))
    {
        Some(f) => (f.data, true),
        None => (INTER, false),
    }
}

/// CSS-style weight for a Figma style name ("Semi Bold", "Bold Italic").
pub fn weight_of(style: &str) -> f32 {
    let s = style.to_ascii_lowercase().replace([' ', '-'], "");
    let table: [(&str, f32); 9] = [
        ("extralight", 200.0),
        ("ultralight", 200.0),
        ("thin", 100.0),
        ("light", 300.0),
        ("semibold", 600.0),
        ("demibold", 600.0),
        ("extrabold", 800.0),
        ("ultrabold", 800.0),
        ("black", 900.0),
    ];
    for (name, w) in table {
        if s.contains(name) {
            return w;
        }
    }
    if s.contains("bold") {
        700.0
    } else if s.contains("medium") {
        500.0
    } else if s.contains("heavy") {
        900.0
    } else {
        400.0
    }
}

/// A font at one weight, with glyph outlines cached as document blobs.
struct Font<'a> {
    face: Face<'static>,
    upm: f32,
    kern: Vec<ttf_parser::gpos::PairAdjustment<'static>>,
    key: (usize, u32),
    cache: &'a mut HashMap<(usize, u32, u16), Option<u32>>,
}

impl<'a> Font<'a> {
    fn new(
        family: &str,
        style: &str,
        cache: &'a mut HashMap<(usize, u32, u16), Option<u32>>,
    ) -> Option<Font<'a>> {
        let (data, _) = font_data(family);
        let mut face = Face::parse(data, 0).ok()?;
        let weight = weight_of(style);
        let _ = face.set_variation(Tag::from_bytes(b"wght"), weight);
        let kern = kerning(&face);
        Some(Font {
            upm: f32::from(face.units_per_em()),
            face,
            kern,
            key: (data.as_ptr() as usize, weight as u32),
            cache,
        })
    }

    fn glyph(&self, c: char) -> GlyphId {
        self.face.glyph_index(c).unwrap_or(GlyphId(0))
    }

    /// Advance in em.
    fn advance(&self, g: GlyphId) -> f32 {
        f32::from(self.face.glyph_hor_advance(g).unwrap_or(0)) / self.upm
    }

    /// Kerning between two glyphs, in em.
    fn kerning(&self, a: GlyphId, b: GlyphId) -> f32 {
        use ttf_parser::gpos::PairAdjustment;
        for pair in &self.kern {
            let found = match pair {
                PairAdjustment::Format1 { coverage, sets } => coverage
                    .get(a)
                    .and_then(|i| sets.get(i))
                    .and_then(|set| set.get(b))
                    .map(|(v, _)| v.x_advance),
                PairAdjustment::Format2 {
                    coverage,
                    classes,
                    matrix,
                } => coverage
                    .contains(a)
                    .then(|| matrix.get((classes.0.get(a), classes.1.get(b))))
                    .flatten()
                    .map(|(v, _)| v.x_advance),
            };
            if let Some(dx) = found {
                return f32::from(dx) / self.upm;
            }
        }
        0.0
    }

    /// The glyph's outline as a blob (em units, y up), stored once.
    fn outline(&mut self, doc: &mut Document, g: GlyphId) -> Option<u32> {
        let key = (self.key.0, self.key.1, g.0);
        if let Some(&blob) = self.cache.get(&key) {
            return blob;
        }
        let mut b = Outline {
            pb: PathBuilder::new(),
            scale: 1.0 / self.upm,
        };
        let blob = self
            .face
            .outline_glyph(g, &mut b)
            .and_then(|_| b.pb.finish())
            .map(|path| doc.blobs.push(&geometry::encode_blob(&path)));
        self.cache.insert(key, blob);
        blob
    }

    fn metrics(&self) -> (f32, f32, f32) {
        (
            f32::from(self.face.ascender()) / self.upm,
            f32::from(self.face.descender()) / self.upm,
            f32::from(self.face.line_gap()) / self.upm,
        )
    }
}

fn kerning(face: &Face<'static>) -> Vec<ttf_parser::gpos::PairAdjustment<'static>> {
    use ttf_parser::gpos::PositioningSubtable;
    let Some(gpos) = face.tables().gpos else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for feature in gpos.features {
        if feature.tag != Tag::from_bytes(b"kern") {
            continue;
        }
        for index in feature.lookup_indices {
            let Some(lookup) = gpos.lookups.get(index) else {
                continue;
            };
            for k in 0..lookup.subtables.len() {
                if let Some(PositioningSubtable::Pair(p)) =
                    lookup.subtables.get::<PositioningSubtable>(k)
                {
                    out.push(p);
                }
            }
        }
        break;
    }
    out
}

struct Outline {
    pb: PathBuilder,
    scale: f32,
}

impl ttf_parser::OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        self.pb.move_to(x * self.scale, y * self.scale);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.pb.line_to(x * self.scale, y * self.scale);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let s = self.scale;
        self.pb.quad_to(x1 * s, y1 * s, x * s, y * s);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let s = self.scale;
        self.pb
            .cubic_to(x1 * s, y1 * s, x2 * s, y2 * s, x * s, y * s);
    }
    fn close(&mut self) {
        self.pb.close();
    }
}

/// How the box follows the text (Figma's `textAutoResize`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum AutoResize {
    /// Width and height fit the text; lines break only at newlines.
    WidthAndHeight,
    /// Fixed width; height fits the wrapped lines.
    Height,
    /// Fixed box.
    None,
}

struct Placed {
    ch_index: u32,
    glyph: GlyphId,
    x: f32,
    advance: f32,
    space: bool,
}

/// Re-lays out text layer `i` after its characters or font size changed.
/// The node's base style (family, style, size, line height, letter spacing,
/// alignment) is kept; per-character styles are dropped when the
/// characters change.
pub fn edit(
    doc: &mut Document,
    i: NodeIdx,
    characters: Option<&str>,
    font_size: Option<f32>,
) -> Result<()> {
    let props = doc.props(i).clone();
    let mut style = props.text_style.as_deref().cloned().unwrap_or_default();
    if let Some(fs) = font_size {
        style.font_size = Some(fs.max(1.0));
    }
    if style.font_family.is_none() {
        style.font_family = Some(DEFAULT_FAMILY.into());
        style.font_style = Some("Regular".into());
    }
    let mut content = props.text_content.as_deref().cloned().unwrap_or_default();
    if let Some(chars) = characters {
        content.characters = chars.into();
        content.style_ids = Arc::from([] as [u32; 0]);
    }
    let auto = match style.auto_resize.as_deref() {
        Some("HEIGHT") => AutoResize::Height,
        Some("NONE") | Some("TRUNCATE") => AutoResize::None,
        Some("WIDTH_AND_HEIGHT") => AutoResize::WidthAndHeight,
        // New text grows in both directions until given a width.
        _ if props.text_layout.is_none() => AutoResize::WidthAndHeight,
        _ => AutoResize::None,
    };
    if style.auto_resize.is_none() && auto == AutoResize::WidthAndHeight {
        style.auto_resize = Some("WIDTH_AND_HEIGHT".into());
    }
    let size = props.size();
    let (layout, box_size) = layout(doc, &content.characters, &style, size, auto);
    let node = &mut doc.nodes[i as usize];
    node.props.text_content = Some(Arc::new(content));
    node.props.text_style = Some(Arc::new(style));
    node.props.text_layout = Some(Arc::new(layout));
    node.props.size = Some(box_size);
    Ok(())
}

fn layout(
    doc: &mut Document,
    text: &str,
    style: &TextStyle,
    size: Vec2,
    auto: AutoResize,
) -> (TextLayout, Vec2) {
    let family = style.font_family.as_deref().unwrap_or(DEFAULT_FAMILY);
    let font_style = style.font_style.as_deref().unwrap_or("Regular");
    let fs = style.font_size.unwrap_or(12.0);
    let mut cache = std::mem::take(&mut doc.glyph_cache);
    let Some(mut font) = Font::new(family, font_style, &mut cache) else {
        doc.glyph_cache = cache;
        return (TextLayout::default(), size);
    };
    let (asc, desc, gap) = font.metrics();
    let line_height = match &style.line_height {
        Some((v, unit)) if unit == "PIXELS" => *v,
        Some((v, unit)) if unit == "PERCENT" => v / 100.0 * fs,
        Some((v, unit)) if unit == "RAW" && *v > 0.0 => v * fs,
        _ => (asc - desc + gap) * fs,
    };
    let spacing = match &style.letter_spacing {
        Some((v, unit)) if unit == "PERCENT" => v / 100.0 * fs,
        Some((v, _)) => *v,
        None => 0.0,
    };
    let wrap_width = match auto {
        AutoResize::WidthAndHeight => f32::INFINITY,
        _ => size.x as f32,
    };

    // Shape each paragraph into lines of placed glyphs.
    let mut lines: Vec<(Vec<Placed>, f32)> = Vec::new();
    let mut utf16 = 0u32;
    for (p, paragraph) in text.split('\n').enumerate() {
        if p > 0 {
            utf16 += 1;
        }
        let mut line: Vec<Placed> = Vec::new();
        let mut x = 0.0f32;
        let mut prev: Option<GlyphId> = None;
        // The glyph index where the current word starts in `line`.
        let mut word_start = 0usize;
        for ch in paragraph.chars() {
            let g = font.glyph(ch);
            if let Some(pg) = prev {
                x += font.kerning(pg, g) * fs;
            }
            let advance = font.advance(g) * fs;
            if ch == ' ' {
                word_start = line.len() + 1;
            }
            line.push(Placed {
                ch_index: utf16,
                glyph: g,
                x,
                advance,
                space: ch.is_whitespace(),
            });
            x += advance + spacing;
            utf16 += ch.len_utf16() as u32;
            prev = Some(g);
            if x - spacing > wrap_width && ch != ' ' && line.len() > 1 {
                // Break before the current word, or mid-word if it is the
                // only word on the line.
                let cut = if word_start > 0 && word_start < line.len() {
                    word_start
                } else {
                    line.len() - 1
                };
                let rest: Vec<Placed> = line.split_off(cut);
                let width = line_width(&line);
                lines.push((line, width));
                let shift = rest.first().map_or(0.0, |r| r.x);
                line = rest
                    .into_iter()
                    .map(|mut r| {
                        r.x -= shift;
                        r
                    })
                    .collect();
                x = line.last().map_or(0.0, |l| l.x + l.advance + spacing);
                word_start = 0;
            }
        }
        let width = line_width(&line);
        lines.push((line, width));
    }

    let content_w = lines.iter().map(|(_, w)| *w).fold(0.0f32, f32::max);
    let content_h = line_height * lines.len().max(1) as f32;
    let box_size = match auto {
        AutoResize::WidthAndHeight => {
            Vec2::new(f64::from(content_w.ceil().max(1.0)), f64::from(content_h))
        }
        AutoResize::Height => Vec2::new(size.x, f64::from(content_h)),
        AutoResize::None => size,
    };
    let top = match (auto, style.align_vertical.as_deref()) {
        (AutoResize::None, Some("CENTER")) => (box_size.y as f32 - content_h) / 2.0,
        (AutoResize::None, Some("BOTTOM")) => box_size.y as f32 - content_h,
        _ => 0.0,
    };
    // The glyph box is centred in each line's height.
    let baseline0 = top + (line_height - (asc - desc) * fs) / 2.0 + asc * fs;
    let mut glyphs = Vec::new();
    for (k, (line, width)) in lines.iter().enumerate() {
        let dx = match style.align_horizontal.as_deref() {
            Some("CENTER") => (box_size.x as f32 - width) / 2.0,
            Some("RIGHT") => box_size.x as f32 - width,
            _ => 0.0,
        };
        let y = baseline0 + k as f32 * line_height;
        for p in line {
            let blob = font.outline(doc, p.glyph);
            glyphs.push(Glyph {
                blob,
                x: p.x + dx,
                y,
                font_size: fs,
                style_id: 0,
                first_char: p.ch_index,
                advance: p.advance,
                rotation: 0.0,
                emoji: None,
            });
        }
    }
    drop(font);
    doc.glyph_cache = cache;
    (
        TextLayout {
            glyphs: glyphs.into(),
            decorations: Arc::from([]),
            layout_size: Some(box_size),
            lines: lines.len() as u32,
        },
        box_size,
    )
}

/// Width of a line without its trailing spaces.
fn line_width(line: &[Placed]) -> f32 {
    line.iter()
        .rev()
        .find(|p| !p.space)
        .map_or(0.0, |p| p.x + p.advance)
}

#[cfg(test)]
mod test;
