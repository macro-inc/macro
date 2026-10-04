//! Developer CLI for the `.fig` engine: document summaries, page renders,
//! and fidelity scores against the thumbnails Figma embeds in its files.

use clap::{Parser, Subcommand};
use fig_engine::container::Container;
use fig_engine::images::ImageStore;
use fig_engine::model::Rect;
use fig_engine::render::{self, RenderOptions, Viewport};
use fig_engine::{Document, Scene};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tiny_skia::Pixmap;

#[derive(Parser)]
#[command(about = "Inspect and render Figma (.fig) files")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Decode files and print a summary of each.
    Info { files: Vec<PathBuf> },
    /// Render every page of each file to PNG.
    Render {
        #[arg(long, default_value = "out")]
        out: PathBuf,
        /// Longest side of each page render, in pixels.
        #[arg(long, default_value_t = 2048)]
        max: u32,
        /// Outline view.
        #[arg(long)]
        outline: bool,
        files: Vec<PathBuf>,
    },
    /// Render the region of Figma's embedded thumbnail and compare.
    Compare {
        #[arg(long, default_value = "out")]
        out: PathBuf,
        files: Vec<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Command::Info { files } => {
            for path in files {
                info(&path);
            }
        }
        Command::Render {
            out,
            max,
            outline,
            files,
        } => {
            std::fs::create_dir_all(&out).expect("output directory");
            for path in files {
                render_pages(&path, &out, max, outline);
            }
        }
        Command::Compare { out, files } => {
            std::fs::create_dir_all(&out).expect("output directory");
            let mut scores = Vec::new();
            for path in files {
                if let Some(s) = compare(&path, &out) {
                    scores.push(s);
                }
            }
            if !scores.is_empty() {
                let mean = scores.iter().sum::<f64>() / scores.len() as f64;
                println!("mean similarity {mean:.4} over {} files", scores.len());
            }
        }
    }
}

