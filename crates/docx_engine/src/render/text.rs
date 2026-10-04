//! Text lines: glyphs, highlights, underlines, strikethrough, tab leaders.

use super::Renderer;
use crate::layout::PlacedLine;
use crate::layout::fonts::{is_wide, missing_advance};
use crate::layout::inline::{Kind, Revision, RunStyle};
use crate::model::props::{TabLeader, UnderlineStyle};
use pptx_engine::font::FaceId;
use pptx_engine::model::color::Rgba;
use pptx_engine::path::{Affine, Path, Point, Rect};
use pptx_engine::render::scene::{LineCap, LineJoin, Node, Paint, Stroke};

/// Slant of synthesized italics.
const SYNTHETIC_SLANT: f64 = 0.2;

/// Inset of the box drawn for an East Asian character no face has (em).
const PLACEHOLDER_INSET: f32 = 0.1;
/// Top of that box above the baseline (em).
const PLACEHOLDER_RISE: f32 = 0.8;
/// Its opacity relative to the text color.
const PLACEHOLDER_ALPHA: f32 = 0.25;
/// Inset of the bar drawn for a letter no face has (em).
const LETTER_INSET: f32 = 0.02;
/// Height of that bar above the baseline (em).
const LETTER_RISE: f32 = 0.45;

/// Glyphs collected into one path per color.
struct GlyphBatch {
    color: Rgba,
    path: Path,
    bold: Option<f32>,
}

impl GlyphBatch {
    fn flush(&mut self, out: &mut Vec<Node>) {
        if self.path.is_empty() {
            return;
        }
        let path = std::mem::take(&mut self.path);
        if let Some(w) = self.bold.take() {
            out.push(Node::Stroke {
                path: path.clone(),
                paint: Paint::Solid(self.color),
                stroke: Stroke {
                    width: w,
                    cap: LineCap::Round,
                    join: LineJoin::Round,
                    miter_limit: 4.0,
                    dash: None,
                },
            });
        }
        out.push(Node::Fill {
            path,
            paint: Paint::Solid(self.color),
            even_odd: false,
        });
    }
}

/// How glyphs of a run are drawn: their face at a size, widened by
/// `scale_x`, slanted when `italic` (a synthetic italic).
#[derive(Clone, Copy)]
struct GlyphStyle {
    face: FaceId,
    size: f32,
    scale_x: f32,
    italic: bool,
}

impl GlyphStyle {
    /// Upright glyphs of `face` at `size`.
    fn plain(face: FaceId, size: f32) -> Self {
        Self {
            face,
            size,
            scale_x: 1.0,
            italic: false,
        }
    }
}

/// The outline of `glyph` drawn in `style` with its origin at (x, y).
fn glyph_path(r: &Renderer<'_>, style: GlyphStyle, glyph: u16, x: f32, y: f32) -> Option<Path> {
    let GlyphStyle {
        face,
        size,
        scale_x,
        italic,
    } = style;
    let outline = r.fonts.outline(face, glyph)?;
    let mut t = Affine::translate(f64::from(x), f64::from(y))
        .pre_concat(&Affine::scale(f64::from(size * scale_x), f64::from(size)));
    if italic {
        t = t.pre_concat(&Affine {
            a: 1.0,
            b: 0.0,
            c: -SYNTHETIC_SLANT,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        });
    }
    Some(outline.transform(&t))
}

fn hline(
    x0: f32,
    x1: f32,
    y: f32,
    width: f32,
    color: Rgba,
    dash: Option<Vec<f32>>,
    out: &mut Vec<Node>,
) {
    if x1 - x0 < 0.05 {
        return;
    }
    let mut p = Path::new();
    p.move_to(Point::new(x0, y));
    p.line_to(Point::new(x1, y));
    out.push(Node::Stroke {
        path: p,
        paint: Paint::Solid(color),
        stroke: Stroke {
            width: width.max(0.3),
            cap: LineCap::Butt,
            join: LineJoin::Miter,
            miter_limit: 4.0,
            dash,
        },
    });
}

/// A run of clusters on one line that share a style, for decorations.
struct Segment {
    run: u16,
    x0: f32,
    x1: f32,
    /// Ends of words (for word-only underlines): (x0, x1) of non-space parts.
    words: Vec<(f32, f32)>,
}

