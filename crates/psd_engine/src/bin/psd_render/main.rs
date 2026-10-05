//! `psd_render`: developer tools for the Photoshop engine: document
//! summaries, composites, fidelity scores (the engine's composite of the
//! layers against the merged image Photoshop stored), and save round trips.

use clap::{Parser, Subcommand};
use psd_engine::document::{self, OpenOptions};
use psd_engine::edit::{History, Op};
use psd_engine::model::LayerKind;
use psd_engine::render::Renderer;
use psd_engine::{Document, IRect, Selection};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Parser)]
#[command(about = "Inspect, composite, and round-trip Photoshop (.psd/.psb) files")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Summarize documents: size, mode, layers, warnings.
    Info {
        /// The files.
        files: Vec<PathBuf>,
        /// Print the layer tree.
        #[arg(long)]
        tree: bool,
    },
    /// Composite the layers to a PNG (not the stored merged image).
    Render {
        /// The file.
        file: PathBuf,
        /// The PNG to write.
        #[arg(long)]
        out: PathBuf,
        /// Scale down by 2^level.
        #[arg(long, default_value_t = 0)]
        level: u8,
    },
    /// Composite the layers and compare with the merged image the file
    /// stores (files without real merged data are skipped).
    Compare {
        /// Files, or directories searched for `.psd`/`.psb` files.
        paths: Vec<PathBuf>,
        /// Where composites and difference images go.
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Move every layer away and back, save, reopen, and compare the
    /// layers and composites.
    Roundtrip {
        /// Files, or directories searched for `.psd`/`.psb` files.
        paths: Vec<PathBuf>,
        /// Where saved files go.
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

fn files(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    fn walk(p: &Path, out: &mut Vec<PathBuf>) {
        if p.is_dir() {
            let Ok(entries) = std::fs::read_dir(p) else {
                return;
            };
            let mut entries: Vec<PathBuf> =
                entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
            entries.sort();
            for e in entries {
                walk(&e, out);
            }
        } else if p
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("psd") || e.eq_ignore_ascii_case("psb"))
        {
            out.push(p.to_path_buf());
        }
    }
    for p in paths {
        walk(p, &mut out);
    }
    out
}

fn open(path: &Path) -> Option<(document::Opened, f64)> {
    let bytes = std::fs::read(path)
        .map_err(|e| println!("{}: {e}", path.display()))
        .ok()?;
    let start = Instant::now();
    match document::open(&bytes, OpenOptions::default()) {
        Ok(o) => Some((o, start.elapsed().as_secs_f64() * 1000.0)),
        Err(e) => {
            println!("{}: {e}", path.display());
            None
        }
    }
}

fn write_png(path: &Path, w: u32, h: u32, rgba: &[u8]) {
    let Ok(file) = std::fs::File::create(path) else {
        return;
    };
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    if let Ok(mut wr) = enc.write_header() {
        let _ = wr.write_image_data(rgba);
    }
}

/// The layers composited, ignoring the stored merged image.
fn composite(doc: &mut Document, level: u8) -> (IRect, Vec<u8>) {
    doc.composite = None;
    let b = doc.bounds();
    let rect = IRect::new(0, 0, (b.w >> level).max(1), (b.h >> level).max(1));
    (rect, Renderer::new().render(doc, rect, level))
}

/// Mean absolute difference per channel over white, and the share of
/// pixels off by more than 16 in some channel.
fn difference(a: &[u8], b: &[u8], w: i32, h: i32) -> (f64, f64, Vec<u8>) {
    let mut sum = 0u64;
    let mut bad = 0u64;
    let mut img = vec![255u8; (w * h * 4) as usize];
    for (k, (pa, pb)) in a.chunks_exact(4).zip(b.chunks_exact(4)).enumerate() {
        let over = |p: &[u8], c: usize| {
            let al = u32::from(p[3]);
            (u32::from(p[c]) * al + 255 * (255 - al)) / 255
        };
        let mut worst = 0;
        for c in 0..3 {
            let d = over(pa, c).abs_diff(over(pb, c));
            sum += u64::from(d);
            worst = worst.max(d);
        }
        if worst > 16 {
            bad += 1;
        }
        let v = 255 - worst.min(255) as u8;
        img[k * 4 + 1] = v;
        img[k * 4 + 2] = v;
    }
    let n = (f64::from(w) * f64::from(h)).max(1.0);
    (sum as f64 / (n * 3.0), bad as f64 / n, img)
}

fn print_tree(doc: &Document) {
    for (i, depth) in doc.panel_order() {
        let l = doc.layer(i);
        let kind = match &l.kind {
            LayerKind::Pixel => "pixels",
            LayerKind::Group { .. } => "group",
            LayerKind::Text { .. } => "text",
            LayerKind::Fill { .. } => "fill",
            LayerKind::Adjustment { adjustment } => adjustment.label(),
            LayerKind::SmartObject { .. } => "smart object",
        };
        println!(
            "{}{} {kind} {} \"{}\"{}{}",
            "  ".repeat(depth + 1),
            l.id,
            l.blend.label(),
            l.name,
            if l.visible { "" } else { " hidden" },
            if l.opacity < 255 {
                format!(" {}%", (f32::from(l.opacity) / 2.55).round())
            } else {
                String::new()
            }
        );
    }
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Info { files: paths, tree } => {
            for f in files(&paths) {
                let Some((o, ms)) = open(&f) else { continue };
                let d = &o.document;
                println!(
                    "{}: {}×{} {:?} {}-bit, {} layers; {ms:.1} ms",
                    f.display(),
                    d.width,
                    d.height,
                    d.mode,
                    d.depth,
                    d.layers.iter().filter(|l| !l.removed).count()
                );
                for w in &o.warnings {
                    println!("  warning: {w}");
                }
                if tree {
                    print_tree(d);
                }
            }
        }
        Command::Render { file, out, level } => {
            let Some((mut o, _)) = open(&file) else {
                return;
            };
            let start = Instant::now();
            let (rect, rgba) = composite(&mut o.document, level);
            write_png(&out, rect.w as u32, rect.h as u32, &rgba);
            println!(
                "{} ({}×{}, {:.0} ms)",
                out.display(),
                rect.w,
                rect.h,
                start.elapsed().as_secs_f64() * 1000.0
            );
        }
        Command::Compare { paths, out } => {
            let mut scores = Vec::new();
            for f in files(&paths) {
                let Some((mut o, _)) = open(&f) else { continue };
                let doc = &mut o.document;
                let stored = match (&doc.composite, doc.layers.iter().any(|l| !l.removed)) {
                    (Some(c), true) => c.raster.read_vec(doc.bounds()),
                    _ => {
                        println!("{}: no stored composite or no layers", f.display());
                        continue;
                    }
                };
                let start = Instant::now();
                let (rect, ours) = composite(doc, 0);
                let took = start.elapsed().as_secs_f64() * 1000.0;
                let (mean, bad, diff) = difference(&ours, &stored, rect.w, rect.h);
                println!(
                    "{}: {}×{}, mean diff {mean:.2}, {:.2}% pixels off, {took:.0} ms",
                    f.display(),
                    rect.w,
                    rect.h,
                    bad * 100.0
                );
                scores.push(mean);
                if let Some(dir) = &out {
                    let stem = f
                        .parent()
                        .and_then(|p| p.file_name())
                        .map_or_else(|| "out".into(), |s| s.to_string_lossy().into_owned());
                    write_png(
                        &dir.join(format!("{stem}-ours.png")),
                        rect.w as u32,
                        rect.h as u32,
                        &ours,
                    );
                    write_png(
                        &dir.join(format!("{stem}-stored.png")),
                        rect.w as u32,
                        rect.h as u32,
                        &stored,
                    );
                    write_png(
                        &dir.join(format!("{stem}-diff.png")),
                        rect.w as u32,
                        rect.h as u32,
                        &diff,
                    );
                }
            }
            if !scores.is_empty() {
                scores.sort_by(f64::total_cmp);
                println!(
                    "{} files: median mean diff {:.2}, worst {:.2}",
                    scores.len(),
                    scores[scores.len() / 2],
                    scores[scores.len() - 1]
                );
            }
        }
        Command::Roundtrip { paths, out } => {
            for f in files(&paths) {
                let Some((o, _)) = open(&f) else { continue };
                let mut doc = o.document;
                let ids: Vec<u32> = doc
                    .layers
                    .iter()
                    .filter(|l| !l.removed && !l.background)
                    .map(|l| l.id)
                    .collect();
                let mut history = History::default();
                let mut renderer = Renderer::new();
                let mut failed = false;
                for (dx, dy) in [(3, 2), (-3, -2)] {
                    let op = Op::Translate {
                        ids: ids.clone(),
                        dx,
                        dy,
                    };
                    if let Err(e) =
                        history.apply(&mut doc, &[op], &Selection::none(), &mut renderer, None)
                    {
                        println!("{}: edit failed: {e}", f.display());
                        failed = true;
                        break;
                    }
                }
                if failed {
                    continue;
                }
                let saved = match psd_engine::save::save(&doc, &mut renderer) {
                    Ok(b) => b,
                    Err(e) => {
                        println!("{}: save failed: {e}", f.display());
                        continue;
                    }
                };
                if let Some(dir) = &out {
                    let stem = f
                        .file_stem()
                        .map_or_else(|| "out".into(), |s| s.to_string_lossy().into_owned());
                    let parent = f
                        .parent()
                        .and_then(|p| p.file_name())
                        .map_or_else(String::new, |s| s.to_string_lossy().into_owned());
                    let _ = std::fs::write(dir.join(format!("{parent}-{stem}.psd")), &saved);
                }
                let again = match document::open(&saved, OpenOptions::default()) {
                    Ok(o) => o.document,
                    Err(e) => {
                        println!("{}: the saved file doesn't open: {e}", f.display());
                        continue;
                    }
                };
                let mut mismatched = 0;
                for l in doc.layers.iter().filter(|l| !l.removed) {
                    let Some(j) = again.find(l.id) else {
                        mismatched += 1;
                        continue;
                    };
                    let m = again.layer(j);
                    let same = l.name == m.name
                        && l.opacity == m.opacity
                        && l.blend == m.blend
                        && l.pixels.content_bounds() == m.pixels.content_bounds()
                        && l.pixels
                            .content_bounds()
                            .is_none_or(|b| l.pixels.read_vec(b) == m.pixels.read_vec(b));
                    if !same {
                        mismatched += 1;
                    }
                }
                let mut a = doc.clone();
                let mut b = again.clone();
                let (rect, before) = composite(&mut a, 0);
                let (_, after) = composite(&mut b, 0);
                let (mean, bad, _) = difference(&before, &after, rect.w, rect.h);
                println!(
                    "{}: {} layers, {mismatched} differ; composite mean diff {mean:.3}, {:.3}% off; {} → {} bytes",
                    f.display(),
                    doc.layers.iter().filter(|l| !l.removed).count(),
                    bad * 100.0,
                    std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0),
                    saved.len()
                );
            }
        }
    }
}
