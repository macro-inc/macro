//! A compact, model-readable description of a presentation: every slide's
//! shapes with their ids, kinds, positions, text, and tables.

use pptx_engine::Presentation;
use pptx_engine::inspect::{ChartOutline, ShapeKindName, ShapeOutline, SlideOutline, TableOutline};
use std::fmt::Write as _;

/// Longest description returned; ask for specific slides beyond this.
const MAX_CHARS: usize = 60_000;
/// Longest single text value quoted.
const MAX_TEXT: usize = 1_500;

fn quote(text: &str) -> String {
    let shown: String = text
        .replace('\u{b}', "\\v")
        .chars()
        .take(MAX_TEXT)
        .collect();
    let ellipsis = if text.chars().count() > MAX_TEXT {
        "…"
    } else {
        ""
    };
    format!("\"{}{ellipsis}\"", shown.replace('"', "\\\""))
}

fn kind_name(kind: ShapeKindName) -> &'static str {
    match kind {
        ShapeKindName::Text => "text",
        ShapeKindName::Shape => "shape",
        ShapeKindName::Connector => "line",
        ShapeKindName::Picture => "picture",
        ShapeKindName::Table => "table",
        ShapeKindName::Chart => "chart",
        ShapeKindName::Diagram => "SmartArt",
        ShapeKindName::Object => "embedded object",
        ShapeKindName::Group => "group",
        ShapeKindName::Other => "other",
    }
}

fn shape(out: &mut String, s: &ShapeOutline, depth: usize) {
    let pad = "  ".repeat(depth);
    let placeholder = s
        .placeholder
        .as_deref()
        .map(|p| format!(", {p} placeholder"))
        .unwrap_or_default();
    let rotation = if s.rotation != 0.0 {
        format!(" rot={:.0}°", s.rotation)
    } else {
        String::new()
    };
    let geometry = match (&s.geometry, s.kind) {
        (Some(g), ShapeKindName::Shape) => format!(" geometry={g}"),
        _ => String::new(),
    };
    let fill = s
        .fill
        .as_deref()
        .map(|f| format!(" fill={f}"))
        .unwrap_or_default();
    let hidden = if s.hidden { " hidden" } else { "" };
    let _ = writeln!(
        out,
        "{pad}- shape {} ({}{placeholder}) {} at x={:.0} y={:.0} w={:.0} h={:.0}{rotation}{geometry}{fill}{hidden}",
        s.id,
        kind_name(s.kind),
        quote(&s.name),
        s.x,
        s.y,
        s.w,
        s.h
    );
    if !s.alt_text.is_empty() {
        let _ = writeln!(out, "{pad}  alt text: {}", quote(&s.alt_text));
    }
    match s.paragraphs.as_slice() {
        [] => {}
        [only] if only.level == 0 => {
            let _ = writeln!(out, "{pad}  text: {}", quote(&only.text));
        }
        paragraphs => {
            for (i, p) in paragraphs.iter().enumerate() {
                let level = if p.level > 0 {
                    format!(" level {}", p.level)
                } else {
                    String::new()
                };
                let _ = writeln!(out, "{pad}  ¶{i}{level}: {}", quote(&p.text));
            }
        }
    }
    if let Some(table) = &s.table {
        let cols = table.column_widths.len();
        let style = table
            .style
            .as_ref()
            .map(|st| format!(", style {}", quote(&st.name)))
            .unwrap_or_default();
        let _ = writeln!(
            out,
            "{pad}  table {} rows × {cols} columns{style}:",
            table.rows.len()
        );
        for (r, row) in table.rows.iter().enumerate().take(60) {
            let width = row.len().max(table.cells.get(r).map_or(0, Vec::len));
            let cells: Vec<String> = (0..width).map(|c| table_cell(table, r, c)).collect();
            let _ = writeln!(out, "{pad}  row {r}: | {} |", cells.join(" | "));
        }
        if table.rows.len() > 60 {
            let _ = writeln!(out, "{pad}  … {} more rows", table.rows.len() - 60);
        }
    }
    if let Some(chart) = &s.chart {
        chart_lines(out, chart, &pad);
    }
    for child in &s.children {
        shape(out, child, depth + 1);
    }
}

