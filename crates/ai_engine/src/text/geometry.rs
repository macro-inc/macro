//! Where a text object's caret can stand, for the editor's type tool: each
//! laid-out line's box and the caret's x before every character, counted in
//! UTF-16 units as the browser's text input counts them.
//!
//! Text still shown with the glyphs the file placed is measured as it will
//! be laid out once edited (the first change lays it out here).

use super::layout;
use crate::geom::Affine;
use crate::model::TextNode;
use serde::Serialize;

/// A laid-out line as the caret moves along it (text space, y down).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaretLine {
    /// Its first character (UTF-16 units).
    pub start: usize,
    /// One past its last character, its line break included.
    pub end: usize,
    /// The top of the line's box.
    pub top: f64,
    /// The height of the line's box.
    pub height: f64,
    /// The baseline.
    pub baseline: f64,
    /// The caret's x before each character `start..=end`.
    pub xs: Vec<f64>,
}

/// The lines of a text object and where it is on the canvas.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextGeometry {
    /// Text space to canvas.
    pub transform: Affine,
    /// The lines, top to bottom.
    pub lines: Vec<CaretLine>,
    /// The text's length in UTF-16 units.
    pub length: usize,
}

/// The caret geometry of text placed on the canvas by `transform`.
pub fn geometry(t: &TextNode, transform: Affine) -> TextGeometry {
    let l = layout(t);
    let chars: Vec<char> = t.text.chars().collect();
    // UTF-16 offset of each character, and of the end.
    let mut utf16 = Vec::with_capacity(chars.len() + 1);
    let mut at = 0;
    for c in &chars {
        utf16.push(at);
        at += c.len_utf16();
    }
    utf16.push(at);
    let mut lines = Vec::with_capacity(l.lines.len());
    for (k, line) in l.lines.iter().enumerate() {
        // A line runs to where the next begins: past its line break, or to
        // the first character a wrap moved down.
        let end = l
            .lines
            .get(k + 1)
            .map_or(chars.len(), |next| next.start.max(line.end))
            .min(chars.len());
        let start = line.start.min(end);
        let mut stops: Vec<Option<f64>> = vec![None; end - start + 1];
        let mut pen_after: Vec<Option<f64>> = vec![None; end - start + 1];
        for g in l
            .glyphs
            .iter()
            .filter(|g| g.index >= start && g.index < line.end)
        {
            stops[g.index - start] = Some(g.x);
            pen_after[g.index - start] = Some(g.x + g.advance);
        }
        let mut xs = Vec::with_capacity(utf16[end] - utf16[start] + 1);
        let mut pen = line.x0;
        for (offset, stop) in stops.iter().enumerate() {
            let x = stop.unwrap_or(pen);
            if let Some(after) = pen_after[offset] {
                pen = after;
            }
            let index = start + offset;
            xs.push(x);
            // Both halves of a surrogate pair stand before the character.
            if index < end && chars[index].len_utf16() == 2 {
                xs.push(x);
            }
        }
        lines.push(CaretLine {
            start: utf16[start],
            end: utf16[end],
            top: line.baseline - l.ascent,
            height: l.ascent + l.descent,
            baseline: line.baseline,
            xs,
        });
    }
    TextGeometry {
        transform,
        lines,
        length: utf16[chars.len()],
    }
}

#[cfg(test)]
mod test;
