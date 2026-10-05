//! Laying out text the editor changed. Text read from a file keeps the
//! glyphs the file placed until its characters, font, or size change; then
//! it is laid out here with the shared font registry (`fig_engine::text`):
//! point text breaks lines at returns, area text also wraps at its width;
//! lines are `line_height` sizes apart, tracking and pair kerning space the
//! characters, and alignment is around the anchor (point text) or within
//! the width (area text).

use crate::geom::{Affine, PathData, Point, Rect};
use crate::model::{TextAlign, TextNode};
use fig_engine::text::{Font, FontGlyph};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// Ascent and descent of glyph boxes for text from files, in ems.
const BOX_ASCENT: f64 = 0.9;
const BOX_DESCENT: f64 = 0.25;

thread_local! {
    static FONTS: RefCell<HashMap<(String, String), Rc<Font>>> = RefCell::new(HashMap::new());
}

/// The font for a family and style (set up once).
pub fn font(family: &str, style: &str) -> Rc<Font> {
    FONTS.with(|f| {
        f.borrow_mut()
            .entry((family.to_string(), style.to_string()))
            .or_insert_with(|| Rc::new(Font::new(family, style)))
            .clone()
    })
}

/// Forgets set-up fonts (after fonts are registered).
pub fn clear_fonts() {
    FONTS.with(|f| f.borrow_mut().clear());
}

/// A glyph placed in text space (y down; the first baseline at y = 0).
#[derive(Clone, Copy, Debug)]
pub struct Placed {
    /// The glyph.
    pub glyph: FontGlyph,
    /// Its origin on the baseline.
    pub x: f64,
    /// The baseline.
    pub y: f64,
    /// Index of the character (in `char`s) it shows.
    pub index: usize,
}

/// A laid-out line.
#[derive(Clone, Copy, Debug)]
pub struct Line {
    /// Its left edge.
    pub x0: f64,
    /// Its right edge.
    pub x1: f64,
    /// Its baseline.
    pub baseline: f64,
    /// The first character on it (in `char`s).
    pub start: usize,
    /// One past its last character.
    pub end: usize,
}

/// Laid-out text.
pub struct Layout {
    /// The font.
    pub font: Rc<Font>,
    /// The glyphs.
    pub glyphs: Vec<Placed>,
    /// The lines.
    pub lines: Vec<Line>,
    /// Ascent and descent (positive), in text units.
    pub ascent: f64,
    /// Descent below the baseline (positive), in text units.
    pub descent: f64,
}

struct Word {
    glyphs: Vec<(FontGlyph, f64, usize)>,
    width: f64,
    space_after: Option<(FontGlyph, f64, usize)>,
}

