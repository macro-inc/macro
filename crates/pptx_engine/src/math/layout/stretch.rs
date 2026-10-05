//! Stretchy glyphs: a size variant big enough, or an assembly of parts.

use super::{Env, MathBox, MathGlyph, MathItem};
use crate::font::FontChoice;
use crate::model::fill::Fill;

/// A stretched glyph and its italic correction (both in points).
pub(super) struct Stretched {
    pub bx: MathBox,
    /// The glyph's own italic correction.
    pub italic: f32,
    /// The glyph chosen when it is a single glyph (for accent attachment).
    pub glyph: Option<u16>,
    /// Top of the ink above the baseline (points).
    pub top: f32,
    /// Bottom of the ink above the baseline (points; negative below it).
    pub bottom: f32,
}

impl Env<'_> {
    /// `c` from the math font, at least `target` points tall (height plus
    /// depth) or wide (`vertical == false`), at `em` points per em. Without
    /// a big enough variant the glyph is assembled from parts; without
    /// either it is the plain glyph.
    pub(super) fn stretch(
        &self,
        c: char,
        target: f32,
        vertical: bool,
        em: f32,
        fill: &Fill,
    ) -> Stretched {
        let Some((choice, base)) = self.math_glyph(c) else {
            return Stretched {
                bx: MathBox::space(0.5 * em, 0.7 * em, 0.2 * em),
                italic: 0.0,
                glyph: None,
                top: 0.7 * em,
                bottom: -0.2 * em,
            };
        };
        let in_math = Some(choice.face) == self.math.face;
        let construction = if in_math {
            self.math.construction(base, vertical)
        } else {
            Default::default()
        };
        let mut pick = base;
        for v in &construction.variants {
            pick = v.glyph;
            if v.advance * em >= target {
                return self.variant(choice, pick, em, fill);
            }
        }
        if !construction.assembly.is_empty() {
            return self.assemble(choice, &construction.assembly, target, vertical, em, fill);
        }
        self.variant(choice, pick, em, fill)
    }

    fn variant(&self, choice: FontChoice, glyph: u16, em: f32, fill: &Fill) -> Stretched {
        let mut bx = self.glyph_box(choice, glyph, em, fill);
        let italic = self.math.italic_correction(glyph).unwrap_or(0.0) * em;
        bx.italic = italic;
        let ink = self.ink(choice.face, glyph);
        Stretched {
            bx,
            italic,
            glyph: Some(glyph),
            top: ink.top * em,
            bottom: -ink.bottom * em,
        }
    }

    /// Builds a glyph from parts (bottom to top, or left to right), with as
    /// few extender copies as reach `target`, overlaps shared evenly.
    fn assemble(
        &self,
        choice: FontChoice,
        parts: &[super::super::font::Part],
        target: f32,
        vertical: bool,
        em: f32,
        fill: &Fill,
    ) -> Stretched {
        let min_overlap = self.c.min_connector_overlap;
        let target = target / em;
        let mut repeats = 0usize;
        let sequence = |n: usize| -> Vec<super::super::font::Part> {
            parts
                .iter()
                .flat_map(|p| std::iter::repeat_n(*p, if p.extender { n } else { 1 }))
                .collect()
        };
        let (seq, overlap) = loop {
            let seq = sequence(repeats);
            let full: f32 = seq.iter().map(|p| p.full_advance).sum();
            let joints = seq.len().saturating_sub(1) as f32;
            let max_size = full - joints * min_overlap;
            if max_size >= target || repeats > 64 || !parts.iter().any(|p| p.extender) {
                // The largest overlap every joint allows.
                let max_overlap = seq
                    .windows(2)
                    .map(|w| w[0].end_connector.min(w[1].start_connector))
                    .fold(f32::INFINITY, f32::min)
                    .max(min_overlap);
                let overlap = if joints > 0.0 {
                    ((full - target) / joints).clamp(min_overlap, max_overlap)
                } else {
                    0.0
                };
                break (seq, overlap);
            }
            repeats += 1;
        };
        let mut bx = MathBox::default();
        let mut offset = 0.0f32;
        let (mut top, mut bottom) = (f32::MIN, f32::MAX);
        for p in &seq {
            let ink = self.ink(choice.face, p.glyph);
            let (x, y) = if vertical {
                (0.0, -offset * em)
            } else {
                (offset * em, 0.0)
            };
            bx.items.push(MathItem::Glyph(MathGlyph {
                face: choice.face,
                glyph: p.glyph,
                size: em,
                x,
                y,
                fill: fill.clone(),
                synthetic_bold: false,
                synthetic_italic: false,
            }));
            if vertical {
                bx.width = bx.width.max(ink.advance * em);
                top = top.max((ink.top + offset) * em);
                bottom = bottom.min((offset - ink.bottom) * em);
            } else {
                top = top.max(ink.top * em);
                bottom = bottom.min(-ink.bottom * em);
            }
            offset += p.full_advance - overlap;
        }
        let total = offset + overlap;
        if !vertical {
            bx.width = total * em;
        }
        if seq.is_empty() {
            (top, bottom) = (0.0, 0.0);
        }
        bx.ascent = top.max(0.0);
        bx.descent = (-bottom).max(0.0);
        Stretched {
            bx,
            italic: 0.0,
            glyph: None,
            top,
            bottom,
        }
    }
}
