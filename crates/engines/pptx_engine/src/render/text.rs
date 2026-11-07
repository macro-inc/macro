//! Text layout: shaping, line breaking, alignment, bullets, and spacing.
//!
//! Layout happens in the coordinate space of the shape's text rectangle (points,
//! origin at its top-left). Vertical text is laid out in a rotated virtual box and
//! mapped back through [`TextLayout::transform`]: lines run along the box's
//! height and stack across its width. Insets stay on the sides of the shape
//! they name, as in PowerPoint; the anchor follows the text ("top" is where
//! the first line goes). Upright glyphs in vertical text (CJK in East Asian
//! vertical text, every letter of stacked text) are turned back a quarter
//! turn about their own center (see [`PlacedGlyph::upright`]).

use crate::font::{FaceId, FontChoice, FontDb, SymbolFont, remap_symbol};
use crate::model::color::Rgba;
use crate::model::fill::{Effects, Fill, LineProps};
use crate::model::text::{
    Align, Anchor, Autofit, BulletKind, Caps, ParaProps, Paragraph, RunKind, RunProps, Spacing,
    Strike, TabAlign, TextBody, Underline, Vert,
};
use crate::path::{Affine, Rect};
use serde::Serialize;

mod bullet;
mod math;

pub use math::{EquationBox, TextPath};

pub use bullet::autonum_text;
use bullet::{BulletInfo, make_bullet};

/// One positioned glyph (baseline origin, layout coordinates).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlacedGlyph {
    /// Glyph id in the run's face.
    pub id: u16,
    /// Pen x.
    pub x: f32,
    /// Baseline y.
    pub y: f32,
    /// Drawn a quarter turn counter-clockwise about its origin `(x, y)`, so
    /// it stands upright in a layout rotated 90° clockwise (vertical text).
    pub upright: bool,
}

/// Glyphs sharing a face, size, and paint.
#[derive(Clone, Debug)]
pub struct GlyphRun {
    /// Face.
    pub face: FaceId,
    /// Size in points.
    pub size: f32,
    /// Glyphs.
    pub glyphs: Vec<PlacedGlyph>,
    /// Text fill.
    pub fill: Fill,
    /// Text outline.
    pub outline: Option<LineProps>,
    /// Embolden synthetically.
    pub synthetic_bold: bool,
    /// Slant synthetically.
    pub synthetic_italic: bool,
    /// Text effects (shadow, glow).
    pub effects: Effects,
}

/// Underlines, strikethroughs, and highlights.
#[derive(Clone, Debug)]
pub struct Decoration {
    /// The rectangle to fill.
    pub rect: Rect,
    /// Its paint.
    pub fill: Fill,
    /// Drawn behind the text (highlights).
    pub behind: bool,
}

/// A caret stop: the x position before character `index` of the paragraph.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct CaretStop {
    /// Character index in the paragraph text.
    pub index: usize,
    /// Position.
    pub x: f32,
}

/// One laid-out line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LineBox {
    /// Paragraph index.
    pub paragraph: usize,
    /// Top of the line.
    pub top: f32,
    /// Baseline.
    pub baseline: f32,
    /// Bottom of the line.
    pub bottom: f32,
    /// Caret stops from the first character to just after the last.
    pub stops: Vec<CaretStop>,
}

/// The result of laying out a text body.
#[derive(Clone, Debug, Default)]
pub struct TextLayout {
    /// Glyph runs in drawing order.
    pub runs: Vec<GlyphRun>,
    /// Decorations.
    pub decorations: Vec<Decoration>,
    /// Lines (for carets and hit testing).
    pub lines: Vec<LineBox>,
    /// Filled outlines drawn over the text.
    pub paths: Vec<TextPath>,
    /// Equations, in drawing order.
    pub equations: Vec<EquationBox>,
    /// Total height of the laid-out text, including insets.
    pub content_height: f32,
    /// Widest line, including insets.
    pub content_width: f32,
    /// Layout space → shape text-rectangle space (rotation for vertical text).
    pub transform: Affine,
}

