//! `fig_render text`: lays out every text layer again with registered
//! fonts and reports how far the glyphs land from where Figma put them, an
//! oracle for the engine's text layout (fonts, kerning, line breaking, line
//! height) that needs no Figma account.

use fig_engine::Document;
use fig_engine::model::{NodeType, Props};
use fig_engine::text::{self, Change, FontStatus};
use std::path::Path;

/// Registers every font file under `dir`; a font in a subdirectory is
/// registered under that directory's name as its family (how the web app
/// names the fonts it fetches).
pub fn register_fonts(dir: &Path) -> usize {
    let mut count = 0;
    let Ok(entries) = std::fs::read_dir(dir) else {
        eprintln!("{}: not a directory", dir.display());
        return 0;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            let family = path.file_name().and_then(|n| n.to_str()).map(str::to_owned);
            let Ok(files) = std::fs::read_dir(&path) else {
                continue;
            };
            for file in files.flatten() {
                if let Ok(bytes) = std::fs::read(file.path()) {
                    count += usize::from(!text::register_font(bytes, family.as_deref()).is_empty());
                }
            }
        } else if let Ok(bytes) = std::fs::read(&path) {
            count += usize::from(!text::register_font(bytes, None).is_empty());
        }
    }
    count
}

/// How far one layer's glyphs moved.
struct Drift {
    name: String,
    glyphs: usize,
    /// Mean and largest horizontal and vertical offsets, in pixels.
    mean_dx: f32,
    max_dx: f32,
    max_dy: f32,
    lines: (u32, u32),
    /// The layer's settings and where the first glyph that moved went.
    detail: String,
}

fn families(p: &Props) -> Vec<(String, String)> {
    let style = p.text_style.as_deref();
    let family = style
        .and_then(|s| s.font_family.clone())
        .unwrap_or_else(|| text::DEFAULT_FAMILY.into());
    let font_style = style
        .and_then(|s| s.font_style.clone())
        .unwrap_or_else(|| "Regular".into());
    let mut out = vec![(family.clone(), font_style.clone())];
    for run in p.text_content.iter().flat_map(|c| c.styles.iter()) {
        out.push((
            run.font_family
                .as_deref()
                .map_or(family.clone(), str::to_owned),
            run.font_style
                .as_deref()
                .map_or(font_style.clone(), str::to_owned),
        ));
    }
    out
}

fn drift(doc: &mut Document, p: &Props) -> Option<Drift> {
    let figma = p.text_layout.clone()?;
    if figma.glyphs.is_empty()
        || figma
            .glyphs
            .iter()
            .any(|g| g.emoji.is_some() || g.rotation != 0.0)
    {
        return None;
    }
    let mut mine = p.clone();
    text::edit_props(doc, &mut mine, &Change::default()).ok()?;
    let ours = mine.text_layout.clone()?;
    let (mut n, mut sum, mut max_dx, mut max_dy) = (0usize, 0.0f32, 0.0f32, 0.0f32);
    let mut first_moved = None;
    for g in figma.glyphs.iter().filter(|g| g.blob.is_some()) {
        let Some(o) = ours.glyphs.iter().find(|o| o.first_char == g.first_char) else {
            continue;
        };
        if (o.font_size - g.font_size).abs() > 0.01 {
            // A layout from before the layer's last style change.
            return None;
        }
        let (dx, dy) = ((o.x - g.x).abs(), (o.y - g.y).abs());
        if first_moved.is_none() && (dx > 0.5 || dy > 0.5) {
            first_moved = Some(format!(
                "char {} figma ({:.2}, {:.2}) ours ({:.2}, {:.2})",
                g.first_char, g.x, g.y, o.x, o.y
            ));
        }
        n += 1;
        sum += dx;
        max_dx = max_dx.max(dx);
        max_dy = max_dy.max(dy);
    }
    (n > 0).then(|| Drift {
        name: p.name().to_owned(),
        glyphs: n,
        mean_dx: sum / n as f32,
        max_dx,
        max_dy,
        lines: (figma.lines, ours.lines),
        detail: {
            let st = p.text_style.as_deref().cloned().unwrap_or_default();
            format!(
                "{:?} {:?} size {:?} lh {:?} ls {:?} {:?}/{:?} box {:.1}x{:.1} ours {:.1}x{:.1} runs {}; {}",
                st.font_family,
                st.font_style,
                st.font_size,
                st.line_height,
                st.letter_spacing,
                st.auto_resize,
                st.align_horizontal,
                p.size().x,
                p.size().y,
                mine.size().x,
                mine.size().y,
                p.text_content.as_ref().map_or(0, |c| c.styles.len()),
                first_moved.unwrap_or_default()
            )
        },
    })
}

