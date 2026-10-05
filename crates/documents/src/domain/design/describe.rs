//! A compact, model-readable description of a design: pages, their
//! top-level frames with text and the components they use, and the file's
//! components, styles, and variables.

use fig_engine::Document;
use fig_engine::describe::{DesignOutline, FrameOutline, OutlineOptions, outline};
use std::fmt::Write as _;

/// Roughly the longest description returned; ask for specific pages beyond.
const MAX_CHARS: usize = 60_000;

/// `text` as a quoted string (newlines and quotes escaped).
fn quote(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}

/// Whole points as integers, others with one decimal.
fn number(v: f64) -> String {
    if (v - v.round()).abs() < 0.05 {
        format!("{}", v.round() as i64)
    } else {
        format!("{v:.1}")
    }
}

fn frame_lines(out: &mut String, frame: &FrameOutline, depth: usize) {
    let pad = "  ".repeat(depth);
    let _ = writeln!(
        out,
        "{pad}{} {} (id {}, {}×{} at {}, {})",
        frame.node_type.label(),
        quote(&frame.name),
        frame.id,
        number(frame.width),
        number(frame.height),
        number(frame.x),
        number(frame.y),
    );
    for text in &frame.texts {
        let repeats = if text.count > 1 {
            format!(" ×{}", text.count)
        } else {
            String::new()
        };
        let _ = writeln!(
            out,
            "{pad}  text {}{repeats} (layer {}, id {})",
            quote(&text.characters),
            quote(&text.name),
            text.id
        );
    }
    if !frame.components.is_empty() {
        let used: Vec<String> = frame
            .components
            .iter()
            .map(|c| match c.count {
                1 => c.name.clone(),
                n => format!("{} ×{n}", c.name),
            })
            .collect();
        let _ = writeln!(out, "{pad}  instances: {}", used.join(", "));
    }
    for inner in &frame.frames {
        frame_lines(out, inner, depth + 1);
    }
}

fn write_outline(out: &mut String, design: &DesignOutline) {
    let _ = writeln!(
        out,
        "Design: {} ({} page{})",
        design
            .file_name
            .as_deref()
            .map(quote)
            .unwrap_or_else(|| "untitled".into()),
        design.page_count,
        if design.page_count == 1 { "" } else { "s" }
    );
    for page in &design.pages {
        let _ = writeln!(
            out,
            "\nPage {} {} (id {})",
            page.number,
            quote(&page.name),
            page.id
        );
        if page.frames.is_empty() {
            let _ = writeln!(out, "  (empty)");
        }
        for frame in &page.frames {
            frame_lines(out, frame, 1);
        }
    }
    if !design.components.is_empty() {
        let _ = writeln!(out, "\nComponents:");
        for c in &design.components {
            let kind = if c.is_set {
                "component set"
            } else {
                "component"
            };
            let _ = write!(
                out,
                "  {} ({kind}, id {}, {}×{}, page {})",
                quote(&c.name),
                c.id,
                number(c.width),
                number(c.height),
                quote(&c.page)
            );
            if let Some(description) = &c.description {
                let _ = write!(out, ": {}", quote(description));
            }
            let _ = writeln!(out);
            for v in &c.variant_properties {
                let _ = writeln!(
                    out,
                    "    variant property {}: {}",
                    quote(&v.name),
                    v.values.join(" | ")
                );
            }
            if !c.variants.is_empty() {
                let _ = writeln!(out, "    variants: {}", c.variants.join("; "));
            }
            for p in &c.properties {
                let default = p
                    .default
                    .as_deref()
                    .map(|d| format!(", default {}", quote(d)))
                    .unwrap_or_default();
                let _ = writeln!(out, "    property {} ({}{default})", quote(&p.name), p.kind);
            }
        }
    }
    if !design.styles.is_empty() {
        let _ = writeln!(out, "\nStyles:");
        for s in &design.styles {
            let remote = if s.remote { ", from a library" } else { "" };
            let description = s
                .description
                .as_deref()
                .filter(|d| !d.trim().is_empty())
                .map(|d| format!(": {}", quote(d)))
                .unwrap_or_default();
            let _ = writeln!(
                out,
                "  {} {}{remote}{description}",
                s.style_type,
                quote(&s.name)
            );
        }
    }
    if !design.variables.is_empty() {
        let _ = writeln!(out, "\nVariables:");
        for c in &design.variables {
            let remote = if c.remote { ", from a library" } else { "" };
            let _ = writeln!(
                out,
                "  collection {} (modes: {}{remote})",
                quote(&c.name),
                c.modes.join(", ")
            );
            for v in &c.variables {
                let _ = writeln!(out, "    {} {}", v.kind, quote(&v.name));
            }
        }
    }
    if design.truncated {
        let _ = writeln!(
            out,
            "\n(Truncated: pass page numbers to read the rest of the design.)"
        );
    }
}

/// Describes `doc` (or the given 1-based pages) for a model to read.
pub fn describe(doc: &Document, pages: Option<Vec<usize>>) -> String {
    let missing: Vec<String> = pages
        .iter()
        .flatten()
        .filter(|&&n| n == 0 || n > doc.pages.len())
        .map(usize::to_string)
        .collect();
    let design = outline(
        doc,
        &OutlineOptions {
            pages,
            max_chars: MAX_CHARS,
        },
    );
    let mut out = String::new();
    write_outline(&mut out, &design);
    if !missing.is_empty() {
        let _ = writeln!(
            out,
            "\n(No page {}: pages are numbered 1 to {}.)",
            missing.join(", "),
            design.page_count
        );
    }
    out
}
