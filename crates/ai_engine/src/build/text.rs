//! Text blocks (`BT` … `ET`) read into text objects: the glyphs as the file
//! placed them, and the characters, font, and size for editing.

use super::paint;
use crate::geom::{Affine, Point, Rect};
use crate::interp::fonts::LoadedFont;
use crate::interp::{GState, ShowEvent};
use crate::model::{BlendMode, GlyphRun, Paint, PlacedGlyph, Stroke, TextAlign, TextNode};
use crate::pdf::Resolve;
use std::sync::Arc;

/// Glyphs further apart than this (in ems) have a space between them.
const WORD_GAP: f64 = 0.25;
/// Baselines further apart than this (in sizes) are separate lines.
const LINE_GAP: f64 = 0.3;

/// A run being collected.
struct Run {
    font: Arc<LoadedFont>,
    size: f64,
    /// Glyph space to page space at the first glyph.
    trm: Affine,
    glyphs: Vec<PlacedGlyph>,
    fill: Option<Paint>,
    stroke: Option<Stroke>,
    render: u8,
    char_spacing: f64,
    leading: f64,
    opacity: f32,
    blend: BlendMode,
}

/// A text block being read.
pub struct TextBlock {
    gs: GState,
    runs: Vec<Run>,
    /// Glyphs the model can't keep as text (Type 3 fonts, pattern paints).
    raw: bool,
    /// Where the glyphs are, in page space.
    bounds: Option<Rect>,
}

/// What a text block reads as.
pub enum Finished {
    /// Nothing was shown.
    Empty,
    /// Content drawn as the file draws it, with its page-space bounds.
    Raw(Rect),
    /// Text.
    Text {
        /// The text.
        node: TextNode,
        /// Text space to canvas.
        transform: Affine,
        /// Opacity.
        opacity: f32,
        /// Blend mode.
        blend: BlendMode,
    },
}

impl TextBlock {
    /// A block starting in `gs`.
    pub fn new(gs: &GState) -> TextBlock {
        TextBlock {
            gs: gs.clone(),
            runs: Vec::new(),
            raw: false,
            bounds: None,
        }
    }

    /// The state the block started in.
    pub fn gs(&self) -> &GState {
        &self.gs
    }

    /// Glyphs shown.
    pub fn show(&mut self, pdf: &dyn Resolve, e: &ShowEvent<'_>) {
        let t = &e.gs.text;
        if e.font.type3.is_some() {
            self.raw = true;
        }
        let resources = e.resources.dict();
        let fills = matches!(t.render, 0 | 2 | 4 | 6);
        let strokes = matches!(t.render, 1 | 2 | 5 | 6);
        let fill = if fills {
            match paint::paint(pdf, &e.gs.fill, e.gs, resources) {
                Some(p) => Some(p),
                None => {
                    self.raw = true;
                    None
                }
            }
        } else {
            None
        };
        let stroke = if strokes {
            match paint::stroke(pdf, e.gs, resources) {
                Some(s) => Some(s),
                None => {
                    self.raw = true;
                    None
                }
            }
        } else {
            None
        };
        let em = (t.size * t.h_scale).abs().max(1e-9);
        for g in &e.glyphs {
            let advance = g.advance / em;
            // Glyph box, roughly: ascent 0.9 em, descent 0.25 em.
            let b = Rect::new(0.0, -0.25, advance.max(0.3), 0.9).transform(&g.trm);
            self.bounds = Some(self.bounds.map_or(b, |a| a.union(&b)));
            let glyph = |x: f64| PlacedGlyph {
                code: g.code,
                len: g.len,
                x,
                advance,
                text: g.text.clone(),
            };
            if let Some(run) = self.runs.last_mut()
                && Arc::ptr_eq(&run.font, e.font)
                && run.size == t.size
                && run.fill == fill
                && run.stroke == stroke
                && run.render == t.render
                && let Some(inv) = run.trm.invert()
            {
                let at = inv.apply(Point::new(g.trm.0[4], g.trm.0[5]));
                // Same baseline and the same glyph scale.
                let same_scale = (0..4)
                    .all(|k| (run.trm.0[k] - g.trm.0[k]).abs() < 1e-6 * (1.0 + run.trm.0[k].abs()));
                if at.y.abs() < 0.01 && same_scale {
                    run.glyphs.push(glyph(at.x));
                    continue;
                }
            }
            self.runs.push(Run {
                font: e.font.clone(),
                size: t.size,
                trm: g.trm,
                glyphs: vec![glyph(0.0)],
                fill: fill.clone(),
                stroke: stroke.clone(),
                render: t.render,
                char_spacing: t.char_spacing,
                leading: t.leading,
                opacity: if fills || !strokes {
                    e.gs.fill_alpha
                } else {
                    e.gs.stroke_alpha
                },
                blend: e.gs.blend,
            });
        }
    }