/// Plain text of a paragraph as the layout indexes it (`a:br` = `\u{b}`).
pub fn paragraph_text(p: &Paragraph) -> String {
    p.runs
        .iter()
        .map(|r| {
            if r.kind == RunKind::Break {
                "\u{b}"
            } else {
                r.text.as_str()
            }
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ItemKind {
    Glyph,
    Space,
    Tab,
    Break,
}

#[derive(Clone, Debug)]
struct Item {
    kind: ItemKind,
    /// Source character index within the paragraph.
    src: usize,
    run: usize,
    choice: Option<FontChoice>,
    glyph: Option<u16>,
    size: f32,
    adv: f32,
    ascent: f32,
    descent: f32,
    shift: f32,
    /// Allowed to break after this item.
    break_after: bool,
    /// The (display) character.
    ch: char,
    /// Stands upright in vertical text; `adv` is then its advance down the
    /// line and `glyph_w` its own (horizontal) advance.
    upright: bool,
    glyph_w: f32,
    /// The typeset equation an equation item draws.
    math: Option<std::sync::Arc<crate::math::MathBox>>,
}

/// Which glyphs of vertical text stand upright.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Upright {
    /// None (rotated with the line).
    None,
    /// CJK characters (East Asian and Mongolian vertical text).
    Cjk,
    /// Every character (stacked WordArt text).
    All,
}

impl Upright {
    fn of(vert: Vert) -> Self {
        match vert {
            Vert::EaVert | Vert::MongolianVert => Upright::Cjk,
            Vert::WordArtVert | Vert::WordArtVertRtl => Upright::All,
            Vert::Horz | Vert::Vert | Vert::Vert270 => Upright::None,
        }
    }

    fn applies(self, kind: ItemKind, c: char) -> bool {
        match self {
            Upright::None => false,
            Upright::Cjk => kind == ItemKind::Glyph && is_cjk(c),
            Upright::All => matches!(kind, ItemKind::Glyph | ItemKind::Space),
        }
    }
}

/// Height of an upright glyph's center above the baseline, in ems (the
/// middle of the ideographic em box, and about the middle of capitals).
const UPRIGHT_MID: f32 = 0.38;

/// How far above its baseline the middle of a single-spaced line of text
/// sits, in ems (the line box spans one em above the baseline and
/// `LINE_HEIGHT_FACTOR - 1` below).
const LINE_MID: f32 = (2.0 - LINE_HEIGHT_FACTOR) / 2.0;

/// The insets of a body in layout space (`[left, top, right, bottom]` of the
/// rotated box): each inset stays on the side of the shape it names.
pub fn layout_insets(vert: Vert, insets: [f32; 4]) -> [f32; 4] {
    let [l, t, r, b] = insets;
    match vert {
        Vert::Horz => insets,
        // Layout x runs up the shape, layout y to its right.
        Vert::Vert270 => [b, l, t, r],
        // Layout x runs down the shape, layout y to its left.
        _ => [t, r, b, l],
    }
}

/// Layout space → text-rectangle space for a `w`×`h` rectangle.
pub fn layout_transform(vert: Vert, w: f32, h: f32) -> Affine {
    match vert {
        Vert::Horz => Affine::IDENTITY,
        Vert::Vert270 => Affine::translate(0.0, f64::from(h)).pre_concat(&Affine::rotate(-90.0)),
        _ => Affine::translate(f64::from(w), 0.0).pre_concat(&Affine::rotate(90.0)),
    }
}

/// Parameters controlling layout that callers may vary (autofit search).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutParams {
    /// Font scale applied to every size.
    pub font_scale: f32,
    /// Percentage points removed from percentage line spacing.
    pub line_reduction: f32,
}

impl LayoutParams {
    /// Parameters from the body's stored autofit values.
    pub fn from_body(body: &TextBody) -> Self {
        match body.body.autofit {
            Autofit::Normal {
                font_scale,
                line_reduction,
            } => Self {
                font_scale,
                line_reduction,
            },
            _ => Self {
                font_scale: 1.0,
                line_reduction: 0.0,
            },
        }
    }
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x2E80..=0x2FFF | 0x3000..=0x303F | 0x3040..=0x30FF | 0x3100..=0x31FF | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x2FFFF)
}

fn is_cjk_closing(c: char) -> bool {
    "、。，．：；？！）」』】〕〉》’”ー々ぁぃぅぇぉっゃゅょァィゥェォッャュョ".contains(c)
}

fn is_cs_char(c: char) -> bool {
    matches!(c as u32, 0x0590..=0x08FF | 0x0E00..=0x0E7F | 0x0900..=0x0DFF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF)
}

/// Single-spaced lines are 1.2× the font size, independent of the font's own
/// metrics, with the baseline one font size below the line top (PowerPoint's
/// model, which LibreOffice reproduces with "font-independent line spacing").
const LINE_HEIGHT_FACTOR: f32 = 1.2;

/// Ascent and descent of a line box for text of `size`.
fn line_metrics(_fonts: &FontDb, _face: FaceId, size: f32) -> (f32, f32) {
    (size, size * (LINE_HEIGHT_FACTOR - 1.0))
}

