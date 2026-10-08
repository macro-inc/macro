//! `ai_render`: developer tools for the Illustrator engine: document
//! summaries, artboard renders, save round trips, and fidelity scores
//! against reference renders (PNGs another PDF reader made of each page).

use ai_engine::build::{self, Opened};
use ai_engine::model::{Document, NodeKind};
use ai_engine::render::{Options, Renderer, View};
use clap::{Parser, Subcommand};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Parser)]
#[command(about = "Inspect, render, and round-trip Illustrator (.ai) files")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Summarize documents: artboards, layers, objects, warnings.
    Info {
        /// The files.
        files: Vec<PathBuf>,
        /// Print the layer tree.
        #[arg(long)]
        tree: bool,
    },
    /// Render each artboard to a PNG.
    Render {
        /// The file.
        file: PathBuf,
        /// Where the PNGs go.
        #[arg(long, default_value = ".")]
        out: PathBuf,
        /// Pixels per point.
        #[arg(long, default_value_t = 1.0)]
        scale: f64,
    },
    /// Save after moving every object there and back, open the result,
    /// and compare renders of both.
    Roundtrip {
        /// The files.
        files: Vec<PathBuf>,
        /// Where saved files and renders go.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Pixels per point.
        #[arg(long, default_value_t = 0.5)]
        scale: f64,
    },
    /// Compare renders with reference PNGs (`<name>-<page>.png`, page from
    /// 1, as `pdftoppm -png` names them) at the same scale.
    Compare {
        /// The file.
        file: PathBuf,
        /// The directory with the reference renders.
        refs: PathBuf,
        /// Pixels per point the references were made at.
        #[arg(long, default_value_t = 1.0)]
        scale: f64,
        /// Where difference images go.
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

fn open(path: &Path) -> Option<(Opened, f64)> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            println!("{}: {e}", path.display());
            return None;
        }
    };
    let start = Instant::now();
    match build::open(&bytes) {
        Ok(o) => Some((o, start.elapsed().as_secs_f64() * 1000.0)),
        Err(e) => {
            println!("{}: {e}", path.display());
            None
        }
    }
}

/// Renders an artboard (straight RGBA over white) at a scale.
fn render_artboard(r: &mut Renderer, doc: &Document, k: usize, scale: f64) -> (u32, u32, Vec<u8>) {
    let a = &doc.artboards[k];
    let w = (a.rect.width() * scale).round().max(1.0) as u32;
    let h = (a.rect.height() * scale).round().max(1.0) as u32;
    let view = View {
        x: a.rect.x0,
        y: a.rect.y0,
        scale,
        width: w,
        height: h,
    };
    let rgba = r.render(
        doc,
        &view,
        &Options {
            artboards: true,
            outline: false,
        },
    );
    (w, h, rgba)
}

fn write_png(path: &Path, w: u32, h: u32, rgba: &[u8]) {
    let file = match std::fs::File::create(path) {
        Ok(f) => f,
        Err(e) => {
            println!("{}: {e}", path.display());
            return;
        }
    };
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    if let Ok(mut wr) = enc.write_header() {
        let _ = wr.write_image_data(rgba);
    }
}

fn read_png(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let dec = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).ok()?));
    let mut reader = dec.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let (w, h) = (info.width, info.height);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..(w * h * 4) as usize].to_vec(),
        png::ColorType::Rgb => buf[..(w * h * 3) as usize]
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::Grayscale => buf[..(w * h) as usize]
            .iter()
            .flat_map(|&g| [g, g, g, 255])
            .collect(),
        _ => return None,
    };
    Some((w, h, rgba))
}