/// Draws one placed line.
pub(super) fn line_nodes(r: &mut Renderer<'_>, pl: &PlacedLine, out: &mut Vec<Node>) {
    let pb = &pl.para;
    let line = pl.line();
    let inline = &pb.inline;
    let lines = &pb.lines;
    let baseline = pl.y + line.baseline;
    // Trailing spaces are not decorated.
    let mut last_visible = line.start;
    for k in line.start..line.end {
        if matches!(
            inline.clusters[k].kind,
            Kind::Text | Kind::Object(_) | Kind::Tab
        ) {
            last_visible = k + 1;
        }
    }
    // Segments by run.
    let mut segments: Vec<Segment> = Vec::new();
    for k in line.start..last_visible {
        let c = &inline.clusters[k];
        if !matches!(
            c.kind,
            Kind::Text | Kind::Space | Kind::Tab | Kind::Object(_)
        ) {
            continue;
        }
        let x0 = pl.x + lines.x[k];
        let x1 = x0 + lines.adv[k];
        // Right-to-left text runs leftwards: a segment grows on either side.
        let touches = |a: f32, b: f32| (b - x0).abs() < 0.5 || (x1 - a).abs() < 0.5;
        match segments.last_mut() {
            Some(s) if s.run == c.run && touches(s.x0, s.x1) => {
                s.x0 = s.x0.min(x0);
                s.x1 = s.x1.max(x1);
                if c.kind == Kind::Text {
                    match s.words.last_mut() {
                        Some(w) if touches(w.0, w.1) => {
                            w.0 = w.0.min(x0);
                            w.1 = w.1.max(x1);
                        }
                        _ => s.words.push((x0, x1)),
                    }
                }
            }
            _ => segments.push(Segment {
                run: c.run,
                x0,
                x1,
                words: if c.kind == Kind::Text {
                    vec![(x0, x1)]
                } else {
                    Vec::new()
                },
            }),
        }
    }
    // Backgrounds: shading and highlight.
    for s in &segments {
        let style = &inline.runs[s.run as usize];
        let bg = style.props.highlight.or(style.props.shading);
        if let Some(color) = bg {
            let top = baseline - style.ascent - style.leading;
            out.push(Node::Fill {
                path: Path::rect(Rect::from_xywh(
                    s.x0,
                    top,
                    s.x1 - s.x0,
                    style.ascent + style.leading + style.descent,
                )),
                paint: Paint::Solid(color),
                even_odd: false,
            });
        }
    }
    // Glyphs.
    let mut batch = GlyphBatch {
        color: Rgba::BLACK,
        path: Path::new(),
        bold: None,
    };
    for k in line.start..line.end {
        let c = &inline.clusters[k];
        let style: &RunStyle = &inline.runs[c.run as usize];
        match c.kind {
            Kind::Text => {
                let Some(font) = c.font else {
                    continue;
                };
                if c.glyph == 0 {
                    if missing_advance(c.ch).is_some_and(|a| a > 0.0) {
                        // No face has the character: a light box shows
                        // where it is (an em square for East Asian text, a
                        // low bar for letters).
                        batch.flush(out);
                        let size = if c.size > 0.0 { c.size } else { style.size };
                        let (inset, rise, height) = if is_wide(c.ch) {
                            (
                                PLACEHOLDER_INSET,
                                PLACEHOLDER_RISE,
                                1.0 - 2.0 * PLACEHOLDER_INSET,
                            )
                        } else {
                            (LETTER_INSET, LETTER_RISE, LETTER_RISE)
                        };
                        let rect = Rect::from_xywh(
                            pl.x + lines.x[k] + size * inset,
                            baseline - style.shift - size * rise,
                            (lines.adv[k] - 2.0 * size * inset).max(0.0),
                            size * height,
                        );
                        out.push(Node::Fill {
                            path: Path::rect(rect),
                            paint: Paint::Solid(style.color.with_alpha_mul(PLACEHOLDER_ALPHA)),
                            even_odd: false,
                        });
                    }
                    continue;
                }
                let size = if c.size > 0.0 { c.size } else { style.size };
                let x = pl.x + lines.x[k];
                let y = baseline - style.shift;
                let color = style.color;
                let bold = font.synthetic_bold.then_some(size * 0.035);
                if batch.color != color || batch.bold.is_some() != bold.is_some() {
                    batch.flush(out);
                    batch.color = color;
                }
                batch.bold = bold;
                let glyphs = GlyphStyle {
                    face: font.face,
                    size,
                    scale_x: style.props.scale,
                    italic: font.synthetic_italic,
                };
                if let Some(p) = glyph_path(r, glyphs, c.glyph, x, y) {
                    batch.path.extend(&p);
                }
            }
            Kind::Tab => {
                if let Some(&(_, leader)) = lines.leaders.iter().find(|(i, _)| *i == k) {
                    batch.flush(out);
                    leader_nodes(
                        r,
                        style,
                        leader,
                        pl.x + lines.x[k],
                        pl.x + lines.x[k] + lines.adv[k],
                        baseline,
                        out,
                    );
                }
            }
            Kind::SoftHyphen if k + 1 == line.end || (line.hyphen && k + 1 >= line.end) => {
                if let Some(font) = style.font {
                    let g = r.fonts.glyph(font.face, '-');
                    if let Some(g) = g
                        && let Some(p) = glyph_path(
                            r,
                            GlyphStyle::plain(font.face, style.size),
                            g,
                            pl.x + lines.x[k],
                            baseline - style.shift,
                        )
                    {
                        if batch.color != style.color {
                            batch.flush(out);
                            batch.color = style.color;
                        }
                        batch.path.extend(&p);
                    }
                }
            }
            Kind::Object(o) => {
                batch.flush(out);
                let d = &inline.objects[o as usize];
                let x = pl.x + lines.x[k] + d.effect[0];
                let y = baseline - d.height - d.effect[3];
                super::drawing::drawing_nodes(
                    r,
                    d,
                    Rect::from_xywh(x, y, d.width, d.height),
                    &pb.story,
                    out,
                );
            }
            Kind::Separator(_) => {
                batch.flush(out);
                let y = pl.y + line.height / 2.0;
                hline(
                    pl.x + lines.x[k],
                    pl.x + lines.x[k] + lines.adv[k],
                    y,
                    0.5,
                    Rgba::BLACK,
                    None,
                    out,
                );
            }
            _ => {}
        }
    }
    batch.flush(out);
    // Underline and strikethrough.
    for s in &segments {
        let style = &inline.runs[s.run as usize];
        let Some(font) = style.font else {
            continue;
        };
        let m = r.fonts.metrics(font.face);
        let size = style.size;
        let y_base = baseline - style.shift;
        let mut underline = style.props.underline;
        if style.revision == Revision::Inserted && underline.is_none() {
            underline = Some(crate::model::props::Underline {
                style: UnderlineStyle::Single,
                color: None,
            });
        }
        if let Some(u) = underline {
            let color = u.color.unwrap_or(style.color);
            let thick = (m.underline_thickness * size).max(0.5);
            let y = y_base + m.underline_pos * size;
            let spans: Vec<(f32, f32)> = if u.style == UnderlineStyle::Words {
                s.words.clone()
            } else {
                vec![(s.x0, s.x1)]
            };
            for (x0, x1) in spans {
                match u.style {
                    UnderlineStyle::Double | UnderlineStyle::WavyDouble => {
                        hline(x0, x1, y, thick, color, None, out);
                        hline(x0, x1, y + thick * 2.0, thick, color, None, out);
                    }
                    UnderlineStyle::Thick | UnderlineStyle::WavyHeavy => {
                        hline(x0, x1, y + thick / 2.0, thick * 2.0, color, None, out);
                    }
                    UnderlineStyle::Dotted | UnderlineStyle::DottedHeavy => {
                        hline(x0, x1, y, thick, color, Some(vec![thick, thick * 2.0]), out);
                    }
                    UnderlineStyle::Dash | UnderlineStyle::DashHeavy | UnderlineStyle::DashLong => {
                        hline(
                            x0,
                            x1,
                            y,
                            thick,
                            color,
                            Some(vec![thick * 4.0, thick * 3.0]),
                            out,
                        );
                    }
                    UnderlineStyle::DotDash | UnderlineStyle::DotDotDash => {
                        hline(
                            x0,
                            x1,
                            y,
                            thick,
                            color,
                            Some(vec![thick * 4.0, thick * 2.0, thick, thick * 2.0]),
                            out,
                        );
                    }
                    _ => hline(x0, x1, y, thick, color, None, out),
                }
            }
        }
        let strike = style.props.strike || style.revision == Revision::Deleted;
        if strike || style.props.dstrike {
            let thick = (m.strike_thickness * size).max(0.5);
            let y = y_base - m.strike_pos * size;
            if style.props.dstrike {
                hline(s.x0, s.x1, y - thick, thick, style.color, None, out);
                hline(s.x0, s.x1, y + thick, thick, style.color, None, out);
            } else {
                hline(s.x0, s.x1, y, thick, style.color, None, out);
            }
        }
        if let Some(b) = style.props.border {
            let top = baseline - style.ascent - style.leading - b.space;
            let bottom = baseline + style.descent + b.space;
            for (x0, y0, x1, y1) in [
                (s.x0, top, s.x1, top),
                (s.x0, bottom, s.x1, bottom),
                (s.x0, top, s.x0, bottom),
                (s.x1, top, s.x1, bottom),
            ] {
                super::rule_nodes(x0, y0, x1, y1, &b, out);
            }
        }
    }
}

