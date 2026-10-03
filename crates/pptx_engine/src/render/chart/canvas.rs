//! Drawing primitives for charts: chart-local shapes, text, and markers.
//!
//! Charts are laid out in frame-local points; the canvas maps everything
//! through the frame's world transform when emitting display-list nodes.

use super::model::Symbol;
use crate::font::FontDb;
use crate::model::fill::{Fill, Line};
use crate::path::{Affine, Path, Point, Rect};
use crate::render::label::{HAlign, LabelStyle, label_nodes, measure};
use crate::render::paint::{ImageSource, fill_paint, line_stroke};
use crate::render::scene::{Group, Node};

/// Line height of chart text as a multiple of the font size.
pub(crate) const LINE_HEIGHT: f32 = 1.2;

/// Emits chart nodes.
pub(crate) struct Canvas<'a> {
    pub fonts: &'a FontDb,
    pub images: &'a mut dyn ImageSource,
    pub world: Affine,
    /// The chart frame (chart-local points).
    pub chart: Rect,
    pub out: Vec<Node>,
}

/// A styled piece of text.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Span {
    pub text: String,
    pub style: LabelStyle,
}

/// One laid-out line.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextLine {
    pub spans: Vec<Span>,
    pub width: f32,
    pub height: f32,
    pub align: HAlign,
}

/// Laid-out multi-line text.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Block {
    pub lines: Vec<TextLine>,
    pub width: f32,
    pub height: f32,
}

impl Block {
    /// Size of the block's bounding box after rotating by `deg`.
    pub fn rotated_size(&self, deg: f32) -> (f32, f32) {
        let r = f64::from(deg).to_radians();
        let (s, c) = (r.sin().abs() as f32, r.cos().abs() as f32);
        (
            self.width * c + self.height * s,
            self.width * s + self.height * c,
        )
    }

    /// Whether the block has no visible text.
    pub fn is_empty(&self) -> bool {
        self.lines
            .iter()
            .all(|l| l.spans.iter().all(|s| s.text.trim().is_empty()))
    }
}