/// Mean absolute difference per channel (0–255) and the share of pixels
/// off by more than 32 in a channel, over the common area.
fn difference(a: (u32, u32, &[u8]), b: (u32, u32, &[u8])) -> (f64, f64, Vec<u8>) {
    let (w, h) = (a.0.min(b.0), a.1.min(b.1));
    let mut sum = 0u64;
    let mut bad = 0u64;
    let mut img = vec![255u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let ia = ((y * a.0 + x) * 4) as usize;
            let ib = ((y * b.0 + x) * 4) as usize;
            let mut worst = 0;
            for c in 0..3 {
                // Both over white.
                let over = |p: &[u8], i: usize| {
                    let al = u32::from(p[i + 3]);
                    (u32::from(p[i + c]) * al + 255 * (255 - al)) / 255
                };
                let d = over(a.2, ia).abs_diff(over(b.2, ib));
                sum += u64::from(d);
                worst = worst.max(d);
            }
            if worst > 32 {
                bad += 1;
            }
            let o = ((y * w + x) * 4) as usize;
            let v = 255 - (worst.min(255) as u8);
            img[o] = 255;
            img[o + 1] = v;
            img[o + 2] = v;
        }
    }
    let n = f64::from(w) * f64::from(h);
    (
        sum as f64 / (n * 3.0).max(1.0),
        bad as f64 / n.max(1.0),
        img,
    )
}

fn count(doc: &Document) -> [usize; 6] {
    let mut c = [0; 6];
    for i in doc.paint_order() {
        let k = match doc.node(i).kind {
            NodeKind::Layer { .. } => 0,
            NodeKind::Group { .. } => 1,
            NodeKind::Path(_) => 2,
            NodeKind::Text(_) => 3,
            NodeKind::Image(_) => 4,
            NodeKind::Raw { .. } => 5,
        };
        c[k] += 1;
    }
    c
}