fn leader_nodes(
    r: &Renderer<'_>,
    style: &RunStyle,
    leader: TabLeader,
    x0: f32,
    x1: f32,
    baseline: f32,
    out: &mut Vec<Node>,
) {
    let size = style.size;
    match leader {
        TabLeader::Underscore => {
            hline(
                x0,
                x1,
                baseline + size * 0.1,
                size * 0.05,
                style.color,
                None,
                out,
            );
        }
        TabLeader::Heavy => {
            hline(
                x0,
                x1,
                baseline + size * 0.1,
                size * 0.1,
                style.color,
                None,
                out,
            );
        }
        TabLeader::None => {}
        TabLeader::Dot | TabLeader::Hyphen | TabLeader::MiddleDot => {
            let ch = match leader {
                TabLeader::Dot => '.',
                TabLeader::Hyphen => '-',
                _ => '\u{00B7}',
            };
            let Some(font) = style.font else {
                return;
            };
            let Some(g) = r.fonts.glyph(font.face, ch) else {
                return;
            };
            let adv = r.fonts.advance(font.face, g) * size;
            if adv <= 0.1 {
                return;
            }
            // Word aligns leader dots to a grid so stacked leaders line up.
            let mut x = (x0 / adv).ceil() * adv;
            let mut path = Path::new();
            while x + adv <= x1 - adv * 0.5 {
                if let Some(p) = glyph_path(r, GlyphStyle::plain(font.face, size), g, x, baseline) {
                    path.extend(&p);
                }
                x += adv;
            }
            if !path.is_empty() {
                out.push(Node::Fill {
                    path,
                    paint: Paint::Solid(style.color),
                    even_odd: false,
                });
            }
        }
    }
}

/// Draws a short string (line numbers) ending at `x`.
pub(super) fn plain_text(
    r: &mut Renderer<'_>,
    text: &str,
    x: f32,
    baseline: f32,
    size: f32,
    font: &str,
    out: &mut Vec<Node>,
) {
    let Some(choice) = r.fonts.select(font, false, false) else {
        return;
    };
    let face = choice.face;
    let glyphs: Vec<(u16, f32)> = text
        .chars()
        .filter_map(|c| {
            r.fonts
                .glyph(face, c)
                .map(|g| (g, r.fonts.advance(face, g) * size))
        })
        .collect();
    let width: f32 = glyphs.iter().map(|(_, a)| a).sum();
    let mut pen = x - width;
    let mut path = Path::new();
    for (g, adv) in glyphs {
        if let Some(p) = glyph_path(r, GlyphStyle::plain(face, size), g, pen, baseline) {
            path.extend(&p);
        }
        pen += adv;
    }
    out.push(Node::Fill {
        path,
        paint: Paint::Solid(Rgba::BLACK),
        even_odd: false,
    });
}
