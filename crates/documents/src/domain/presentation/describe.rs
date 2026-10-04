//! A compact, model-readable description of a presentation: every slide's
//! shapes with their ids, kinds, positions, text, tables, and animations.

use pptx_engine::Presentation;
use pptx_engine::edit::{AnimationClass, AnimationRepeat, AnimationStart, RepeatUntil};
use pptx_engine::inspect::{
    AnimationOutline, ChartOutline, DeckOutline, EffectsOutline, HeaderFooterOutline,
    PictureOutline, ShapeKindName, ShapeOutline, SlideOutline, TableOutline,
};
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

/// One animation, as `setAnimations` names it: `animation 1: entrance flyIn
/// left, after previous, delay 250 ms, 500 ms` (the number is its playback index).
fn animation_line(out: &mut String, pad: &str, index: usize, a: &AnimationOutline) {
    let class = match a.class {
        AnimationClass::Entrance => "entrance",
        AnimationClass::Emphasis => "emphasis",
        AnimationClass::Exit => "exit",
        AnimationClass::Path => "path",
        AnimationClass::Media => "media",
        AnimationClass::Other => "other",
    };
    let mut what = if a.effect == class {
        a.effect.clone()
    } else {
        format!("{class} {}", a.effect)
    };
    if let Some(d) = &a.direction {
        let _ = write!(what, " {d}");
    }
    if let Some(p) = a.paragraph {
        let _ = write!(what, " ¶{p}");
    }
    let start = match a.start {
        AnimationStart::OnClick => "on click",
        AnimationStart::WithPrevious => "with previous",
        AnimationStart::AfterPrevious => "after previous",
    };
    let mut timing = String::new();
    if a.delay_ms > 0 {
        let _ = write!(timing, ", delay {} ms", a.delay_ms);
    }
    if a.duration_ms > 0 {
        let _ = write!(timing, ", {} ms", a.duration_ms);
    }
    match a.repeat {
        Some(AnimationRepeat::Times(n)) => {
            let _ = write!(timing, ", plays {n} times");
        }
        Some(AnimationRepeat::Until(RepeatUntil::UntilNextClick)) => {
            timing.push_str(", repeats until next click");
        }
        Some(AnimationRepeat::Until(RepeatUntil::UntilEndOfSlide)) => {
            timing.push_str(", repeats until slide end");
        }
        None => {}
    }
    let _ = writeln!(out, "{pad}  animation {index}: {what}, {start}{timing}");
}

fn shape(out: &mut String, s: &ShapeOutline, depth: usize, animations: &[AnimationOutline]) {
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
    if let Some(line) = s.picture.as_ref().and_then(picture_line) {
        let _ = writeln!(out, "{pad}  picture: {line}");
    }
    if let Some(effects) = &s.effects {
        let _ = writeln!(out, "{pad}  effects: {}", effects_line(effects));
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
    for (i, a) in animations.iter().enumerate() {
        if a.shape_id == s.id {
            animation_line(out, &pad, i, a);
        }
    }
    for child in &s.children {
        shape(out, child, depth + 1, animations);
    }
}

/// A fraction as a whole percentage.
fn percent(v: f32) -> String {
    format!("{:.0}%", v * 100.0)
}

/// A picture's crop and adjustments, when it has any.
fn picture_line(p: &PictureOutline) -> Option<String> {
    let mut parts = Vec::new();
    let c = &p.crop;
    let edges: Vec<String> = [
        ("left", c.left),
        ("top", c.top),
        ("right", c.right),
        ("bottom", c.bottom),
    ]
    .into_iter()
    .filter(|(_, v)| *v != 0.0)
    .map(|(edge, v)| format!("{edge} {}", percent(v)))
    .collect();
    if !edges.is_empty() {
        parts.push(format!("crop {}", edges.join(", ")));
    }
    for (name, v) in [("brightness", p.brightness), ("contrast", p.contrast)] {
        if v != 0.0 {
            parts.push(format!("{name} {:+.0}%", v * 100.0));
        }
    }
    if p.recolor != "none" {
        parts.push(format!("recolor {}", p.recolor));
    }
    if p.transparency != 0.0 {
        parts.push(format!("transparency {}", percent(p.transparency)));
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// A shape's effects: gallery presets by name, other values in brief.
fn effects_line(e: &EffectsOutline) -> String {
    let mut parts = Vec::new();
    if let Some(s) = &e.shadow {
        parts.push(match s.preset {
            Some(preset) => format!("shadow {preset}"),
            None => format!(
                "{} shadow {} blur {:.0} pt, {:.0} pt at {:.0}°",
                s.kind, s.color, s.blur_pt, s.distance_pt, s.angle_deg
            ),
        });
    }
    if let Some(g) = &e.glow {
        parts.push(format!("glow {:.0} pt {}", g.size_pt, g.color));
    }
    if let Some(s) = &e.soft_edge {
        parts.push(format!("soft edges {} pt", s.size_pt));
    }
    if let Some(r) = &e.reflection {
        parts.push(match r.preset {
            Some(preset) => format!("reflection {preset}"),
            None => format!("reflection {:.0}%", r.size_pct),
        });
    }
    let source = if e.inherited { " (from the theme)" } else { "" };
    format!("{}{source}", parts.join("; "))
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
    if let Some(hf) = &s.header_footer {
        let _ = writeln!(out, "  header & footer: {}", header_footer(hf));
    }
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
        shape(out, sh, 1, &s.animations);
    }
    if let Some(notes) = &s.notes {
        let _ = writeln!(out, "  speaker notes: {}", quote(notes));
    }
}

/// What a slide shows of Header & Footer.
fn header_footer(hf: &HeaderFooterOutline) -> String {
    let mut parts = Vec::new();
    if hf.slide_number {
        parts.push("slide number".to_owned());
    }
    if hf.date {
        parts.push(match (&hf.date_text, &hf.date_format) {
            (Some(text), _) => format!("fixed date {}", quote(text)),
            (None, Some(format)) => format!("automatic date ({format})"),
            (None, None) => "date".to_owned(),
        });
    }
    if hf.footer {
        parts.push(format!(
            "footer {}",
            quote(hf.footer_text.as_deref().unwrap_or_default())
        ));
    }
    parts.join(", ")
}

/// 1-based slide numbers as ranges (`1-3, 5`).
fn slide_ranges(deck: &DeckOutline, ids: &[u32]) -> String {
    let mut numbers: Vec<usize> = ids
        .iter()
        .filter_map(|id| deck.slides.iter().position(|s| s.id == *id))
        .map(|i| i + 1)
        .collect();
    numbers.sort_unstable();
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for n in numbers {
        match ranges.last_mut() {
            Some((_, end)) if *end + 1 == n => *end = n,
            _ => ranges.push((n, n)),
        }
    }
    match ranges.as_slice() {
        [] => "no slides".to_owned(),
        [(a, b)] if a == b => format!("slide {a}"),
        _ => {
            let list: Vec<String> = ranges
                .iter()
                .map(|(a, b)| {
                    if a == b {
                        a.to_string()
                    } else {
                        format!("{a}-{b}")
                    }
                })
                .collect();
            format!("slides {}", list.join(", "))
        }
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
    if let Some(fonts) = &deck.theme_fonts {
        let _ = writeln!(
            out,
            "Theme fonts: headings {}, body {}",
            quote(&fonts.major),
            quote(&fonts.minor)
        );
    }
    for section in deck.sections.iter().flatten() {
        let _ = writeln!(
            out,
            "Section {} (id {}): {}",
            quote(&section.name),
            section.id,
            slide_ranges(&deck, &section.slide_ids)
        );
    }
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
