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
    /// Edit each file (move every top-level layer), save, reopen, and check
    /// the saved file renders like the edited one.
    Roundtrip { files: Vec<PathBuf> },
    /// Override the text of a layer inside an instance, save, reopen, and
    /// check the override holds and the file renders the same.
    Override { files: Vec<PathBuf> },
    /// Time typical edits (a drag step, a fill change) and the scene update
    /// after each.
    BenchEdit { files: Vec<PathBuf> },
    /// Time opening each file, building its largest page, rendering that
    /// page to fit a screen, and rendering tiles at 1× and 2×; then print
    /// peak memory.
    Bench {
        /// Tile side in device pixels.
        #[arg(long, default_value_t = 256)]
        tile: u32,
        /// Tiles per side of the square grid rendered at each scale.
        #[arg(long, default_value_t = 4)]
        grid: i32,
        files: Vec<PathBuf>,
    },
    /// Lay out every auto layout frame again and report the frames whose
    /// children the engine places differently from Figma.
    Relayout {
        /// Print each differing frame.
        #[arg(long)]
        verbose: bool,
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
        Command::Roundtrip { files } => {
            for path in files {
                roundtrip(&path);
            }
        }
        Command::Override { files } => {
            for path in files {
                override_text(&path);
            }
        }
        Command::Bench { tile, grid, files } => {
            for path in files {
                bench(&path, tile, grid);
            }
            println!("peak rss {} MB", peak_rss_kb() / 1024);
        }
        Command::BenchEdit { files } => {
            for path in files {
                bench_edit(&path);
            }
        }
        Command::Relayout { verbose, files } => {
            for path in files {
                relayout(&path, verbose);
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

/// Renders page 0's content at a small scale.
fn small_render(doc: &Document) -> Option<Pixmap> {
    let &page = doc.pages.first()?;
    let scene = Scene::build(doc, page);
    let b = scene.node(scene.root()).bounds;
    if b.is_empty() {
        return None;
    }
    let scale = (512.0 / b.w.max(b.h)).min(1.0);
    render::render(
        doc,
        &scene,
        &mut ImageStore::default(),
        &Viewport {
            x: b.x,
            y: b.y,
            scale,
            width: ((b.w * scale).ceil() as u32).max(1),
            height: ((b.h * scale).ceil() as u32).max(1),
        },
        RenderOptions {
            outline: false,
            background: Some(doc.page_background(page)),
        },
    )
}

fn roundtrip(path: &Path) {
    use fig_engine::edit::{History, Op};
    let Some((bytes, mut doc)) = open(path) else {
        return;
    };
    let started = Instant::now();
    let page = doc.pages[0];
    let ids: Vec<String> = doc
        .node(page)
        .children
        .iter()
        .filter_map(|&c| doc.props(c).guid.map(|g| format!("\"{g}\"")))
        .collect();
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"translate","ids":[{}],"dx":17,"dy":-9}}]"#,
        ids.join(",")
    ))
    .expect("ops");
    if let Err(e) = History::default().apply(&mut doc, &ops, None) {
        println!("{}: EDIT ERROR {e}", stem(path));
        return;
    }
    let saved = match fig_engine::save::save(&doc, &bytes) {
        Ok(s) => s,
        Err(e) => {
            println!("{}: SAVE ERROR {e}", stem(path));
            return;
        }
    };
    let took = started.elapsed();
    let reopened = match Document::open(&saved) {
        Ok(d) => d,
        Err(e) => {
            println!("{}: REOPEN ERROR {e}", stem(path));
            return;
        }
    };
    let (a, b) = (small_render(&doc), small_render(&reopened));
    let same = match (&a, &b) {
        (Some(a), Some(b)) => a.data() == b.data(),
        (None, None) => true,
        _ => false,
    };
    println!(
        "{}: nodes {} -> {} saved {} KB -> {} KB in {took:?}, renders {}",
        stem(path),
        doc.nodes.iter().filter(|n| !n.removed).count(),
        reopened.nodes.len(),
        bytes.len() / 1024,
        saved.len() / 1024,
        if same { "identical" } else { "DIFFER" }
    );
}