struct Shaper<'a> {
    fonts: &'a FontDb,
}

impl Shaper<'_> {
    fn family_for<'p>(&self, props: &'p RunProps, c: char) -> &'p str {
        if is_cjk(c) && !props.ea.is_empty() {
            return &props.ea;
        }
        if is_cs_char(c) && !props.cs.is_empty() {
            return &props.cs;
        }
        &props.latin
    }

    /// Chooses face + glyph for a character, remapping symbol fonts and falling back.
    fn choose(
        &self,
        family: &str,
        bold: bool,
        italic: bool,
        c: char,
    ) -> (char, Option<FontChoice>, Option<u16>) {
        let lower = family.to_lowercase();
        let (c, family) = match SymbolFont::from_family(&lower) {
            Some(sym) => (remap_symbol(sym, c), "DejaVu Sans"),
            None if (0xF020..=0xF0FF).contains(&(c as u32)) => {
                (remap_symbol(SymbolFont::Wingdings, c), family)
            }
            None => (c, family),
        };
        let Some(choice) = self.fonts.select(family, bold, italic) else {
            return (c, None, None);
        };
        if let Some(g) = self.fonts.glyph(choice.face, c) {
            return (c, Some(choice), Some(g));
        }
        if let Some(fb) = self.fonts.fallback_for(c, choice.face, bold, italic) {
            let g = self.fonts.glyph(fb.face, c);
            return (c, Some(fb), g);
        }
        (c, Some(choice), None)
    }
}

#[derive(Clone)]
struct LineRange {
    start: usize,
    end: usize,
    /// Pen x where the line's first item starts (relative to the text area).
    x_start: f32,
    /// Width of the line content (excluding trailing spaces).
    width: f32,
    /// Whether the line ends the paragraph or a forced break (no justification).
    last: bool,
    /// Positions (relative to `x_start`) of each item, after tab resolution.
    xs: Vec<f32>,
    bullet: Option<BulletInfo>,
    bullet_x: f32,
}

struct LaidLine {
    line: LineRange,
    top: f32,
    height: f32,
    ascent: f32,
}