/// A chart's type, labels, and data (what `setChartData` would rewrite).
fn chart_lines(out: &mut String, chart: &ChartOutline, pad: &str) {
    let grouping = chart
        .grouping
        .as_deref()
        .map(|g| format!(" {g}"))
        .unwrap_or_default();
    let title = chart
        .title
        .as_deref()
        .map(|t| format!(", title {}", quote(t)))
        .unwrap_or_default();
    let legend = chart
        .legend
        .as_deref()
        .map(|l| format!(", legend {l}"))
        .unwrap_or_else(|| ", no legend".to_owned());
    let labels = if chart.data_labels {
        ", data labels"
    } else {
        ""
    };
    let editable = if chart.editable {
        ""
    } else {
        " (data and type not editable)"
    };
    let _ = writeln!(
        out,
        "{pad}  chart {}{grouping}{title}{legend}{labels}{editable}",
        chart.kind
    );
    let categories: Vec<String> = chart.categories.iter().take(60).map(|c| quote(c)).collect();
    let _ = writeln!(out, "{pad}  categories: [{}]", categories.join(", "));
    for (i, series) in chart.series.iter().enumerate().take(30) {
        let values: Vec<String> = series
            .values
            .iter()
            .take(60)
            .map(|v| v.map_or_else(|| "blank".to_owned(), |v| format!("{v}")))
            .collect();
        let color = series
            .color
            .as_deref()
            .map(|c| format!(" color {c}"))
            .unwrap_or_default();
        let _ = writeln!(
            out,
            "{pad}  series {i} {}{color}: [{}]",
            quote(&series.name),
            values.join(", ")
        );
    }
}

/// One table cell for a row line: its text, how far a merged cell spans, or
/// which merged cell covers it.
fn table_cell(table: &TableOutline, r: usize, c: usize) -> String {
    let text: String = table.rows[r]
        .get(c)
        .map(|t| t.replace('\n', " / ").chars().take(80).collect())
        .unwrap_or_default();
    let Some(cell) = table.cells.get(r).and_then(|row| row.get(c)) else {
        return text;
    };
    if cell.merged {
        // The merged cell whose span covers this one (scanning up and left).
        let anchor = (0..=r)
            .rev()
            .flat_map(|ar| (0..=c).rev().map(move |ac| (ar, ac)))
            .find(|&(ar, ac)| {
                let a = &table.cells[ar][ac];
                !a.merged && ar + a.row_span > r && ac + a.col_span > c
            });
        return match anchor {
            Some((ar, ac)) => format!("{{merged into row {ar} col {ac}}}"),
            None => "{merged}".to_owned(),
        };
    }
    match (cell.row_span, cell.col_span) {
        (1, 1) => text,
        (1, n) => format!("{text} {{spans {n} columns}}"),
        (n, 1) => format!("{text} {{spans {n} rows}}"),
        (rows, cols) => format!("{text} {{spans {rows} rows × {cols} columns}}"),
    }
}

fn slide(out: &mut String, s: &SlideOutline) {
    let hidden = if s.hidden { ", hidden" } else { "" };
    let _ = writeln!(
        out,
        "\nSlide {} (id {}, layout {}{hidden}):",
        s.index + 1,
        s.id,
        quote(&s.layout)
    );
    if let Some(t) = &s.transition {
        let direction = t
            .direction
            .as_deref()
            .map(|d| format!(" {d}"))
            .unwrap_or_default();
        let after = t
            .advance_after_ms
            .map(|ms| format!(", advances after {ms} ms"))
            .unwrap_or_default();
        let _ = writeln!(
            out,
            "  transition: {}{direction}, {} ms{after}",
            t.kind, t.duration_ms
        );
    }
    if s.shapes.is_empty() {
        let _ = writeln!(out, "  (no shapes)");
    }
    for sh in &s.shapes {
        shape(out, sh, 1);
    }
    if let Some(notes) = &s.notes {
        let _ = writeln!(out, "  speaker notes: {}", quote(notes));
    }
}

/// Describes the deck, or only the given 1-based slide numbers.
pub fn describe(pres: &mut Presentation, slides: Option<&[usize]>) -> anyhow::Result<String> {
    let deck = pres.outline().map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Presentation: {} slides, {:.0} × {:.0} pt (x grows right, y grows down; positions and sizes in points).",
        deck.slides.len(),
        deck.width,
        deck.height
    );
    let layouts: Vec<String> = deck.layouts.iter().map(|l| quote(&l.name)).collect();
    let _ = writeln!(out, "Layouts: {}", layouts.join(", "));
    let colors: Vec<String> = deck
        .theme_colors
        .iter()
        .filter(|(slot, _)| {
            slot.starts_with("accent") || slot.starts_with("dk") || slot.starts_with("lt")
        })
        .map(|(slot, hex)| format!("{slot} {hex}"))
        .collect();
    let _ = writeln!(out, "Theme colors: {}", colors.join(", "));
    for s in &deck.slides {
        if slides.is_some_and(|wanted| !wanted.contains(&(s.index + 1))) {
            continue;
        }
        slide(&mut out, s);
        if out.len() > MAX_CHARS {
            let _ = writeln!(
                out,
                "\n… truncated after slide {}; ask for specific slides to read the rest.",
                s.index + 1
            );
            break;
        }
    }
    Ok(out)
}