/// Drift per font family over every file checked.
#[derive(Default)]
pub struct Totals {
    /// Family → (layers, layers within a pixel, glyphs, summed |dx|).
    families: std::collections::BTreeMap<String, (usize, usize, usize, f32)>,
}

impl Totals {
    pub fn print(&self) {
        println!("by family (layers, within 1 px, mean |dx| px):");
        for (family, (layers, close, glyphs, sum)) in &self.families {
            println!(
                "  {family:<24} {layers:>6} {:>5.1}% {:>8.3}",
                *close as f32 * 100.0 / *layers as f32,
                sum / *glyphs as f32
            );
        }
    }
}

/// Re-lays out each file's text in its own fonts and prints the drift.
pub fn check(path: &Path, verbose: bool, totals: &mut Totals) {
    let Some((_, mut doc)) = super::open(path) else {
        return;
    };
    let texts: Vec<Props> = doc
        .nodes
        .iter()
        .filter(|n| !n.removed && n.props.node_type() == NodeType::Text)
        .map(|n| n.props.clone())
        .collect();
    let (mut skipped, mut drifts) = (0, Vec::new());
    for p in &texts {
        let available = families(p)
            .iter()
            .all(|(f, s)| text::font_status(f, s) == FontStatus::Available);
        if !available {
            skipped += 1;
            continue;
        }
        if let Some(d) = drift(&mut doc, p) {
            let family = families(p).remove(0).0;
            let t = totals.families.entry(family).or_default();
            t.0 += 1;
            t.1 += usize::from(d.max_dx < 1.0 && d.max_dy < 1.0);
            t.2 += d.glyphs;
            t.3 += d.mean_dx * d.glyphs as f32;
            drifts.push(d);
        }
    }
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    if drifts.is_empty() {
        println!("{name}: no text in registered fonts ({skipped} layers skipped)");
        return;
    }
    let glyphs: usize = drifts.iter().map(|d| d.glyphs).sum();
    let mean = drifts
        .iter()
        .map(|d| d.mean_dx * d.glyphs as f32)
        .sum::<f32>()
        / glyphs as f32;
    let mut maxes: Vec<f32> = drifts.iter().map(|d| d.max_dx).collect();
    maxes.sort_by(f32::total_cmp);
    let median = maxes[maxes.len() / 2];
    let close = drifts
        .iter()
        .filter(|d| d.max_dx < 1.0 && d.max_dy < 1.0)
        .count();
    let rewrapped = drifts.iter().filter(|d| d.lines.0 != d.lines.1).count();
    println!(
        "{name}: {} layers ({skipped} skipped), {glyphs} glyphs: mean |dx| {mean:.3} px, \
         median layer max {median:.2} px, {close} layers within 1 px, {rewrapped} wrap differently",
        drifts.len()
    );
    if verbose {
        drifts.sort_by(|a, b| b.max_dx.total_cmp(&a.max_dx));
        for d in drifts.iter().take(12) {
            println!(
                "  {:>7.2} dx {:>7.2} dy  lines {}→{}  {}",
                d.max_dx,
                d.max_dy,
                d.lines.0,
                d.lines.1,
                d.name.chars().take(60).collect::<String>()
            );
            println!("           {}", d.detail);
        }
    }
}