    /// The block as text (or raw content, or nothing).
    pub fn finish(&self, to_canvas: Affine) -> Finished {
        let Some(first) = self.runs.first() else {
            return Finished::Empty;
        };
        if self.raw {
            return Finished::Raw(self.bounds.unwrap_or_default());
        }
        let size = if first.size.abs() > 1e-9 {
            first.size.abs()
        } else {
            1.0
        };
        // Text space: the first glyph's, at unit size, y down.
        let unit = Affine::scale(1.0 / size, 1.0 / size).followed_by(&first.trm);
        let transform = Affine::scale(1.0, -1.0)
            .followed_by(&unit)
            .followed_by(&to_canvas);
        let Some(inv) = transform.invert() else {
            return Finished::Raw(self.bounds.unwrap_or_default());
        };
        let mut text = String::new();
        let mut runs = Vec::new();
        let mut baselines: Vec<f64> = Vec::new();
        let mut prev_end: Option<Point> = None;
        for run in &self.runs {
            let matrix = run.trm.followed_by(&to_canvas).followed_by(&inv);
            let origin = matrix.apply(Point::default());
            if let Some(end) = prev_end {
                if (origin.y - end.y).abs() > LINE_GAP * size {
                    text.push('\n');
                    baselines.push(origin.y);
                } else if origin.x - end.x > WORD_GAP * size && !ends_with_space(&text) {
                    text.push(' ');
                }
            } else {
                baselines.push(origin.y);
            }
            let mut last: Option<&PlacedGlyph> = None;
            for g in &run.glyphs {
                if let Some(l) = last
                    && g.x - (l.x + l.advance) > WORD_GAP
                    && !ends_with_space(&text)
                    && !g.text.starts_with(' ')
                {
                    text.push(' ');
                }
                text.push_str(&g.text);
                last = Some(g);
            }
            if let Some(l) = last {
                prev_end = Some(matrix.apply(Point::new(l.x + l.advance, 0.0)));
            }
            runs.push(GlyphRun {
                font: run.font.key.clone(),
                size: run.size,
                matrix,
                glyphs: run.glyphs.clone(),
                fill: run.fill.clone(),
                stroke: run.stroke.clone(),
            });
        }
        let line_height = if baselines.len() > 1 {
            let spans: f64 = baselines.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
            spans / (baselines.len() - 1) as f64 / size
        } else if first.leading > 0.0 {
            first.leading / size
        } else {
            1.2
        };
        let (family, style) = fig_engine::text::family_and_style(first.font.font.name());
        Finished::Text {
            node: TextNode {
                text,
                family,
                style,
                size,
                fill: first.fill.clone(),
                stroke: first.stroke.clone(),
                align: TextAlign::Left,
                line_height,
                tracking: first.char_spacing / size * 1000.0,
                width: None,
                runs: Some(runs),
            },
            transform,
            opacity: first.opacity,
            blend: first.blend,
        }
    }
}

fn ends_with_space(s: &str) -> bool {
    s.is_empty() || s.ends_with(' ') || s.ends_with('\n')
}
