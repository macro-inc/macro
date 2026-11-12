//! A document summarized for AI agents and search: the canvas, the layer
//! tree with each layer's kind and settings, and the text of text layers.

use crate::model::{Document, LayerIdx, LayerKind};
use std::fmt::Write;

/// The layer tree as indented lines, top to bottom, with text content.
pub fn outline(doc: &Document, max_chars: usize) -> String {
    let mut out = String::new();
    let mode = format!("{:?}", doc.mode);
    let _ = writeln!(
        out,
        "Photoshop document: {} × {} px, {} {}-bit, {} ppi, {} layers",
        doc.width,
        doc.height,
        mode,
        doc.depth,
        doc.resolution.round(),
        doc.layers.iter().filter(|l| !l.removed).count()
    );
    out.push_str("Layers (top to bottom):\n");
    for (i, depth) in doc.panel_order() {
        if out.len() > max_chars {
            out.push_str("… (more layers not shown)\n");
            break;
        }
        line(doc, i, depth, &mut out);
    }
    out
}

fn line(doc: &Document, i: LayerIdx, depth: usize, out: &mut String) {
    let l = doc.layer(i);
    let indent = "  ".repeat(depth + 1);
    let kind = match &l.kind {
        LayerKind::Pixel => "pixels".to_string(),
        LayerKind::Group { .. } => "group".to_string(),
        LayerKind::Text { .. } => "text".to_string(),
        LayerKind::Fill { .. } if l.vector_mask.is_some() => "shape".to_string(),
        LayerKind::Fill { .. } => "fill".to_string(),
        LayerKind::Adjustment { adjustment } => format!("adjustment: {}", adjustment.label()),
        LayerKind::SmartObject { object } => match &object.file_name {
            Some(n) => format!("smart object: {n}"),
            None => "smart object".to_string(),
        },
    };
    let _ = write!(out, "{indent}- [{kind}] \"{}\" (id {})", l.name, l.id);
    if !l.visible {
        out.push_str(", hidden");
    }
    if l.opacity < 255 {
        let _ = write!(out, ", opacity {}%", (l.opacity as f32 / 2.55).round());
    }
    if l.blend != crate::model::BlendMode::Normal && l.blend != crate::model::BlendMode::PassThrough
    {
        let _ = write!(out, ", {}", l.blend.label());
    }
    if let Some(b) = crate::render::visual_bounds(doc, i)
        && !l.is_group()
    {
        let _ = write!(out, ", at {},{} size {}×{}", b.x, b.y, b.w, b.h);
    }
    if let LayerKind::Text { text } = &l.kind {
        let shown: String = text.text.replace(['\r', '\u{3}'], "\n");
        let first = text.runs.first().map(|r| &r.style);
        if let Some(s) = first {
            let _ = write!(out, ", {} {}pt {}", s.font, s.size.round(), s.color.hex());
        }
        let _ = write!(out, ": \"{}\"", shown.trim());
    }
    out.push('\n');
}

/// The searchable text of a document: layer names and the text of text
/// layers, one per line.
pub fn text(doc: &Document) -> String {
    let mut out = String::new();
    for (i, _) in doc.panel_order() {
        let l = doc.layer(i);
        match &l.kind {
            LayerKind::Text { text } => {
                let _ = writeln!(out, "{}", text.text.replace(['\r', '\u{3}'], "\n").trim());
            }
            _ => {
                let _ = writeln!(out, "{}", l.name);
            }
        }
    }
    out
}