fn relayout(path: &Path, verbose: bool) {
    use fig_engine::edit::{History, Op};
    let Some((_, mut doc)) = open(path) else {
        return;
    };
    let stacks: Vec<u32> = (0..doc.nodes.len() as u32)
        .filter(|&i| {
            let p = doc.props(i);
            p.node_type() != fig_engine::model::NodeType::Instance
                && p.node_type().is_frame_like()
                && p.auto_layout.as_ref().is_some_and(|a| a.is_stack())
                && !doc.node(i).children.is_empty()
        })
        .collect();
    let (mut same, mut differ) = (0, 0);
    for &f in &stacks {
        let child = doc.node(f).children[0];
        let Some(g) = doc.props(child).guid else {
            continue;
        };
        let ops: Vec<Op> =
            serde_json::from_str(&format!(r#"[{{"op":"reflow","ids":["{g}"]}}]"#)).expect("ops");
        let mut history = History::default();
        let Ok(applied) = history.apply(&mut doc, &ops, None) else {
            continue;
        };
        let after: Vec<(u32, fig_engine::model::Props)> = applied
            .touched
            .iter()
            .map(|&i| (i, doc.props(i).clone()))
            .collect();
        history.undo(&mut doc);
        let moved: Vec<String> = after
            .iter()
            .filter_map(|(i, b)| {
                let a = doc.props(*i);
                let (ta, tb) = (a.transform(), b.transform());
                let d = (ta.m02 - tb.m02).abs().max((ta.m12 - tb.m12).abs());
                let ds = (a.size().x - b.size().x)
                    .abs()
                    .max((a.size().y - b.size().y).abs());
                (d > 0.5 || ds > 0.5).then(|| {
                    format!(
                        "{} ({:.1},{:.1} {:.1}x{:.1} -> {:.1},{:.1} {:.1}x{:.1})",
                        a.name(),
                        ta.m02,
                        ta.m12,
                        a.size().x,
                        a.size().y,
                        tb.m02,
                        tb.m12,
                        b.size().x,
                        b.size().y
                    )
                })
            })
            .collect();
        if moved.is_empty() {
            same += 1;
        } else {
            differ += 1;
            if verbose {
                let al = doc.props(f).auto_layout.clone().unwrap_or_default();
                println!(
                    "  {} [{} {:?} {:?} {:?}/{:?}]: {}",
                    doc.props(f).name(),
                    al.mode,
                    al.primary_align,
                    al.counter_align,
                    al.primary_sizing,
                    al.counter_sizing,
                    moved.join(", ")
                );
            }
        }
    }
    println!(
        "{}: {} stacks, {same} unchanged, {differ} differ",
        stem(path),
        stacks.len()
    );
}

fn override_text(path: &Path) {
    use fig_engine::edit::{History, Op};
    use fig_engine::scene::Scene;
    let Some((bytes, mut doc)) = open(path) else {
        return;
    };
    // The first text layer inside an instance, page by page.
    let mut target = None;
    'pages: for &page in &doc.pages {
        let scene = Scene::build(&doc, page);
        for i in 0..scene.nodes.len() as u32 {
            if scene.node(i).path.is_some()
                && scene.props(&doc, i).node_type() == fig_engine::model::NodeType::Text
            {
                target = Some((page, scene.id(&doc, i)));
                break 'pages;
            }
        }
    }
    let Some((page, id)) = target else {
        println!("{}: no text in instances", stem(path));
        return;
    };
    // The outermost instance, widened by 40, then the text overridden.
    let root = id[1..].split(';').next().unwrap_or_default().to_owned();
    let width = fig_engine::model::Guid::parse(&root)
        .and_then(|g| doc.find(g))
        .map_or(100.0, |i| doc.props(i).size().x + 40.0);
    let ops: Vec<Op> = serde_json::from_str(&format!(
        r#"[{{"op":"set","ids":["{root}"],"props":{{"width":{width}}}}},
            {{"op":"set","ids":["{id}"],"props":{{"characters":"Macro override"}}}}]"#
    ))
    .expect("ops");
    if let Err(e) = History::default().apply(&mut doc, &ops, None) {
        println!("{}: EDIT ERROR {e}", stem(path));
        return;
    }
    let text_of = |d: &Document| {
        let scene = Scene::build(d, page);
        scene.find(d, &id).and_then(|i| {
            scene
                .props(d, i)
                .text_content
                .as_ref()
                .map(|c| c.characters.to_string())
        })
    };
    let saved = match fig_engine::save::save(&doc, &bytes) {
        Ok(s) => s,
        Err(e) => {
            println!("{}: SAVE ERROR {e}", stem(path));
            return;
        }
    };
    if let Some(out) = std::env::var_os("FIG_SAVE_TO") {
        let _ = std::fs::write(out, &saved);
    }
    let Ok(reopened) = Document::open(&saved) else {
        println!("{}: REOPEN ERROR", stem(path));
        return;
    };
    let (a, b) = (small_render(&doc), small_render(&reopened));
    let same = match (&a, &b) {
        (Some(a), Some(b)) => a.data() == b.data(),
        (None, None) => true,
        _ => false,
    };
    if !same && std::env::var_os("FIG_DEBUG").is_some() {
        let dump = |d: &Document| {
            let scene = Scene::build(d, page);
            let mut out = Vec::new();
            for i in 0..scene.nodes.len() as u32 {
                let p = scene.props(d, i);
                out.push(format!(
                    "{} {} {:?} {:?} glyphs={} fills={}",
                    scene.id(d, i),
                    p.name(),
                    p.size,
                    p.transform.map(|t| (t.m02, t.m12)),
                    p.text_layout.as_ref().map_or(0, |l| l.glyphs.len()),
                    p.fills().len()
                ));
            }
            out
        };
        let (x, y) = (dump(&doc), dump(&reopened));
        for (l, r) in x.iter().zip(&y) {
            if l != r {
                println!("  - {l}\n  + {r}");
            }
        }
        if x.len() != y.len() {
            println!("  node count {} vs {}", x.len(), y.len());
        }
    }
    println!(
        "{}: {id}: before save {:?}, after {:?}, renders {}",
        stem(path),
        text_of(&doc),
        text_of(&reopened),
        if same { "identical" } else { "DIFFER" }
    );
}