/// Lays out a text body inside a `w`×`h` text rectangle.
pub fn layout(body: &TextBody, w: f32, h: f32, fonts: &FontDb, params: LayoutParams) -> TextLayout {
    let bp = &body.body;
    let vertical = bp.vert.is_vertical();
    // Vertical text: lay out in the rotated box and rotate back.
    let (bw, bh) = if vertical { (h, w) } else { (w, h) };
    let [li, ti, ri, bi] = layout_insets(bp.vert, bp.insets);
    // Mongolian and stacked text sit in the box rotated 90° clockwise, where
    // lines would stack right to left; theirs stack left to right, so their
    // first line starts at the far (layout bottom) edge.
    let reversed = matches!(bp.vert, Vert::MongolianVert | Vert::WordArtVert);
    let upright = Upright::of(bp.vert);
    let wrap = bp.wrap;
    let area_w = (bw - li - ri).max(0.0);
    let ncol = bp.num_col.max(1) as f32;
    let col_w = if wrap {
        ((area_w - bp.spc_col * (ncol - 1.0)) / ncol).max(1.0)
    } else {
        f32::INFINITY
    };

    let shaper = Shaper { fonts };
    let mut out = TextLayout::default();
    let mut y = 0.0f32;
    let mut counters: Vec<(u8, String, u32)> = Vec::new();
    let mut laid: Vec<(usize, Vec<Item>, Vec<LaidLine>)> = Vec::new();

    for (pi, para) in body.paragraphs.iter().enumerate() {
        let pp = &para.props;
        let items = shape_paragraph(&shaper, para, params, upright);
        let has_text = items.iter().any(|i| i.kind != ItemKind::Break);
        let number = match &pp.bullet.kind {
            BulletKind::AutoNum { scheme, start } if has_text => {
                counters.retain(|(lvl, _, _)| *lvl <= pp.level);
                let n = match counters
                    .iter_mut()
                    .find(|(lvl, s, _)| *lvl == pp.level && s == scheme)
                {
                    Some(c) => {
                        c.2 += 1;
                        c.2
                    }
                    None => {
                        counters.retain(|(lvl, _, _)| *lvl != pp.level);
                        counters.push((pp.level, scheme.clone(), *start));
                        *start
                    }
                };
                Some(autonum_text(scheme, n))
            }
            _ => {
                if has_text {
                    counters.retain(|(lvl, _, _)| *lvl < pp.level);
                }
                None
            }
        };
        let bullet = if has_text {
            make_bullet(&shaper, para, &items, number, params)
        } else {
            None
        };

        let first_size = items
            .iter()
            .find(|i| i.kind != ItemKind::Break)
            .map_or(para.end_props.size * params.font_scale, |i| i.size);
        let spacing = |s: Spacing| match s {
            Spacing::Points(p) => p,
            Spacing::Percent(f) => f * first_size,
        };
        // Space before is not applied to the first paragraph of a body.
        if pi > 0 {
            y += spacing(pp.space_before);
        }

        let lines = break_lines(&items, pp, bullet.as_ref(), col_w, wrap);
        let mut placed = Vec::with_capacity(lines.len());
        for line in lines {
            let (asc, desc) = line_extent(&items[line.start..line.end], fonts, para, params);
            let natural = asc + desc;
            let (height, ascent) = match pp.line_spacing {
                Spacing::Percent(p) => {
                    let p = (p - params.line_reduction).max(0.0);
                    let height = natural * p;
                    // Shrunk lines lose ascent (capped at 80% of the line); grown
                    // lines gain the extra space above the text.
                    let ascent = if p < 1.0 {
                        asc.min(natural * p * 0.8)
                    } else {
                        asc + natural * (p - 1.0)
                    };
                    (height, ascent)
                }
                Spacing::Points(pts) => (pts, asc + (pts - natural)),
            };
            placed.push(LaidLine {
                line,
                top: y,
                height,
                ascent,
            });
            y += height;
        }
        y += spacing(pp.space_after);
        if let (Some(b), Some(first)) = (bullet, placed.first_mut()) {
            first.line.bullet = Some(b);
        }
        laid.push((pi, items, placed));
    }

    let content_h = y;
    let avail_h = (bh - ti - bi).max(0.0);
    // Distance of the text block from the edge the first line starts at.
    let y0 = if reversed { bi } else { ti }
        + match bp.anchor {
            Anchor::Top => 0.0,
            Anchor::Middle => (avail_h - content_h) / 2.0,
            Anchor::Bottom => avail_h - content_h,
        };
    let col_height = if ncol > 1.0 {
        avail_h.max(1.0)
    } else {
        f32::INFINITY
    };
    let max_w = laid
        .iter()
        .flat_map(|(_, _, lines)| lines.iter())
        .map(|l| l.line.width + l.line.x_start)
        .fold(0.0f32, f32::max);
    let block_off = if bp.anchor_ctr && max_w < area_w {
        (area_w - max_w) / 2.0
    } else {
        0.0
    };

    for (pi, items, lines) in &laid {
        let para = &body.paragraphs[*pi];
        for l in lines {
            let (col, top) = if col_height.is_finite() {
                let col = (l.top / col_height).floor().clamp(0.0, ncol - 1.0);
                (col, l.top - col * col_height)
            } else {
                (0.0, l.top)
            };
            let col_off = if col_w.is_finite() {
                col * (col_w + bp.spc_col)
            } else {
                0.0
            };
            let avail = if wrap {
                col_w - para.props.mar_r
            } else if bp.anchor_ctr {
                max_w
            } else {
                area_w.max(max_w) - para.props.mar_r
            };
            // Lines stacking from the far edge keep their own orientation.
            let line_top = if reversed {
                bh - (y0 + top) - l.height
            } else {
                y0 + top
            };
            let geo = LineGeometry {
                x_base: li + col_off + block_off,
                avail,
                baseline: line_top + l.ascent,
                top: line_top,
                bottom: line_top + l.height,
                align: math::display_align(para).unwrap_or(para.props.align),
            };
            emit_line(&mut out, fonts, para, *pi, items, &l.line, &geo);
        }
    }

    out.content_height = content_h + ti + bi;
    out.content_width = max_w + li + ri;
    out.transform = layout_transform(bp.vert, w, h);
    out
}

