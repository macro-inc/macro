//! A document summarized for AI agents and search: the artboards, the
//! layer tree with each object's kind, place, and paint, and the text.

use crate::build::node_bounds;
use crate::model::{Document, NodeIdx, NodeKind, Paint};
use std::fmt::Write;

/// A paint in a few words.
fn paint_words(p: &Paint) -> String {
    match p {
        Paint::Solid { color } => color.hex(),
        Paint::Gradient { gradient } => format!(
            "{} gradient {}",
            if gradient.radial { "radial" } else { "linear" },
            gradient
                .stops
                .iter()
                .map(|s| s.color.hex())
                .collect::<Vec<_>>()
                .join("→")
        ),
    }
}

/// The document as indented lines, top to bottom.
pub fn outline(doc: &Document, max_chars: usize) -> String {
    let mut out = String::new();
    let artboards: Vec<_> = doc.artboards.iter().filter(|a| !a.removed).collect();
    let _ = writeln!(
        out,
        "Illustrator document: {} artboard{}, {} layer{}",
        artboards.len(),
        if artboards.len() == 1 { "" } else { "s" },
        doc.layers.iter().filter(|&&l| !doc.node(l).removed).count(),
        if doc.layers.len() == 1 { "" } else { "s" },
    );
    for a in &artboards {
        let _ = writeln!(
            out,
            "- Artboard \"{}\" (id {}): at {:.0},{:.0} size {:.0}×{:.0} pt",
            a.name,
            a.id,
            a.rect.x0,
            a.rect.y0,
            a.rect.width(),
            a.rect.height()
        );
    }
    out.push_str("Layers (top to bottom):\n");
    for &l in doc.layers.iter().rev() {
        if !walk(doc, l, 1, max_chars, &mut out) {
            out.push_str("… (more objects not shown)\n");
            break;
        }
    }
    out
}

/// Writes a node and what it holds; false once the output is full.
fn walk(doc: &Document, i: NodeIdx, depth: usize, max_chars: usize, out: &mut String) -> bool {
    let n = doc.node(i);
    if n.removed {
        return true;
    }
    if out.len() > max_chars {
        return false;
    }
    let indent = "  ".repeat(depth);
    let kind = match &n.kind {
        NodeKind::Layer { .. } => "layer".to_string(),
        NodeKind::Group { clip: Some(_), .. } => "clip group".to_string(),
        NodeKind::Group { .. } => "group".to_string(),
        NodeKind::Path(_) => "path".to_string(),
        NodeKind::Text(_) => "text".to_string(),
        NodeKind::Image(img) => format!("image {}×{} px", img.width, img.height),
        NodeKind::Raw { .. } => "artwork".to_string(),
    };
    let _ = write!(out, "{indent}- [{kind}]");
    if !n.name.is_empty() {
        let _ = write!(out, " \"{}\"", n.name);
    }
    let _ = write!(out, " (id {})", n.id);
    if n.hidden {
        out.push_str(", hidden");
    }
    if n.locked {
        out.push_str(", locked");
    }
    if n.opacity < 1.0 {
        let _ = write!(out, ", opacity {:.0}%", n.opacity * 100.0);
    }
    if !n.is_layer()
        && let Some(b) = node_bounds(doc, i)
    {
        let _ = write!(
            out,
            ", at {:.0},{:.0} size {:.0}×{:.0}",
            b.x0,
            b.y0,
            b.width(),
            b.height()
        );
    }
    match &n.kind {
        NodeKind::Path(p) => {
            if let Some(f) = &p.fill {
                let _ = write!(out, ", fill {}", paint_words(f));
            }
            if let Some(s) = &p.stroke {
                let _ = write!(out, ", stroke {} {:.1}pt", paint_words(&s.paint), s.width);
            }
        }
        NodeKind::Text(t) => {
            let size = t.size * n.transform.scale_factor();
            let _ = write!(out, ", {} {} {:.0}pt", t.family, t.style, size);
            if let Some(f) = &t.fill {
                let _ = write!(out, " {}", paint_words(f));
            }
            let _ = write!(out, ": \"{}\"", t.text.trim());
        }
        _ => {}
    }
    out.push('\n');
    for &c in n.children.iter().rev() {
        if !walk(doc, c, depth + 1, max_chars, out) {
            return false;
        }
    }
    true
}

/// The searchable text of a document: layer and object names and the
/// characters of text objects, one per line.
pub fn text(doc: &Document) -> String {
    let mut out = String::new();
    for i in doc.paint_order() {
        let n = doc.node(i);
        match &n.kind {
            NodeKind::Text(t) => {
                let _ = writeln!(out, "{}", t.text.trim());
            }
            _ if !n.name.is_empty() => {
                let _ = writeln!(out, "{}", n.name);
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod test;