fn bench_edit(path: &Path) {
    use fig_engine::edit::{History, Op};
    let Some((_, mut doc)) = open(path) else {
        return;
    };
    // The page with the most layers.
    let page = doc
        .pages
        .iter()
        .copied()
        .max_by_key(|&p| Scene::build(&doc, p).nodes.len())
        .unwrap_or(doc.pages[0]);
    let started = Instant::now();
    let mut scene = Scene::build(&doc, page);
    let build = started.elapsed();
    println!(
        "  page {} with {} scene nodes",
        doc.props(page).name(),
        scene.nodes.len()
    );
    let Some(&first) = doc.node(page).children.first() else {
        return;
    };
    let id = doc
        .props(first)
        .guid
        .map(|g| g.to_string())
        .unwrap_or_default();
    let mut history = History::default();
    let mut time = |ops: &str, coalesce: Option<&str>, doc: &mut Document, scene: &mut Scene| {
        let ops: Vec<Op> = serde_json::from_str(ops).expect("ops");
        let t = Instant::now();
        let applied = history.apply(doc, &ops, coalesce).expect("edit");
        let edit = t.elapsed();
        let t = Instant::now();
        if !scene.refresh(doc, &applied.touched) {
            *scene = Scene::build(doc, page);
        }
        (edit, t.elapsed())
    };
    let mut drag = (std::time::Duration::ZERO, std::time::Duration::ZERO);
    for _ in 0..20 {
        let (e, r) = time(
            &format!(r#"[{{"op":"translate","ids":["{id}"],"dx":3,"dy":2}}]"#),
            Some("drag"),
            &mut doc,
            &mut scene,
        );
        drag.0 += e;
        drag.1 += r;
    }
    let fill = time(
        &format!(r#"[{{"op":"set","ids":["{id}"],"props":{{"fills":[{{"color":"FF0000"}}]}}}}]"#),
        None,
        &mut doc,
        &mut scene,
    );
    let resize = time(
        &format!(r#"[{{"op":"set","ids":["{id}"],"props":{{"width":1000}}}}]"#),
        None,
        &mut doc,
        &mut scene,
    );
    println!(
        "{}: {} nodes, scene {build:?}; drag step edit {:?} + scene {:?}; fill {:?} + {:?}; resize {:?} + {:?}",
        stem(path),
        doc.nodes.len(),
        drag.0 / 20,
        drag.1 / 20,
        fill.0,
        fill.1,
        resize.0,
        resize.1
    );
}

/// The process's peak resident set size in KB (Linux; 0 elsewhere).
fn peak_rss_kb() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find_map(|l| l.strip_prefix("VmHWM:"))
                .and_then(|v| v.trim().trim_end_matches("kB").trim().parse().ok())
        })
        .unwrap_or(0)
}