fn print_tree(doc: &Document, stack: &[u32], depth: usize) {
    for &i in stack.iter().rev() {
        let n = doc.node(i);
        if n.removed {
            continue;
        }
        let what = match &n.kind {
            NodeKind::Layer { .. } => "layer".to_string(),
            NodeKind::Group { clip, .. } => {
                if clip.is_some() {
                    "clip group".into()
                } else {
                    "group".into()
                }
            }
            NodeKind::Path(p) => format!("path ({} segments)", p.data.segs.len()),
            NodeKind::Text(t) => format!(
                "text {:?} ({} {})",
                t.text.chars().take(40).collect::<String>(),
                t.family,
                t.style
            ),
            NodeKind::Image(img) => format!("image {}×{}", img.width, img.height),
            NodeKind::Raw { .. } => "raw".into(),
        };
        let flags = format!(
            "{}{}{}",
            if n.hidden { " hidden" } else { "" },
            if n.locked { " locked" } else { "" },
            if n.opacity < 1.0 {
                format!(" {:.0}%", n.opacity * 100.0)
            } else {
                String::new()
            },
        );
        println!(
            "{}{} {}{}",
            "  ".repeat(depth),
            n.id,
            if n.name.is_empty() {
                what
            } else {
                format!("{} — {what}", n.name)
            },
            flags
        );
        print_tree(doc, &n.children, depth + 1);
    }
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Info { files, tree } => {
            for f in files {
                let Some((o, ms)) = open(&f) else { continue };
                let doc = &o.document;
                let [layers, groups, paths, texts, images, raws] = count(doc);
                println!(
                    "{}: {} artboards, {layers} layers, {groups} groups, {paths} paths, {texts} text, {images} images, {raws} raw; {ms:.1} ms",
                    f.display(),
                    doc.artboards.len()
                );
                for w in &o.warnings {
                    println!("  warning: {w}");
                }
                if tree {
                    print_tree(doc, &doc.layers, 1);
                }
            }
        }
        Command::Render { file, out, scale } => {
            let Some((o, _)) = open(&file) else { return };
            let mut r = Renderer::new();
            let stem = file
                .file_stem()
                .map_or("out".into(), |s| s.to_string_lossy().into_owned());
            for k in 0..o.document.artboards.len() {
                let start = Instant::now();
                let (w, h, rgba) = render_artboard(&mut r, &o.document, k, scale);
                let path = out.join(format!("{stem}-{}.png", k + 1));
                write_png(&path, w, h, &rgba);
                println!(
                    "{} ({w}×{h}, {:.0} ms)",
                    path.display(),
                    start.elapsed().as_secs_f64() * 1000.0
                );
            }
        }
        Command::Roundtrip { files, out, scale } => {
            for f in files {
                let Some((o, _)) = open(&f) else { continue };
                let mut doc = o.document;
                let mut r = Renderer::new();
                let before: Vec<_> = (0..doc.artboards.len())
                    .map(|k| render_artboard(&mut r, &doc, k, scale))
                    .collect();
                // Move everything away and back: every object is written
                // again, from its operators.
                let ids: Vec<u32> = doc.layers.iter().map(|&l| doc.node(l).id).collect();
                let mut history = ai_engine::edit::History::new();
                for d in [5.0, -5.0] {
                    let op = ai_engine::edit::Op::Transform {
                        ids: ids.clone(),
                        matrix: ai_engine::geom::Affine::translate(d, 0.0),
                    };
                    if let Err(e) = history.apply(&mut doc, &[op], None) {
                        println!("{}: edit failed: {e}", f.display());
                    }
                }
                let saved = match ai_engine::save::save(&doc) {
                    Ok(b) => b,
                    Err(e) => {
                        println!("{}: save failed: {e}", f.display());
                        continue;
                    }
                };
                let stem = f
                    .file_stem()
                    .map_or("out".into(), |s| s.to_string_lossy().into_owned());
                if let Some(dir) = &out {
                    let _ = std::fs::write(dir.join(format!("{stem}.saved.pdf")), &saved);
                }
                let reopened = match build::open(&saved) {
                    Ok(o) => o.document,
                    Err(e) => {
                        println!("{}: saved file doesn't open: {e}", f.display());
                        continue;
                    }
                };
                let mut r2 = Renderer::new();
                for (k, b) in before.iter().enumerate() {
                    if k >= reopened.artboards.len() {
                        println!("{}: artboard {} missing after save", f.display(), k + 1);
                        break;
                    }
                    let a = render_artboard(&mut r2, &reopened, k, scale);
                    let (mean, bad, img) = difference((b.0, b.1, &b.2), (a.0, a.1, &a.2));
                    println!(
                        "{} artboard {}: mean diff {mean:.3}, {:.3}% pixels off; {} → {} bytes",
                        f.display(),
                        k + 1,
                        bad * 100.0,
                        std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0),
                        saved.len()
                    );
                    if let Some(dir) = &out {
                        write_png(
                            &dir.join(format!("{stem}-{}-before.png", k + 1)),
                            b.0,
                            b.1,
                            &b.2,
                        );
                        write_png(
                            &dir.join(format!("{stem}-{}-after.png", k + 1)),
                            a.0,
                            a.1,
                            &a.2,
                        );
                        write_png(
                            &dir.join(format!("{stem}-{}-diff.png", k + 1)),
                            b.0.min(a.0),
                            b.1.min(a.1),
                            &img,
                        );
                    }
                }
            }
        }
        Command::Compare {
            file,
            refs,
            scale,
            out,
        } => {
            let Some((o, ms)) = open(&file) else { return };
            let mut r = Renderer::new();
            let stem = file
                .file_stem()
                .map_or("out".into(), |s| s.to_string_lossy().into_owned());
            println!("{}: opened in {ms:.1} ms", file.display());
            for k in 0..o.document.artboards.len() {
                let start = Instant::now();
                let ours = render_artboard(&mut r, &o.document, k, scale);
                let took = start.elapsed().as_secs_f64() * 1000.0;
                let candidates = [
                    refs.join(format!("{stem}-{}.png", k + 1)),
                    refs.join(format!("{stem}-{:02}.png", k + 1)),
                    refs.join(format!("{stem}-{:03}.png", k + 1)),
                ];
                let Some(reference) = candidates.iter().find_map(|p| read_png(p)) else {
                    println!("  artboard {}: no reference", k + 1);
                    continue;
                };
                let (mean, bad, img) = difference(
                    (ours.0, ours.1, &ours.2),
                    (reference.0, reference.1, &reference.2),
                );
                println!(
                    "  artboard {}: {}×{} vs {}×{}, mean diff {mean:.2}, {:.2}% pixels off, {took:.0} ms",
                    k + 1,
                    ours.0,
                    ours.1,
                    reference.0,
                    reference.1,
                    bad * 100.0
                );
                if let Some(dir) = &out {
                    write_png(
                        &dir.join(format!("{stem}-{}-ours.png", k + 1)),
                        ours.0,
                        ours.1,
                        &ours.2,
                    );
                    write_png(
                        &dir.join(format!("{stem}-{}-diff.png", k + 1)),
                        ours.0.min(reference.0),
                        ours.1.min(reference.1),
                        &img,
                    );
                }
            }
        }
    }
}
