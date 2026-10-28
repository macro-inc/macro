//! The colors a page uses, for the color picker's "On this page" swatches.

use crate::document::Document;
use crate::model::{Color, PaintKind};
use crate::scene::{Scene, SceneIdx};
use std::collections::HashMap;

/// `RRGGBB` (with `AA` when translucent) for a color.
fn swatch(c: Color) -> String {
    let a = (c.a.clamp(0.0, 1.0) * 255.0).round() as u8;
    if a == 255 {
        c.hex()
    } else {
        format!("{}{a:02X}", c.hex())
    }
}

/// The distinct solid colors of the page's visible fills and strokes, most
/// used first (ties in page order), at most `limit` of them.
pub fn page_colors(doc: &Document, scene: &Scene, limit: usize) -> Vec<String> {
    let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
    for i in 1..scene.nodes.len() as SceneIdx {
        let props = scene.props(doc, i);
        for paint in props.fills().iter().chain(props.strokes().iter()) {
            if !paint.visible {
                continue;
            }
            if let PaintKind::Solid(c) = paint.kind {
                let order = counts.len();
                counts.entry(swatch(c)).or_insert((0, order)).0 += 1;
            }
        }
    }
    let mut colors: Vec<(String, (usize, usize))> = counts.into_iter().collect();
    colors.sort_by(|a, b| b.1.0.cmp(&a.1.0).then(a.1.1.cmp(&b.1.1)));
    colors.into_iter().take(limit).map(|(c, _)| c).collect()
}

#[cfg(test)]
mod test;