fn shape_paragraph(
    shaper: &Shaper<'_>,
    para: &Paragraph,
    params: LayoutParams,
    upright: Upright,
) -> Vec<Item> {
    let fonts = shaper.fonts;
    let mut items: Vec<Item> = Vec::new();
    let mut src = 0usize;
    for (ri, run) in para.runs.iter().enumerate() {
        let p = &run.props;
        let base_size = p.size * params.font_scale;
        if run.kind == RunKind::Break {
            let choice = fonts.select(&p.latin, p.bold, p.italic);
            let (ascent, descent) = choice
                .map_or((base_size, base_size * (LINE_HEIGHT_FACTOR - 1.0)), |c| {
                    line_metrics(fonts, c.face, base_size)
                });
            items.push(Item {
                kind: ItemKind::Break,
                src,
                run: ri,
                choice,
                glyph: None,
                size: base_size,
                adv: 0.0,
                ascent,
                descent,
                shift: 0.0,
                break_after: true,
                ch: '\u{b}',
                upright: false,
                glyph_w: 0.0,
                math: None,
            });
            src += 1;
            continue;
        }
        if let RunKind::Math(eq) = &run.kind {
            items.push(math::math_item(eq, run, ri, src, fonts, params));
            src += 1;
            continue;
        }
        let kern_on = p.kern > 0.0 && p.size >= p.kern;
        let mut prev: Option<(FaceId, u16)> = None;
        for c in run.text.chars() {
            let (display, small) = match p.caps {
                Caps::All => (c.to_uppercase().next().unwrap_or(c), false),
                Caps::Small if c.is_lowercase() => (c.to_uppercase().next().unwrap_or(c), true),
                _ => (c, false),
            };
            let mut size = if small { base_size * 0.8 } else { base_size };
            let shift = p.baseline * base_size;
            if p.baseline != 0.0 {
                size *= 2.0 / 3.0;
            }
            let kind = match c {
                '\t' => ItemKind::Tab,
                ' ' | '\u{a0}' | '\u{3000}' => ItemKind::Space,
                '\u{b}' | '\n' | '\r' => ItemKind::Break,
                _ => ItemKind::Glyph,
            };
            let family = shaper.family_for(p, display);
            let (shown, choice, glyph) = match kind {
                ItemKind::Tab | ItemKind::Break => {
                    (display, fonts.select(family, p.bold, p.italic), None)
                }
                ItemKind::Space => {
                    let choice = fonts.select(family, p.bold, p.italic);
                    (' ', choice, choice.and_then(|c| fonts.glyph(c.face, ' ')))
                }
                ItemKind::Glyph => shaper.choose(family, p.bold, p.italic, display),
            };
            let mut adv = match (choice, glyph) {
                (Some(ch), Some(g)) => fonts.advance(ch.face, g) * size,
                _ if kind == ItemKind::Space => size * 0.25,
                _ if kind == ItemKind::Glyph => size * 0.5,
                _ => 0.0,
            };
            let up = upright.applies(kind, shown);
            let glyph_w = adv;
            if up {
                // Upright glyphs advance down the line by an em (CJK) or by
                // a whole line (stacked letters).
                adv = if upright == Upright::All {
                    size * LINE_HEIGHT_FACTOR
                } else {
                    size
                };
            }
            if let (true, false, Some(ch), Some(g), Some((pf, pg))) =
                (kern_on, up, choice, glyph, prev)
                && pf == ch.face
            {
                let k = fonts.kerning(ch.face, pg, g) * size;
                if let Some(last) = items.last_mut() {
                    last.adv += k;
                }
            }
            if matches!(kind, ItemKind::Glyph | ItemKind::Space) {
                adv += p.spacing;
            }
            prev = match (choice, glyph) {
                (Some(ch), Some(g)) if !up => Some((ch.face, g)),
                _ => None,
            };
            let (ascent, descent) = choice
                .map_or((base_size, base_size * (LINE_HEIGHT_FACTOR - 1.0)), |ch| {
                    line_metrics(fonts, ch.face, base_size)
                });
            let break_after = matches!(kind, ItemKind::Space | ItemKind::Tab | ItemKind::Break)
                || matches!(shown, '-' | '\u{2014}' | '\u{2013}' | '/')
                || is_cjk(shown);
            items.push(Item {
                kind,
                src,
                run: ri,
                choice,
                glyph,
                size,
                adv,
                ascent,
                descent,
                shift,
                break_after,
                ch: shown,
                upright: up,
                glyph_w,
                math: None,
            });
            src += 1;
        }
    }
    // Closing punctuation may not start a line; Latin text may break before CJK.
    for i in 1..items.len() {
        if is_cjk_closing(items[i].ch) {
            items[i - 1].break_after = false;
        } else if is_cjk(items[i].ch) && items[i - 1].kind == ItemKind::Glyph {
            items[i - 1].break_after = true;
        }
    }
    items
}

fn next_tab(x: f32, pp: &ParaProps) -> (f32, TabAlign) {
    let explicit = pp.tabs.iter().find(|t| t.pos > x + 0.01);
    // A hanging indent's margin is the first line's first stop (as in Word
    // and PowerPoint), unless an explicit stop comes before it.
    if pp.indent < 0.0 && pp.mar_l > x + 0.01 && explicit.is_none_or(|t| t.pos > pp.mar_l) {
        return (pp.mar_l, TabAlign::Left);
    }
    if let Some(t) = explicit {
        return (t.pos, t.align);
    }
    // Default stops are measured from the text box's edge, like explicit ones.
    let d = pp.default_tab.max(1.0);
    ((((x + 0.01) / d).floor() + 1.0) * d, TabAlign::Left)
}

