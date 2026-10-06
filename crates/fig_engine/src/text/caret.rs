//! Where the text editor draws its caret and selection: each line's box
//! and the x of every caret stop on it, from the layer's glyph layout
//! (Figma's or the engine's), in the layer's coordinates.

use crate::model::{Baseline, Props};
use serde::Serialize;

/// One line of text as the editor sees it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaretLine {
    /// The line's characters, UTF-16 units `start..end` (its line break
    /// included).
    pub start: u32,
    pub end: u32,
    pub top: f32,
    pub height: f32,
    pub baseline: f32,
    /// The caret's x before each character `start..=end`.
    pub xs: Vec<f32>,
}

/// A text layer's lines.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextGeometry {
    pub lines: Vec<CaretLine>,
    /// UTF-16 length of the characters.
    pub length: u32,
}

/// The caret geometry of a text layer, `None` for other layers.
pub fn geometry(props: &Props) -> Option<TextGeometry> {
    let layout = props.text_layout.as_deref()?;
    let chars = props.text_content.as_deref().map_or("", |c| &c.characters);
    let length = chars.encode_utf16().count() as u32;
    let fallback;
    let baselines: &[Baseline] = if layout.baselines.is_empty() {
        fallback = guessed_lines(props, length);
        &fallback
    } else {
        &layout.baselines
    };
    let lines = baselines
        .iter()
        .map(|b| {
            let start = b.first_char.min(length);
            let end = b.end_char.clamp(start, length);
            let on_line: Vec<_> = layout
                .glyphs
                .iter()
                .filter(|g| g.first_char >= start && g.first_char < end)
                .collect();
            let mut xs = Vec::with_capacity((end - start + 1) as usize);
            let mut right = on_line.first().map_or(b.x, |g| g.x);
            for i in start..=end {
                // Line breaks take no room: the caret before one sits after
                // the line's last glyph.
                match on_line.iter().find(|g| g.first_char == i) {
                    Some(g) => {
                        xs.push(g.x);
                        right = g.x + g.advance;
                    }
                    None => xs.push(right),
                }
            }
            CaretLine {
                start,
                end,
                top: b.line_y,
                height: b.line_height,
                baseline: b.y,
                xs,
            }
        })
        .collect();
    Some(TextGeometry { lines, length })
}

/// Lines from glyph baselines, for layouts stored without line records.
fn guessed_lines(props: &Props, length: u32) -> Vec<Baseline> {
    let Some(layout) = props.text_layout.as_deref() else {
        return Vec::new();
    };
    let mut lines: Vec<Baseline> = Vec::new();
    for g in layout.glyphs.iter() {
        match lines.last_mut() {
            Some(l) if (l.y - g.y).abs() < 0.5 => {
                l.line_height = l.line_height.max(g.font_size * 1.2);
            }
            _ => lines.push(Baseline {
                first_char: g.first_char,
                x: g.x,
                y: g.y,
                line_height: g.font_size * 1.2,
                line_ascent: g.font_size * 0.95,
                ..Baseline::default()
            }),
        }
    }
    if lines.is_empty() {
        let size = props
            .text_style
            .as_deref()
            .and_then(|s| s.font_size)
            .unwrap_or(12.0);
        lines.push(Baseline {
            y: size * 0.95,
            line_height: size * 1.2,
            line_ascent: size * 0.95,
            ..Baseline::default()
        });
    }
    lines[0].first_char = 0;
    for k in 0..lines.len() {
        let end = lines.get(k + 1).map_or(length, |n| n.first_char);
        let l = &mut lines[k];
        l.end_char = end;
        l.line_y = l.y - l.line_ascent;
    }
    lines
}