impl Canvas<'_> {
    /// Mean scale of the world transform (for stroke widths).
    pub fn scale(&self) -> f32 {
        self.world.mean_scale() as f32
    }

    /// Fills a chart-local path; `bbox` frames gradients and pictures.
    pub fn fill(&mut self, path: &Path, fill: &Fill, bbox: Rect) {
        if path.is_empty() {
            return;
        }
        if let Some(paint) = fill_paint(fill, bbox, &self.world, self.images) {
            self.out.push(Node::Fill {
                path: path.transform(&self.world),
                paint,
                even_odd: false,
            });
        }
    }

    /// Strokes a chart-local path.
    pub fn stroke(&mut self, path: &Path, line: &Line) {
        if path.is_empty() {
            return;
        }
        let bbox = path.bounds().unwrap_or_default();
        if let Some(paint) = fill_paint(&line.fill, bbox, &self.world, self.images) {
            let stroke = line_stroke(line, self.scale());
            self.out.push(Node::Stroke {
                path: path.transform(&self.world),
                paint,
                stroke,
            });
        }
    }

    /// Fills and outlines a path.
    pub fn shape(&mut self, path: &Path, fill: Option<&Fill>, line: Option<&Line>, bbox: Rect) {
        if let Some(f) = fill {
            self.fill(path, f, bbox);
        }
        if let Some(l) = line {
            self.stroke(path, l);
        }
    }

    /// Runs `draw` and wraps what it emitted in a group clipped to `clip`.
    pub fn clipped(&mut self, clip: Rect, draw: impl FnOnce(&mut Self)) {
        let saved = std::mem::take(&mut self.out);
        draw(self);
        let children = std::mem::replace(&mut self.out, saved);
        if !children.is_empty() {
            let clip = Path::rect(clip).transform(&self.world);
            self.out.push(
                Group {
                    children,
                    opacity: 1.0,
                    clip: Some(clip),
                    effects: Vec::new(),
                }
                .into_node(),
            );
        }
    }

    /// Width of single-line text.
    pub fn measure(&self, text: &str, style: &LabelStyle) -> f32 {
        measure(self.fonts, text, style)
    }

    /// Offset from a line's vertical center to its baseline.
    pub fn baseline_offset(&self, style: &LabelStyle) -> f32 {
        let (asc, desc) = self
            .fonts
            .select(&style.family, style.bold, style.italic)
            .map(|c| {
                let m = self.fonts.metrics(c.face);
                (m.win_ascent.max(m.ascent), m.win_descent.max(m.descent))
            })
            .unwrap_or((0.9, 0.25));
        (asc - desc) / 2.0 * style.size
    }

    /// Draws one line of text vertically centered on `y`.
    pub fn text(&mut self, text: &str, style: &LabelStyle, x: f32, y: f32, align: HAlign) {
        if text.is_empty() || style.color.a <= 0.0 {
            return;
        }
        let baseline = y + self.baseline_offset(style);
        label_nodes(
            self.fonts,
            text,
            style,
            (x, baseline),
            align,
            &self.world,
            &mut self.out,
        );
    }

    /// Lays out spans in paragraphs, wrapping lines at `max_w`.
    pub fn layout(&self, paras: &[(HAlign, Vec<Span>)], max_w: f32) -> Block {
        let mut lines: Vec<TextLine> = Vec::new();
        for (align, spans) in paras {
            let para_size = spans
                .iter()
                .map(|s| s.style.size)
                .fold(0.0f32, f32::max)
                .max(1.0);
            let flush = |cur: &mut TextLine, lines: &mut Vec<TextLine>| {
                trim_line_end(self, cur);
                let size = cur
                    .spans
                    .iter()
                    .map(|s| s.style.size)
                    .fold(0.0f32, f32::max);
                cur.height = if size > 0.0 { size } else { para_size } * LINE_HEIGHT;
                let next = TextLine {
                    spans: Vec::new(),
                    width: 0.0,
                    height: 0.0,
                    align: cur.align,
                };
                lines.push(std::mem::replace(cur, next));
            };
            let mut cur = TextLine {
                spans: Vec::new(),
                width: 0.0,
                height: 0.0,
                align: *align,
            };
            for span in spans {
                for (k, piece) in span.text.split('\n').enumerate() {
                    if k > 0 {
                        flush(&mut cur, &mut lines);
                    }
                    for word in split_words(piece) {
                        let w_trim = self.measure(word.trim_end(), &span.style);
                        if !cur.spans.is_empty() && cur.width + w_trim > max_w {
                            flush(&mut cur, &mut lines);
                        }
                        let word = if cur.spans.is_empty() {
                            word.trim_start()
                        } else {
                            word
                        };
                        if word.is_empty() {
                            continue;
                        }
                        cur.width += self.measure(word, &span.style);
                        match cur.spans.last_mut() {
                            Some(last) if last.style == span.style => last.text.push_str(word),
                            _ => cur.spans.push(Span {
                                text: word.to_owned(),
                                style: span.style.clone(),
                            }),
                        }
                    }
                }
            }
            flush(&mut cur, &mut lines);
        }
        let width = lines.iter().map(|l| l.width).fold(0.0, f32::max);
        let height = lines.iter().map(|l| l.height).sum();
        Block {
            lines,
            width,
            height,
        }
    }

    /// Lays out one plain string (with optional wrapping).
    pub fn plain(&self, text: &str, style: &LabelStyle, max_w: f32, align: HAlign) -> Block {
        self.layout(
            &[(
                align,
                vec![Span {
                    text: text.to_owned(),
                    style: style.clone(),
                }],
            )],
            max_w,
        )
    }

    /// Draws a block centered on `center`, rotated by `deg` (clockwise).
    pub fn block(&mut self, b: &Block, center: Point, deg: f32) {
        let t = self
            .world
            .pre_concat(&Affine::translate(f64::from(center.x), f64::from(center.y)))
            .pre_concat(&Affine::rotate(f64::from(deg)))
            .pre_concat(&Affine::translate(
                -f64::from(b.width / 2.0),
                -f64::from(b.height / 2.0),
            ));
        let mut y = 0.0;
        for line in &b.lines {
            let mut x = match line.align {
                HAlign::Left => 0.0,
                HAlign::Center => (b.width - line.width) / 2.0,
                HAlign::Right => b.width - line.width,
            };
            for span in &line.spans {
                let w = self.measure(&span.text, &span.style);
                if span.style.color.a > 0.0 {
                    let baseline = y + line.height / 2.0 + self.baseline_offset(&span.style);
                    label_nodes(
                        self.fonts,
                        &span.text,
                        &span.style,
                        (x, baseline),
                        HAlign::Left,
                        &t,
                        &mut self.out,
                    );
                }
                x += w;
            }
            y += line.height;
        }
    }

    /// Draws a data marker centered on `c`.
    pub fn marker(
        &mut self,
        symbol: Symbol,
        c: Point,
        size: f32,
        fill: Option<&Fill>,
        line: Option<&Line>,
    ) {
        let h = size / 2.0;
        let bbox = Rect::from_xywh(c.x - h, c.y - h, size, size);
        let poly = |pts: &[(f32, f32)]| {
            let mut p = Path::new();
            for (i, (x, y)) in pts.iter().enumerate() {
                let pt = Point::new(c.x + x, c.y + y);
                if i == 0 { p.move_to(pt) } else { p.line_to(pt) }
            }
            p.close();
            p
        };
        match symbol {
            Symbol::None => {}
            Symbol::Circle => self.shape(&Path::ellipse(bbox), fill, line, bbox),
            Symbol::Square | Symbol::Auto => self.shape(&Path::rect(bbox), fill, line, bbox),
            Symbol::Diamond => self.shape(
                &poly(&[(0.0, -h), (h, 0.0), (0.0, h), (-h, 0.0)]),
                fill,
                line,
                bbox,
            ),
            Symbol::Triangle => self.shape(&poly(&[(0.0, -h), (h, h), (-h, h)]), fill, line, bbox),
            Symbol::Dash => {
                let r = Rect::from_xywh(c.x - h, c.y - size / 8.0, size, size / 4.0);
                self.shape(&Path::rect(r), fill, line, r);
            }
            Symbol::Dot => {
                let r = Rect::from_xywh(c.x - h / 2.0, c.y - h / 2.0, h, h);
                self.shape(&Path::ellipse(r), fill.or(line.map(|l| &l.fill)), None, r);
            }
            Symbol::X | Symbol::Star | Symbol::Plus => {
                let mut p = Path::new();
                let mut seg = |a: (f32, f32), b: (f32, f32)| {
                    p.move_to(Point::new(c.x + a.0, c.y + a.1));
                    p.line_to(Point::new(c.x + b.0, c.y + b.1));
                };
                if symbol != Symbol::Plus {
                    seg((-h, -h), (h, h));
                    seg((-h, h), (h, -h));
                }
                if symbol != Symbol::X {
                    seg((0.0, -h), (0.0, h));
                }
                if symbol == Symbol::Plus {
                    seg((-h, 0.0), (h, 0.0));
                }
                let stroke = line.cloned().or_else(|| {
                    fill.map(|f| Line {
                        width: 0.75,
                        fill: f.clone(),
                        dash: None,
                        cap: crate::model::fill::Cap::Flat,
                        join: crate::model::fill::Join::Round,
                        compound: crate::model::fill::Compound::Single,
                        head: None,
                        tail: None,
                    })
                });
                if let Some(l) = stroke {
                    self.stroke(&p, &Line { dash: None, ..l });
                }
            }
        }
    }
}

/// Splits text into words, each keeping its trailing spaces.
fn split_words(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut in_space = false;
    for (i, ch) in s.char_indices() {
        if ch == ' ' {
            in_space = true;
        } else if in_space {
            out.push(&s[start..i]);
            start = i;
            in_space = false;
        }
    }
    if start < s.len() {
        out.push(&s[start..]);
    }
    out
}

/// Drops trailing spaces from the last span of a line.
fn trim_line_end(cv: &Canvas<'_>, line: &mut TextLine) {
    if let Some(last) = line.spans.last_mut() {
        let trimmed = last.text.trim_end().len();
        if trimmed < last.text.len() {
            let removed = last.text[trimmed..].to_owned();
            line.width -= cv.measure(&removed, &last.style);
            last.text.truncate(trimmed);
        }
    }
    line.width = line.width.max(0.0);
}