/// Lays out text without the file's glyphs.
pub fn layout(t: &TextNode) -> Layout {
    let font = font(&t.family, &t.style);
    let size = t.size.max(0.01);
    let track = t.tracking / 1000.0 * size;
    let (ascent, descent, _) = font.metrics();
    let advance = |g: FontGlyph| f64::from(font.advance(g)) * size + track;
    let mut glyphs = Vec::new();
    let mut lines = Vec::new();
    let mut index = 0usize;
    let mut baseline = 0.0;
    let step = t.line_height.max(0.1) * size;
    for (n, paragraph) in t.text.split('\n').enumerate() {
        if n > 0 {
            index += 1; // the return
        }
        // Words with their trailing space.
        let mut words: Vec<Word> = Vec::new();
        let mut current = Word {
            glyphs: Vec::new(),
            width: 0.0,
            space_after: None,
        };
        let mut prev: Option<FontGlyph> = None;
        for c in paragraph.chars() {
            let g = font.glyph(c);
            let kern = prev.map_or(0.0, |p| f64::from(font.kerning(p, g)) * size);
            if c == ' ' || c == '\t' {
                current.space_after = Some((g, advance(g) + kern, index));
                words.push(std::mem::replace(
                    &mut current,
                    Word {
                        glyphs: Vec::new(),
                        width: 0.0,
                        space_after: None,
                    },
                ));
            } else {
                let w = advance(g) + kern;
                current.glyphs.push((g, w, index));
                current.width += w;
            }
            prev = Some(g);
            index += 1;
        }
        words.push(current);

        // Fill lines.
        let mut line: Vec<(FontGlyph, f64, usize)> = Vec::new();
        let mut line_width = 0.0;
        let mut start = index - paragraph.chars().count();
        let flush = |line: &mut Vec<(FontGlyph, f64, usize)>,
                     width: f64,
                     start: usize,
                     end: usize,
                     baseline: f64,
                     glyphs: &mut Vec<Placed>,
                     lines: &mut Vec<Line>| {
            // Trailing spaces don't count toward alignment.
            let mut visible = width;
            for &(_, w, i) in line.iter().rev() {
                if paragraph_char_is_space(&t.text, i) {
                    visible -= w;
                } else {
                    break;
                }
            }
            let x0 = match (t.align, t.width) {
                (TextAlign::Left, _) => 0.0,
                (TextAlign::Center, Some(w)) => (w - visible) / 2.0,
                (TextAlign::Center, None) => -visible / 2.0,
                (TextAlign::Right, Some(w)) => w - visible,
                (TextAlign::Right, None) => -visible,
            };
            let mut x = x0;
            for &(g, w, i) in line.iter() {
                glyphs.push(Placed {
                    glyph: g,
                    x,
                    y: baseline,
                    index: i,
                });
                x += w;
            }
            lines.push(Line {
                x0,
                x1: x0 + visible,
                baseline,
                start,
                end,
            });
            line.clear();
        };
        for word in words {
            if let Some(limit) = t.width
                && !line.is_empty()
                && line_width + word.width > limit
            {
                let end = line.last().map_or(start, |&(_, _, i)| i + 1);
                flush(
                    &mut line,
                    line_width,
                    start,
                    end,
                    baseline,
                    &mut glyphs,
                    &mut lines,
                );
                baseline += step;
                line_width = 0.0;
                start = word.glyphs.first().map_or(end, |&(_, _, i)| i);
            }
            line_width += word.width;
            line.extend(word.glyphs);
            if let Some(space) = word.space_after {
                line_width += space.1;
                line.push(space);
            }
        }
        flush(
            &mut line,
            line_width,
            start,
            index,
            baseline,
            &mut glyphs,
            &mut lines,
        );
        baseline += step;
    }
    Layout {
        font,
        glyphs,
        lines,
        ascent: f64::from(ascent) * size,
        descent: f64::from(-descent) * size,
    }
}

fn paragraph_char_is_space(text: &str, i: usize) -> bool {
    text.chars().nth(i).is_some_and(|c| c == ' ' || c == '\t')
}

/// The glyph outlines of laid-out text, in text space.
pub fn outlines(t: &TextNode) -> PathData {
    let l = layout(t);
    let size = t.size.max(0.01);
    let mut out = PathData::default();
    for p in &l.glyphs {
        if let Some(path) = l.font.path(p.glyph) {
            // Em units, y up, to text space, y down.
            let m = Affine([size, 0.0, 0.0, -size, p.x, p.y]);
            out.segs
                .extend(PathData::from_skia(&path).transform(&m).segs);
        }
    }
    out
}

/// Where text's glyphs are, in text space.
pub fn bounds(t: &TextNode) -> Option<Rect> {
    if let Some(runs) = &t.runs {
        let mut out: Option<Rect> = None;
        for run in runs {
            for g in &run.glyphs {
                let b = Rect::new(g.x, -BOX_DESCENT, g.x + g.advance.max(0.3), BOX_ASCENT)
                    .transform(&run.matrix);
                out = Some(out.map_or(b, |o| o.union(&b)));
            }
        }
        return out;
    }
    let l = layout(t);
    l.lines
        .iter()
        .map(|line| {
            Rect::new(
                line.x0,
                line.baseline - l.ascent,
                line.x1.max(line.x0 + 1.0),
                line.baseline + l.descent,
            )
        })
        .reduce(|a, b| a.union(&b))
        .map(|r| match t.width {
            Some(w) => r.union(&Rect::new(0.0, r.y0, w, r.y1)),
            None => r,
        })
}

/// The character nearest a point in text space (for placing the caret).
pub fn hit(t: &TextNode, p: Point) -> usize {
    let l = layout(t);
    let Some(line) = l.lines.iter().min_by(|a, b| {
        (a.baseline - l.ascent / 2.0 - p.y)
            .abs()
            .total_cmp(&(b.baseline - l.ascent / 2.0 - p.y).abs())
    }) else {
        return 0;
    };
    let mut best = line.start;
    let mut best_d = f64::INFINITY;
    for g in l
        .glyphs
        .iter()
        .filter(|g| g.index >= line.start && g.index < line.end)
    {
        let d = (g.x - p.x).abs();
        if d < best_d {
            best_d = d;
            best = g.index;
        }
    }
    if (line.x1 - p.x).abs() < best_d {
        best = line.end;
    }
    best
}

#[cfg(test)]
mod test;