fn break_lines(
    items: &[Item],
    pp: &ParaProps,
    bullet: Option<&BulletInfo>,
    col_w: f32,
    wrap: bool,
) -> Vec<LineRange> {
    let first_x = (pp.mar_l + pp.indent).max(0.0);
    let bullet_x = first_x;
    let first_text_x = match bullet {
        Some(b) if pp.mar_l >= bullet_x + b.width - 0.01 => pp.mar_l,
        Some(b) => bullet_x + b.width,
        None => first_x,
    };
    let rest_x = pp.mar_l.max(0.0);
    let mut lines = Vec::new();
    if items.is_empty() {
        lines.push(LineRange {
            start: 0,
            end: 0,
            x_start: first_text_x,
            width: 0.0,
            last: true,
            xs: Vec::new(),
            bullet: None,
            bullet_x,
        });
        return lines;
    }
    let mut pos = 0;
    let mut first = true;
    while pos < items.len() {
        let x_start = if first { first_text_x } else { rest_x };
        let limit = if wrap {
            (col_w - pp.mar_r - x_start).max(1.0)
        } else {
            f32::INFINITY
        };
        let mut xs: Vec<f32> = Vec::new();
        let mut x = 0.0f32;
        let mut last_break: Option<usize> = None;
        let mut end = pos;
        let mut forced = false;
        let mut pending_tab: Option<(usize, f32, TabAlign)> = None;
        while end < items.len() {
            let it = &items[end];
            if it.kind == ItemKind::Break {
                xs.push(x);
                end += 1;
                forced = true;
                break;
            }
            if it.kind == ItemKind::Tab {
                let (stop, align) = next_tab(x_start + x, pp);
                let target = (stop - x_start).max(x);
                // A tab whose stop is past the edge starts the next line,
                // where it still advances to a stop.
                if wrap && target > limit + 0.01 && end > pos {
                    break;
                }
                xs.push(x);
                pending_tab = Some((end, target, align));
                x = target;
                end += 1;
                last_break = Some(end);
                continue;
            }
            let mut ix = x;
            if let Some((ti, target, align)) = pending_tab.take()
                && align != TabAlign::Left
            {
                let segment = items[ti + 1..]
                    .iter()
                    .take_while(|i| !matches!(i.kind, ItemKind::Tab | ItemKind::Break));
                let seg_w: f32 = segment.clone().map(|i| i.adv).sum();
                let dec_w: f32 = segment.take_while(|i| i.ch != '.').map(|i| i.adv).sum();
                let tab_x = xs[ti - pos];
                ix = match align {
                    TabAlign::Right => target - seg_w,
                    TabAlign::Center => target - seg_w / 2.0,
                    TabAlign::Decimal => target - dec_w,
                    TabAlign::Left => target,
                }
                .max(tab_x);
            }
            let new_x = ix + it.adv;
            if wrap && it.kind != ItemKind::Space && new_x > limit + 0.01 && end > pos {
                break;
            }
            xs.push(ix);
            x = new_x;
            end += 1;
            if it.break_after {
                last_break = Some(end);
            }
        }
        if end < items.len()
            && !forced
            && wrap
            && let Some(b) = last_break.filter(|&b| b > pos)
        {
            end = b;
            xs.truncate(end - pos);
        }
        // Trailing spaces stay on this line (they hang past the edge).
        while !forced && end < items.len() && items[end].kind == ItemKind::Space {
            let prev = end - 1;
            xs.push(
                xs.last().copied().unwrap_or(0.0) + if prev >= pos { items[prev].adv } else { 0.0 },
            );
            end += 1;
        }
        if end == pos {
            xs.push(0.0);
            end = pos + 1;
        }
        let content_end = (pos..end)
            .rev()
            .find(|&i| !matches!(items[i].kind, ItemKind::Space | ItemKind::Break))
            .map_or(pos, |i| i + 1);
        let width = if content_end > pos {
            xs[content_end - 1 - pos] + items[content_end - 1].adv
        } else {
            0.0
        };
        let last = end >= items.len() || forced;
        lines.push(LineRange {
            start: pos,
            end,
            x_start,
            width,
            last,
            xs,
            bullet: None,
            bullet_x,
        });
        pos = end;
        first = false;
        if forced && pos >= items.len() {
            // A trailing break starts an empty line.
            lines.push(LineRange {
                start: pos,
                end: pos,
                x_start: rest_x,
                width: 0.0,
                last: true,
                xs: Vec::new(),
                bullet: None,
                bullet_x,
            });
        }
    }
    lines
}