fn stem(path: &Path) -> String {
    path.file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn open(path: &Path) -> Option<(Vec<u8>, Document)> {
    let bytes = std::fs::read(path)
        .map_err(|e| eprintln!("{}: {e}", path.display()))
        .ok()?;
    let doc = Document::open(&bytes)
        .map_err(|e| println!("{}: ERROR {e}", path.display()))
        .ok()?;
    Some((bytes, doc))
}

fn info(path: &Path) {
    let started = Instant::now();
    let Some((_, doc)) = open(path) else { return };
    let decoded = started.elapsed();
    let mut scene_nodes = 0;
    let started = Instant::now();
    for &page in &doc.pages {
        scene_nodes += Scene::build(&doc, page).nodes.len();
    }
    println!(
        "{}: v{} nodes={} blobs={} images={} pages={} scene_nodes={} decode={:?} expand={:?}",
        stem(path),
        doc.version,
        doc.nodes.len(),
        doc.blobs.len(),
        doc.images.len(),
        doc.pages.len(),
        scene_nodes,
        decoded,
        started.elapsed()
    );
}

fn to_straight_png(pixmap: &Pixmap) -> Vec<u8> {
    fig_engine::images::encode_png(pixmap)
}

fn render_pages(path: &Path, out: &Path, max: u32, outline: bool) {
    let Some((_, doc)) = open(path) else { return };
    let mut images = ImageStore::default();
    for (n, &page) in doc.pages.iter().enumerate() {
        let scene = Scene::build(&doc, page);
        let bounds = scene.node(scene.root()).bounds;
        if bounds.is_empty() {
            continue;
        }
        let scale = (f64::from(max) / bounds.w.max(bounds.h)).min(4.0);
        let vp = Viewport {
            x: bounds.x,
            y: bounds.y,
            scale,
            width: (bounds.w * scale).ceil().max(1.0) as u32,
            height: (bounds.h * scale).ceil().max(1.0) as u32,
        };
        let started = Instant::now();
        let opts = RenderOptions {
            outline,
            background: Some(doc.page_background(page)),
        };
        let Some(pixmap) = render::render(&doc, &scene, &mut images, &vp, opts) else {
            continue;
        };
        let elapsed = started.elapsed();
        let file = out.join(format!("{}-p{n}.png", stem(path)));
        std::fs::write(&file, to_straight_png(&pixmap)).expect("write png");
        println!(
            "{} page {n} ({}): {}x{} in {:?}",
            stem(path),
            doc.props(page).name(),
            vp.width,
            vp.height,
            elapsed
        );
    }
}

/// Similarity in 0..1 (1 - mean absolute RGB difference over the image,
/// both composited on white).
fn similarity(a: &Pixmap, b: &Pixmap) -> f64 {
    let flat = |p: &[u8]| {
        let a = f64::from(p[3]) / 255.0;
        [
            f64::from(p[0]) / 255.0 + (1.0 - a),
            f64::from(p[1]) / 255.0 + (1.0 - a),
            f64::from(p[2]) / 255.0 + (1.0 - a),
        ]
    };
    let mut total = 0.0;
    let mut n: f64 = 0.0;
    for (pa, pb) in a.data().chunks_exact(4).zip(b.data().chunks_exact(4)) {
        let (ca, cb) = (flat(pa), flat(pb));
        total += (ca[0] - cb[0]).abs() + (ca[1] - cb[1]).abs() + (ca[2] - cb[2]).abs();
        n += 3.0;
    }
    1.0 - total / n.max(1.0)
}

fn compare(path: &Path, out: &Path) -> Option<f64> {
    let bytes = std::fs::read(path).ok()?;
    let container = Container::open(&bytes).ok()?;
    let thumb_png = container.thumbnail.clone()?;
    let meta = container.meta.clone();
    let doc = Document::from_container(container)
        .map_err(|e| println!("{}: ERROR {e}", path.display()))
        .ok()?;
    let thumb = fig_engine::images::decode(&thumb_png)?;
    let given = meta
        .as_ref()
        .and_then(|m| m.get("client_meta"))
        .and_then(|c| c.get("render_coordinates"))
        .and_then(|r| {
            Some(Rect::new(
                r.get("x")?.as_f64()?,
                r.get("y")?.as_f64()?,
                r.get("width")?.as_f64()?,
                r.get("height")?.as_f64()?,
            ))
        });
    // The thumbnail shows the page that was open when the file was saved,
    // which the file does not record: score every page, keep the best.
    let mut images = ImageStore::default();
    let mut best: Option<(f64, Pixmap, std::time::Duration)> = None;
    for &page in &doc.pages {
        let scene = Scene::build(&doc, page);
        // Legacy thumbnails frame the top-level layers (without effects)
        // on the page color.
        let region = given.unwrap_or_else(|| {
            scene
                .node(scene.root())
                .children
                .iter()
                .fold(Rect::EMPTY, |r, &c| r.union(&scene.frame_bounds(&doc, c)))
        });
        let background = given.is_none().then(|| doc.page_background(page));
        if region.is_empty() {
            continue;
        }
        let scale = f64::from(thumb.width()) / region.w;
        let vp = Viewport {
            x: region.x,
            y: region.y,
            scale,
            width: thumb.width(),
            height: thumb.height(),
        };
        let started = Instant::now();
        let Some(ours) = render::render(
            &doc,
            &scene,
            &mut images,
            &vp,
            RenderOptions {
                outline: false,
                background,
            },
        ) else {
            continue;
        };
        let elapsed = started.elapsed();
        let score = similarity(&ours, &thumb);
        if best.as_ref().is_none_or(|(s, _, _)| score > *s) {
            best = Some((score, ours, elapsed));
        }
    }
    let (score, ours, elapsed) = best?;
    // Side by side: Figma left, ours right.
    let mut both = Pixmap::new(thumb.width() * 2 + 8, thumb.height())?;
    both.fill(tiny_skia::Color::WHITE);
    let paint = tiny_skia::PixmapPaint::default();
    both.draw_pixmap(
        0,
        0,
        thumb.as_ref(),
        &paint,
        tiny_skia::Transform::identity(),
        None,
    );
    both.draw_pixmap(
        thumb.width() as i32 + 8,
        0,
        ours.as_ref(),
        &paint,
        tiny_skia::Transform::identity(),
        None,
    );
    std::fs::write(
        out.join(format!("{}-compare.png", stem(path))),
        to_straight_png(&both),
    )
    .ok()?;
    println!("{}: similarity {score:.4} ({elapsed:?})", stem(path));
    Some(score)
}