fn bench(path: &Path, tile: u32, grid: i32) {
    let Ok(bytes) = std::fs::read(path).map(std::sync::Arc::new) else {
        eprintln!("{}: unreadable", path.display());
        return;
    };
    let t = Instant::now();
    let Ok(container) = Container::open_shared(&bytes) else {
        println!("{}: not a .fig file", stem(path));
        return;
    };
    let unpack = t.elapsed();
    let t = Instant::now();
    let doc = match Document::from_container(container) {
        Ok(d) => d,
        Err(e) => {
            println!("{}: ERROR {e}", stem(path));
            return;
        }
    };
    let decode = t.elapsed();
    // The page with the most layers, and how long its first build took.
    let (mut page, mut most, mut first_build) = (doc.pages[0], 0, std::time::Duration::ZERO);
    for &p in &doc.pages {
        let t = Instant::now();
        let n = Scene::build(&doc, p).nodes.len();
        if n > most {
            (page, most, first_build) = (p, n, t.elapsed());
        }
    }
    let t = Instant::now();
    let scene = Scene::build(&doc, page);
    let rebuild = t.elapsed();
    let bounds = scene.node(scene.root()).bounds;
    let opts = RenderOptions {
        outline: false,
        background: Some(doc.page_background(page)),
    };
    let mut images = ImageStore::default();
    // The whole page fitted to a 1920×1080 screen, cold and then warm.
    let scale = (1920.0 / bounds.w).min(1080.0 / bounds.h).min(4.0);
    let fit = Viewport {
        x: bounds.x,
        y: bounds.y,
        scale,
        width: ((bounds.w * scale).ceil() as u32).clamp(1, 1920),
        height: ((bounds.h * scale).ceil() as u32).clamp(1, 1080),
    };
    let t = Instant::now();
    render::render(&doc, &scene, &mut images, &fit, opts);
    let fit_cold = t.elapsed();
    let t = Instant::now();
    render::render(&doc, &scene, &mut images, &fit, opts);
    let fit_warm = t.elapsed();
    // A grid of tiles around the center of the largest top-level layer.
    let focus = scene
        .node(scene.root())
        .children
        .iter()
        .map(|&c| scene.node(c).bounds)
        .max_by(|a, b| (a.w * a.h).total_cmp(&(b.w * b.h)))
        .unwrap_or(bounds);
    let mut tiles = Vec::new();
    for s in [1.0, 2.0] {
        let side = f64::from(tile) / s;
        let cx = ((focus.x + focus.w / 2.0) / side).floor() as i32;
        let cy = ((focus.y + focus.h / 2.0) / side).floor() as i32;
        let t = Instant::now();
        let mut slowest = std::time::Duration::ZERO;
        for iy in cy - grid / 2..cy - grid / 2 + grid {
            for ix in cx - grid / 2..cx - grid / 2 + grid {
                let vp = Viewport {
                    x: f64::from(ix) * side,
                    y: f64::from(iy) * side,
                    scale: s,
                    width: tile,
                    height: tile,
                };
                let one = Instant::now();
                render::render(&doc, &scene, &mut images, &vp, opts);
                slowest = slowest.max(one.elapsed());
            }
        }
        tiles.push(format!(
            "{grid}x{grid} tiles of {tile} at {s}x {:?} (slowest {slowest:?})",
            t.elapsed()
        ));
    }
    // The tiles the viewer asks for when the page is fitted to the screen,
    // and at twice that zoom (at most 64 of each).
    for s in [scale, scale * 2.0] {
        let side = f64::from(tile) / s;
        let (x0, y0) = ((bounds.x / side).floor(), (bounds.y / side).floor());
        let (x1, y1) = (
            (bounds.right() / side).floor(),
            (bounds.bottom() / side).floor(),
        );
        let t = Instant::now();
        let (mut count, mut slowest) = (0, std::time::Duration::ZERO);
        let mut iy = y0;
        while iy <= y1 && count < 64 {
            let mut ix = x0;
            while ix <= x1 && count < 64 {
                let vp = Viewport {
                    x: ix * side,
                    y: iy * side,
                    scale: s,
                    width: tile,
                    height: tile,
                };
                let one = Instant::now();
                render::render(&doc, &scene, &mut images, &vp, opts);
                slowest = slowest.max(one.elapsed());
                count += 1;
                ix += 1.0;
            }
            iy += 1.0;
        }
        tiles.push(format!(
            "{count} fit tiles at {s:.3}x {:?} (slowest {slowest:?})",
            t.elapsed()
        ));
    }
    println!(
        "{}: unpack {unpack:?} decode {decode:?}; page {:?} ({most} layers) first build \
         {first_build:?}, again {rebuild:?}; fit {}x{} cold {fit_cold:?} warm {fit_warm:?}; {}",
        stem(path),
        doc.props(page).name(),
        fit.width,
        fit.height,
        tiles.join(", ")
    );
}