fn line_extent(
    items: &[Item],
    fonts: &FontDb,
    para: &Paragraph,
    params: LayoutParams,
) -> (f32, f32) {
    let mut asc = 0.0f32;
    let mut desc = 0.0f32;
    for it in items {
        asc = asc.max(it.ascent);
        desc = desc.max(it.descent);
    }
    if asc == 0.0 && desc == 0.0 {
        let p = &para.end_props;
        let size = p.size * params.font_scale;
        return fonts
            .select(&p.latin, p.bold, p.italic)
            .map_or((size, size * (LINE_HEIGHT_FACTOR - 1.0)), |c| {
                line_metrics(fonts, c.face, size)
            });
    }
    (asc, desc)
}

/// Where a line lands in the text rectangle.
struct LineGeometry {
    x_base: f32,
    avail: f32,
    baseline: f32,
    top: f32,
    bottom: f32,
    /// Horizontal alignment (the paragraph's, or its display equation's).
    align: Align,
}

fn emit_line(
    out: &mut TextLayout,
    fonts: &FontDb,
    para: &Paragraph,
    pi: usize,
    items: &[Item],
    line: &LineRange,
    g: &LineGeometry,
) {
    let free = if g.avail.is_finite() {
        g.avail - line.x_start - line.width
    } else {
        0.0
    };
    let content_end = (line.start..line.end)
        .rev()
        .find(|&i| !matches!(items[i].kind, ItemKind::Space | ItemKind::Break))
        .map_or(line.start, |i| i + 1);
    let (offset, per_space, per_char) = match g.align {
        Align::Center => (free / 2.0, 0.0, 0.0),
        Align::Right => (free, 0.0, 0.0),
        Align::Justify if !line.last && free > 0.0 => {
            let spaces = (line.start..content_end)
                .filter(|&i| items[i].kind == ItemKind::Space)
                .count();
            if spaces > 0 {
                (0.0, free / spaces as f32, 0.0)
            } else {
                (0.0, 0.0, 0.0)
            }
        }
        Align::Distributed if free > 0.0 => {
            let gaps = content_end.saturating_sub(line.start).saturating_sub(1);
            if gaps > 0 {
                (0.0, 0.0, free / gaps as f32)
            } else {
                (free / 2.0, 0.0, 0.0)
            }
        }
        _ => (0.0, 0.0, 0.0),
    };
    let x0 = g.x_base + line.x_start + offset;

    // The bullet hangs at the indent and moves with centered/right-aligned text.
    if let Some(b) = &line.bullet {
        let shift = if matches!(g.align, Align::Center | Align::Right) {
            offset
        } else {
            0.0
        };
        let mut bx = g.x_base + line.bullet_x + shift;
        for it in &b.items {
            if let (Some(ch), Some(gl)) = (it.choice, it.glyph) {
                push_glyph(
                    out,
                    ch,
                    it.size,
                    (gl, bx, g.baseline, false),
                    &b.fill,
                    &None,
                    &Effects::default(),
                );
            }
            bx += it.adv;
        }
    }

    // Item positions with justification.
    let mut xs = Vec::with_capacity(line.end - line.start);
    let mut extra = 0.0;
    for (k, item) in items.iter().enumerate().take(line.end).skip(line.start) {
        xs.push(x0 + line.xs.get(k - line.start).copied().unwrap_or(0.0) + extra);
        if k < content_end {
            if item.kind == ItemKind::Space {
                extra += per_space;
            }
            if k + 1 < content_end {
                extra += per_char;
            }
        }
    }

    // Run segments (for highlights and decorations), excluding trailing spaces.
    let mut segments: Vec<(usize, usize)> = Vec::new();
    let mut k = line.start;
    while k < content_end {
        let run = items[k].run;
        let mut j = k;
        while j < content_end && items[j].run == run {
            j += 1;
        }
        segments.push((k, j));
        k = j;
    }
    let seg_x = |a: usize, b: usize| {
        (
            xs[a - line.start],
            xs[b - 1 - line.start] + items[b - 1].adv,
        )
    };
    for &(a, b) in &segments {
        if let Some(h) = para.runs[items[a].run].props.highlight {
            let (xa, xb) = seg_x(a, b);
            out.decorations.push(Decoration {
                rect: Rect::from_ltrb(xa, g.top, xb, g.bottom),
                fill: Fill::Solid(h),
                behind: true,
            });
        }
    }

    for k in line.start..line.end {
        let it = &items[k];
        if it.kind != ItemKind::Glyph {
            continue;
        }
        if let Some(bx) = &it.math {
            math::emit_math(out, it, bx, para, pi, xs[k - line.start], g.baseline);
            continue;
        }
        let (Some(ch), Some(gl)) = (it.choice, it.glyph) else {
            continue;
        };
        let props = &para.runs[it.run].props;
        let x = xs[k - line.start];
        let baseline = g.baseline - it.shift;
        let placed = if it.upright {
            // The glyph's middle goes to the middle of its cell on the line;
            // turned back a quarter turn about its pen origin, that origin
            // lies a quarter turn away from the middle.
            let cx = x + it.adv / 2.0;
            let cy = baseline - LINE_MID * it.size;
            (gl, cx + UPRIGHT_MID * it.size, cy + it.glyph_w / 2.0, true)
        } else {
            (gl, x, baseline, false)
        };
        push_glyph(
            out,
            ch,
            it.size,
            placed,
            &props.fill,
            &props.outline,
            &props.effects,
        );
    }

    for &(a, b) in &segments {
        let it = &items[a];
        let props = &para.runs[it.run].props;
        let Some(ch) = it.choice else { continue };
        if props.underline == Underline::None && props.strike == Strike::None {
            continue;
        }
        let m = fonts.metrics(ch.face);
        let size = it.size;
        let (xa, xb) = seg_x(a, b);
        let color = Fill::Solid(props.fill.representative_color().unwrap_or(Rgba::BLACK));
        let base = g.baseline - it.shift;
        let thick = (m.underline_thickness * size).max(0.5);
        let mut push = |y: f32, t: f32| {
            out.decorations.push(Decoration {
                rect: Rect::from_ltrb(xa, y - t / 2.0, xb, y + t / 2.0),
                fill: color.clone(),
                behind: false,
            });
        };
        let uy = base + m.underline_pos * size;
        match props.underline {
            Underline::None => {}
            Underline::Double => {
                push(uy, thick * 0.6);
                push(uy + thick * 1.6, thick * 0.6);
            }
            Underline::Heavy => push(uy, thick * 2.0),
            _ => push(uy, thick),
        }
        let st = (m.strike_thickness * size).max(0.5);
        let sy = base - m.strike_pos * size;
        match props.strike {
            Strike::None => {}
            Strike::Single => push(sy, st),
            Strike::Double => {
                push(sy - st, st * 0.7);
                push(sy + st, st * 0.7);
            }
        }
    }

    let mut stops = Vec::with_capacity(line.end - line.start + 1);
    for k in line.start..line.end {
        if items[k].kind != ItemKind::Break {
            stops.push(CaretStop {
                index: items[k].src,
                x: xs[k - line.start],
            });
        }
    }
    match (line.start..line.end)
        .rev()
        .find(|&k| items[k].kind != ItemKind::Break)
    {
        Some(k) => stops.push(CaretStop {
            index: items[k].src + 1,
            x: xs[k - line.start] + items[k].adv.max(0.0),
        }),
        None => {
            let index = items
                .get(line.start)
                .map_or_else(|| items.last().map_or(0, |i| i.src + 1), |i| i.src);
            stops.push(CaretStop { index, x: x0 });
        }
    }
    out.lines.push(LineBox {
        paragraph: pi,
        top: g.top,
        baseline: g.baseline,
        bottom: g.bottom,
        stops,
    });
}

/// Adds glyph `(id, x, y, upright)` to the last run when it shares the look.
fn push_glyph(
    out: &mut TextLayout,
    choice: FontChoice,
    size: f32,
    (glyph, x, y, upright): (u16, f32, f32, bool),
    fill: &Fill,
    outline: &Option<LineProps>,
    effects: &Effects,
) {
    let placed = PlacedGlyph {
        id: glyph,
        x,
        y,
        upright,
    };
    if let Some(run) = out.runs.last_mut()
        && run.face == choice.face
        && run.size == size
        && run.fill == *fill
        && run.outline == *outline
        && run.synthetic_bold == choice.synthetic_bold
        && run.synthetic_italic == choice.synthetic_italic
        && run.effects == *effects
    {
        run.glyphs.push(placed);
        return;
    }
    out.runs.push(GlyphRun {
        face: choice.face,
        size,
        glyphs: vec![placed],
        fill: fill.clone(),
        outline: outline.clone(),
        synthetic_bold: choice.synthetic_bold,
        synthetic_italic: choice.synthetic_italic,
        effects: effects.clone(),
    });
}

#[cfg(test)]
mod test;
