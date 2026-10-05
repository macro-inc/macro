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
use crate::model::{Decoration, Glyph, Props, StyleRun, TextContent, TextLayout, TextStyle, Vec2};
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

/// A font at one weight (and slant), with glyph outlines cached as
/// document blobs.
struct Font {
    face: Face<'static>,
    upm: f32,
    kern: Vec<ttf_parser::gpos::PairAdjustment<'static>>,
    /// Faked italic: outlines are sheared when the family has no italic.
    slant: f32,
    key: (usize, u32),
}

/// Shear of synthesized italics (about 10°).
const SLANT: f32 = 0.18;

impl Font {
    fn new(family: &str, style: &str) -> Option<Font> {
        let (data, _) = font_data(family);
        let mut face = Face::parse(data, 0).ok()?;
        let weight = weight_of(style);
        let _ = face.set_variation(Tag::from_bytes(b"wght"), weight);
        let italic = style.to_ascii_lowercase().contains("italic")
            || style.to_ascii_lowercase().contains("oblique");
        let slant = if italic && !face.is_italic() {
            SLANT
        } else {
            0.0
        };
        let kern = kerning(&face);
        Some(Font {
            upm: f32::from(face.units_per_em()),
            face,
            kern,
            slant,
            key: (
                data.as_ptr() as usize,
                weight as u32 * 2 + u32::from(slant > 0.0),
            ),
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
    fn outline(
        &self,
        doc: &mut Document,
        cache: &mut HashMap<(usize, u32, u16), Option<u32>>,
        g: GlyphId,
    ) -> Option<u32> {
        let key = (self.key.0, self.key.1, g.0);
        if let Some(&blob) = cache.get(&key) {
            return blob;
        }
        let mut b = Outline {
            pb: PathBuilder::new(),
            scale: 1.0 / self.upm,
            slant: self.slant,
        };
        let blob = self
            .face
            .outline_glyph(g, &mut b)
            .and_then(|_| b.pb.finish())
            .map(|path| doc.blobs.push(&geometry::encode_blob(&path)));
        cache.insert(key, blob);
        blob
    }

    /// Ascender, descender (negative), and line gap, in em.
    fn metrics(&self) -> (f32, f32, f32) {
        (
            f32::from(self.face.ascender()) / self.upm,
            f32::from(self.face.descender()) / self.upm,
            f32::from(self.face.line_gap()) / self.upm,
        )
    }

    /// Top and thickness of an underline or strikethrough, in em above the
    /// baseline.
    fn decoration(&self, strike: bool) -> (f32, f32) {
        let m = if strike {
            self.face.strikeout_metrics()
        } else {
            self.face.underline_metrics()
        };
        match m {
            Some(m) => (
                f32::from(m.position) / self.upm,
                f32::from(m.thickness.max(1)) / self.upm,
            ),
            None if strike => (0.3, 0.07),
            None => (-0.1, 0.07),
        }
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
    slant: f32,
}

impl Outline {
    fn p(&self, x: f32, y: f32) -> (f32, f32) {
        let (x, y) = (x * self.scale, y * self.scale);
        (x + y * self.slant, y)
    }
}

impl ttf_parser::OutlineBuilder for Outline {
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

/// Whether text in `family` can be laid out with that family's own font
/// (otherwise Inter stands in).
pub fn has_font(family: &str) -> bool {
    font_data(family).1
}

/// A text change: any of the characters and the node-wide style. Style
/// fields apply to every character, as in Figma's design panel, so they
/// replace per-character overrides of the same property.
#[derive(Clone, Debug, Default)]
pub struct Change<'a> {
    pub characters: Option<&'a str>,
    pub font_family: Option<&'a str>,
    pub font_style: Option<&'a str>,
    pub font_size: Option<f32>,
    /// `(value, "PIXELS" | "PERCENT" | "RAW")`, as stored in files.
    pub line_height: Option<(f32, &'a str)>,
    pub letter_spacing: Option<(f32, &'a str)>,
    pub paragraph_spacing: Option<f32>,
    pub align_horizontal: Option<&'a str>,
    pub align_vertical: Option<&'a str>,
    pub auto_resize: Option<&'a str>,
    pub decoration: Option<&'a str>,
    pub case: Option<&'a str>,
}

/// Re-lays out text layer `i` after a [`Change`]. Per-character styles
/// follow the characters they were on: typed characters take the style of
/// the character before them, as in Figma.
pub fn edit(doc: &mut Document, i: NodeIdx, change: &Change) -> Result<()> {
    let mut props = doc.props(i).clone();
    edit_props(doc, &mut props, change)?;
    let node = &mut doc.nodes[i as usize];
    node.props.text_content = props.text_content;
    node.props.text_style = props.text_style;
    node.props.text_layout = props.text_layout;
    node.props.size = props.size;
    Ok(())
}

/// [`edit`] on a node's properties (a text layer in an instance, say);
/// sets its text fields and size. Glyph outlines go in `doc`'s blobs.
pub fn edit_props(doc: &mut Document, props: &mut Props, change: &Change) -> Result<()> {
    let mut style = props.text_style.as_deref().cloned().unwrap_or_default();
    let mut content = props.text_content.as_deref().cloned().unwrap_or_default();
    let mut runs: Vec<StyleRun> = content.styles.to_vec();
    if let Some(fs) = change.font_size {
        style.font_size = Some(fs.max(1.0));
        runs.iter_mut().for_each(|r| r.font_size = None);
    }
    if style.font_family.is_none() {
        style.font_family = Some(DEFAULT_FAMILY.into());
        style.font_style = Some("Regular".into());
    }
    if let Some(f) = change.font_family {
        style.font_family = Some(f.into());
        runs.iter_mut().for_each(|r| r.font_family = None);
    }
    if let Some(s) = change.font_style {
        style.font_style = Some(s.into());
        runs.iter_mut().for_each(|r| r.font_style = None);
    }
    if change.font_family.is_some() || change.font_style.is_some() {
        // A run's style name is meaningless in another family, and vice versa.
        for r in &mut runs {
            if r.font_family.is_none() || r.font_style.is_none() {
                r.font_family = None;
                r.font_style = None;
            }
        }
    }
    if let Some(d) = change.decoration {
        style.decoration = (d != "NONE").then(|| d.into());
        runs.iter_mut().for_each(|r| r.decoration = None);
    }
    let set = |slot: &mut Option<String>, v: Option<&str>| {
        if let Some(v) = v {
            *slot = Some(v.into());
        }
    };
    set(&mut style.align_horizontal, change.align_horizontal);
    set(&mut style.align_vertical, change.align_vertical);
    set(&mut style.auto_resize, change.auto_resize);
    if let Some(c) = change.case {
        style.case = (c != "ORIGINAL").then(|| c.into());
    }
    if let Some((v, u)) = change.line_height {
        style.line_height = Some((v, u.into()));
    }
    if let Some((v, u)) = change.letter_spacing {
        style.letter_spacing = Some((v, u.into()));
    }
    if let Some(p) = change.paragraph_spacing {
        style.paragraph_spacing = Some(p.max(0.0));
    }
    if let Some(chars) = change.characters {
        content.style_ids = remap_styles(&content.characters, &content.style_ids, chars).into();
        content.characters = chars.into();
    }
    content.styles = runs.into();
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
    let (layout, box_size) = layout(doc, &content, &style, size, auto);
    props.text_content = Some(Arc::new(content));
    props.text_style = Some(Arc::new(style));
    props.text_layout = Some(Arc::new(layout));
    props.size = Some(box_size);
    Ok(())
}

/// Style ids for `new` given `old` text and its ids (UTF-16 units): the
/// unchanged start and end keep theirs; what was typed between takes the
/// style before it.
fn remap_styles(old: &str, ids: &[u32], new: &str) -> Vec<u32> {
    if ids.is_empty() {
        return Vec::new();
    }
    let a: Vec<u16> = old.encode_utf16().collect();
    let b: Vec<u16> = new.encode_utf16().collect();
    let id = |k: usize| ids.get(k).copied().unwrap_or(0);
    let prefix = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let max_suffix = a.len().min(b.len()) - prefix;
    let suffix = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take(max_suffix)
        .take_while(|(x, y)| x == y)
        .count();
    let typed = if prefix > 0 { id(prefix - 1) } else { id(0) };
    let mut out: Vec<u32> = (0..prefix).map(id).collect();
    out.extend(std::iter::repeat_n(typed, b.len() - prefix - suffix));
    out.extend((a.len() - suffix..a.len()).map(id));
    while out.last() == Some(&0) {
        out.pop();
    }
    out
}

/// The style a character is laid out in.
#[derive(Clone, PartialEq)]
struct CharStyle {
    font: usize,
    size: f32,
    decoration: Option<bool>,
    id: u32,
}

struct Placed {
    ch_index: u32,
    glyph: GlyphId,
    x: f32,
    advance: f32,
    space: bool,
    style: usize,
}

struct Line {
    glyphs: Vec<Placed>,
    width: f32,
    /// The style of the line's first character (or of the line break).
    style: usize,
    /// Ends where the text wrapped rather than at a line break.
    wrapped: bool,
    /// Starts a paragraph.
    first: bool,
}

fn layout(
    doc: &mut Document,
    content: &TextContent,
    style: &TextStyle,
    size: Vec2,
    auto: AutoResize,
) -> (TextLayout, Vec2) {
    let base_family = style.font_family.as_deref().unwrap_or(DEFAULT_FAMILY);
    let base_style = style.font_style.as_deref().unwrap_or("Regular");
    let base_size = style.font_size.unwrap_or(12.0);
    let base_deco = decoration_kind(style.decoration.as_deref());
    let mut cache = std::mem::take(&mut doc.glyph_cache);

    // Fonts and character styles in use, by index.
    let mut fonts: Vec<((String, String), Font)> = Vec::new();
    let mut styles: Vec<CharStyle> = Vec::new();
    let mut by_id: HashMap<u32, usize> = HashMap::new();
    let mut style_index = |id: u32, fonts: &mut Vec<((String, String), Font)>| -> Option<usize> {
        let run = (id != 0)
            .then(|| content.styles.iter().find(|r| r.id == id))
            .flatten();
        let family = run
            .and_then(|r| r.font_family.as_deref())
            .unwrap_or(base_family)
            .to_string();
        let font_style = run
            .and_then(|r| r.font_style.as_deref())
            .unwrap_or(base_style)
            .to_string();
        let key = (family, font_style);
        let font = match fonts.iter().position(|(k, _)| *k == key) {
            Some(f) => f,
            None => {
                let f = Font::new(&key.0, &key.1)?;
                fonts.push((key, f));
                fonts.len() - 1
            }
        };
        let s = CharStyle {
            font,
            size: run.and_then(|r| r.font_size).unwrap_or(base_size),
            decoration: run
                .and_then(|r| r.decoration.as_deref())
                .map_or(base_deco, |d| decoration_kind(Some(d))),
            id,
        };
        let k = styles.iter().position(|x| *x == s).unwrap_or_else(|| {
            styles.push(s);
            styles.len() - 1
        });
        Some(k)
    };
    let Some(base) = style_index(0, &mut fonts) else {
        doc.glyph_cache = cache;
        return (TextLayout::default(), size);
    };
    by_id.insert(0, base);
    for &id in content.style_ids.iter() {
        if let std::collections::hash_map::Entry::Vacant(e) = by_id.entry(id) {
            e.insert(style_index(id, &mut fonts).unwrap_or(base));
        }
    }
    let spacing_of = |fs: f32| match &style.letter_spacing {
        Some((v, unit)) if unit == "PERCENT" => v / 100.0 * fs,
        Some((v, _)) => *v,
        None => 0.0,
    };
    let wrap_width = match auto {
        AutoResize::WidthAndHeight => f32::INFINITY,
        _ => size.x as f32,
    };
    let text = cased(&content.characters, style.case.as_deref());

    // Shape each paragraph into lines of placed glyphs.
    let mut lines: Vec<Line> = Vec::new();
    let mut line = Line {
        glyphs: Vec::new(),
        width: 0.0,
        style: base,
        wrapped: false,
        first: true,
    };
    let mut x = 0.0f32;
    let mut prev: Option<(GlyphId, usize)> = None;
    // The glyph index where the current word starts in `line`.
    let mut word_start = 0usize;
    for (ch, unit) in text {
        let id = content.style_ids.get(unit as usize).copied().unwrap_or(0);
        let s = by_id.get(&id).copied().unwrap_or(base);
        if line.glyphs.is_empty() {
            line.style = s;
        }
        if ch == '\n' {
            line.width = line_width(&line.glyphs);
            let next_style = s;
            lines.push(std::mem::replace(
                &mut line,
                Line {
                    glyphs: Vec::new(),
                    width: 0.0,
                    style: next_style,
                    wrapped: false,
                    first: true,
                },
            ));
            x = 0.0;
            prev = None;
            word_start = 0;
            continue;
        }
        let cs = &styles[s];
        let font = &fonts[cs.font].1;
        let fs = cs.size;
        let g = font.glyph(ch);
        if let Some((pg, ps)) = prev
            && styles[ps].font == cs.font
            && styles[ps].size == fs
        {
            x += font.kerning(pg, g) * fs;
        }
        let advance = font.advance(g) * fs;
        let spacing = spacing_of(fs);
        if ch == ' ' {
            word_start = line.glyphs.len() + 1;
        }
        line.glyphs.push(Placed {
            ch_index: unit,
            glyph: g,
            x,
            advance,
            space: ch.is_whitespace(),
            style: s,
        });
        x += advance + spacing;
        prev = Some((g, s));
        if x - spacing > wrap_width && ch != ' ' && line.glyphs.len() > 1 {
            // Break before the current word, or mid-word if it is the only
            // word on the line.
            let cut = if word_start > 0 && word_start < line.glyphs.len() {
                word_start
            } else {
                line.glyphs.len() - 1
            };
            let rest: Vec<Placed> = line.glyphs.split_off(cut);
            line.width = line_width(&line.glyphs);
            line.wrapped = true;
            let shift = rest.first().map_or(0.0, |r| r.x);
            let rest: Vec<Placed> = rest
                .into_iter()
                .map(|mut r| {
                    r.x -= shift;
                    r
                })
                .collect();
            let style = rest.first().map_or(s, |r| r.style);
            lines.push(std::mem::replace(
                &mut line,
                Line {
                    glyphs: rest,
                    width: 0.0,
                    style,
                    wrapped: false,
                    first: false,
                },
            ));
            x = line
                .glyphs
                .last()
                .map_or(0.0, |l| l.x + l.advance + spacing_of(styles[l.style].size));
            word_start = 0;
        }
    }
    line.width = line_width(&line.glyphs);
    lines.push(line);

    // Vertical metrics per line: the largest character sets them.
    struct Metrics {
        height: f32,
        ascent: f32,
        descent: f32,
    }
    let metrics: Vec<Metrics> = lines
        .iter()
        .map(|l| {
            let mut used: Vec<usize> = l.glyphs.iter().map(|p| p.style).collect();
            if used.is_empty() {
                used.push(l.style);
            }
            let (mut asc, mut desc, mut natural, mut fs) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            for s in used {
                let cs = &styles[s];
                let (a, d, g) = fonts[cs.font].1.metrics();
                asc = asc.max(a * cs.size);
                desc = desc.max(-d * cs.size);
                natural = natural.max((a - d + g) * cs.size);
                fs = fs.max(cs.size);
            }
            let height = match &style.line_height {
                Some((v, unit)) if unit == "PIXELS" => *v,
                // Percent of the font's own line height ("Auto" is 100%).
                Some((v, unit)) if unit == "PERCENT" => v / 100.0 * natural,
                // A multiple of the font size (what the panel shows as %).
                Some((v, unit)) if unit == "RAW" && *v > 0.0 => v * fs,
                _ => natural,
            };
            Metrics {
                height,
                ascent: asc,
                descent: desc,
            }
        })
        .collect();
    let paragraph_gap = style.paragraph_spacing.unwrap_or(0.0);
    let content_w = lines.iter().map(|l| l.width).fold(0.0f32, f32::max);
    let content_h: f32 = metrics.iter().map(|m| m.height).sum::<f32>()
        + paragraph_gap * lines.iter().skip(1).filter(|l| l.first).count() as f32;
    let box_size = match auto {
        AutoResize::WidthAndHeight => {
            Vec2::new(f64::from(content_w.ceil().max(1.0)), f64::from(content_h))
        }
        AutoResize::Height => Vec2::new(size.x, f64::from(content_h)),
        AutoResize::None => size,
    };
    let mut top = match (auto, style.align_vertical.as_deref()) {
        (AutoResize::None, Some("CENTER")) => (box_size.y as f32 - content_h) / 2.0,
        (AutoResize::None, Some("BOTTOM")) => box_size.y as f32 - content_h,
        _ => 0.0,
    };
    let justify = style.align_horizontal.as_deref() == Some("JUSTIFIED");
    let mut glyphs = Vec::new();
    let mut decorations: Vec<Decoration> = Vec::new();
    for (k, (line, m)) in lines.iter().zip(&metrics).enumerate() {
        if k > 0 && line.first {
            top += paragraph_gap;
        }
        // The glyph box is centred in the line's height.
        let y = top + (m.height - (m.ascent + m.descent)) / 2.0 + m.ascent;
        top += m.height;
        let free = box_size.x as f32 - line.width;
        let dx = match style.align_horizontal.as_deref() {
            Some("CENTER") => free / 2.0,
            Some("RIGHT") => free,
            _ => 0.0,
        };
        // Justified lines spread the free space over their inner spaces.
        let inked = line
            .glyphs
            .iter()
            .rposition(|p| !p.space)
            .map_or(0, |e| e + 1);
        let gaps = line.glyphs[..inked].iter().filter(|p| p.space).count();
        let stretch = if justify && line.wrapped && gaps > 0 && free > 0.0 {
            free / gaps as f32
        } else {
            0.0
        };
        let mut extra = 0.0;
        let mut deco: Option<(usize, f32, f32)> = None;
        let flush = |deco: &mut Option<(usize, f32, f32)>, decorations: &mut Vec<Decoration>| {
            let Some((s, x0, x1)) = deco.take() else {
                return;
            };
            let cs = &styles[s];
            let Some(strike) = cs.decoration else { return };
            let (pos, thick) = fonts[cs.font].1.decoration(strike);
            let rect = [x0, y - pos * cs.size, x1 - x0, thick * cs.size];
            match decorations.last_mut() {
                Some(d) if d.style_id == cs.id => {
                    let mut rects = d.rects.to_vec();
                    rects.push(rect);
                    d.rects = rects.into();
                }
                _ => decorations.push(Decoration {
                    rects: Arc::from([rect]),
                    style_id: cs.id,
                }),
            }
        };
        for (n, p) in line.glyphs.iter().enumerate() {
            let cs = &styles[p.style];
            let font = &fonts[cs.font].1;
            let gx = p.x + dx + extra;
            if p.space && n < inked {
                extra += stretch;
            }
            glyphs.push(Glyph {
                blob: font.outline(doc, &mut cache, p.glyph),
                x: gx,
                y,
                font_size: cs.size,
                style_id: cs.id,
                first_char: p.ch_index,
                advance: p.advance,
                rotation: 0.0,
                emoji: None,
            });
            if n < inked && cs.decoration.is_some() {
                match &mut deco {
                    Some((s, _, x1)) if *s == p.style => *x1 = gx + p.advance,
                    _ => {
                        flush(&mut deco, &mut decorations);
                        deco = Some((p.style, gx, gx + p.advance));
                    }
                }
            } else {
                flush(&mut deco, &mut decorations);
            }
        }
        flush(&mut deco, &mut decorations);
    }
    drop(fonts);
    doc.glyph_cache = cache;
    (
        TextLayout {
            glyphs: glyphs.into(),
            decorations: decorations.into(),
            layout_size: Some(box_size),
            lines: lines.len() as u32,
            ..TextLayout::default()
        },
        box_size,
    )
}

/// `Some(true)` for strikethrough, `Some(false)` for underline.
fn decoration_kind(d: Option<&str>) -> Option<bool> {
    match d {
        Some("UNDERLINE") => Some(false),
        Some("STRIKETHROUGH") => Some(true),
        _ => None,
    }
}

/// The characters as displayed (Figma's text case), each with the UTF-16
/// index of the character it came from.
fn cased(text: &str, case: Option<&str>) -> Vec<(char, u32)> {
    let mut out = Vec::with_capacity(text.len());
    let mut unit = 0u32;
    let mut word_start = true;
    for ch in text.chars() {
        match case {
            Some("UPPER") => out.extend(ch.to_uppercase().map(|c| (c, unit))),
            Some("LOWER") => out.extend(ch.to_lowercase().map(|c| (c, unit))),
            Some("TITLE") if word_start => out.extend(ch.to_uppercase().map(|c| (c, unit))),
            _ => out.push((ch, unit)),
        }
        word_start = ch.is_whitespace();
        unit += ch.len_utf16() as u32;
    }
    out
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
