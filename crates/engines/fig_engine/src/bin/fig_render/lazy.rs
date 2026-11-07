//! `fig_render lazy`: opens each file lazily (as the browser does), times
//! the first page, and checks that every page's scene and the completed
//! document match a full open.

use super::stem;
use fig_engine::images::ImageStore;
use fig_engine::model::Props;
use fig_engine::render::{self, RenderOptions, Viewport};
use fig_engine::{Document, Scene};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

/// Whether two nodes' properties are the same (NaN included, which files
/// carry and `==` never matches).
fn same(a: &Props, b: &Props) -> bool {
    a == b || format!("{a:?}") == format!("{b:?}")
}

/// Scene nodes whose properties differ between the two scenes (or `None`
/// when the trees differ), and how many lazy scene nodes are undecoded.
fn scene_diff(full: &Document, a: &Scene, lazy: &Document, b: &Scene) -> (Option<usize>, usize) {
    let undecoded = b.nodes.iter().filter(|n| !lazy.is_decoded(n.src)).count();
    if a.nodes.len() != b.nodes.len() {
        return (None, undecoded);
    }
    let differ = (0..a.nodes.len() as u32)
        .filter(|&i| {
            let (x, y) = (a.node(i), b.node(i));
            x.src != y.src
                || x.children != y.children
                || x.bounds != y.bounds
                || !same(a.props(full, i), b.props(lazy, i))
        })
        .count();
    (Some(differ), undecoded)
}

/// The page fitted into 256 px, premultiplied RGBA.
fn small(doc: &Document, scene: &Scene) -> Vec<u8> {
    let b = scene.node(scene.root()).bounds;
    if b.is_empty() {
        return Vec::new();
    }
    let scale = (256.0 / b.w.max(b.h)).min(1.0);
    render::render(
        doc,
        scene,
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
            background: Some(doc.page_background(scene.page)),
        },
    )
    .map(|p| p.take())
    .unwrap_or_default()
}

pub fn check(path: &Path) {
    let Ok(bytes) = std::fs::read(path).map(Arc::new) else {
        eprintln!("{}: unreadable", path.display());
        return;
    };
    let t = Instant::now();
    let Ok(full) = Document::open_shared(&bytes) else {
        println!("{}: does not open", stem(path));
        return;
    };
    let full_open = t.elapsed();
    let t = Instant::now();
    let mut lazy = match Document::open_lazy(&bytes) {
        Ok(d) => d,
        Err(e) => {
            println!("{}: lazy open failed: {e}", stem(path));
            return;
        }
    };
    let lazy_open = t.elapsed();
    let decoded = (0..lazy.nodes.len() as u32)
        .filter(|&i| lazy.is_decoded(i))
        .count();
    let mut problems = Vec::new();
    let mut first_page = std::time::Duration::ZERO;
    for (n, &page) in full.pages.iter().enumerate() {
        let a = Scene::build(&full, page);
        let t = Instant::now();
        if let Err(e) = lazy.decode_page(page) {
            problems.push(format!("page {n}: {e}"));
        }
        let b = Scene::build(&lazy, page);
        if n == 0 {
            first_page = t.elapsed();
            if small(&full, &a) != small(&lazy, &b) {
                problems.push("page 0 renders differently".into());
            }
        }
        match scene_diff(&full, &a, &lazy, &b) {
            (Some(0), 0) => {}
            (differ, undecoded) => problems.push(format!(
                "page {n}: {} scene nodes differ, {undecoded} undecoded",
                differ.map_or("tree".into(), |d| d.to_string())
            )),
        }
    }
    let t = Instant::now();
    if let Err(e) = lazy.complete() {
        problems.push(format!("complete: {e}"));
    }
    let complete = t.elapsed();
    let differ = full
        .nodes
        .iter()
        .zip(&lazy.nodes)
        .filter(|(a, b)| {
            !same(&a.props, &b.props) || a.children != b.children || a.parent != b.parent
        })
        .count();
    if differ > 0 || full.nodes.len() != lazy.nodes.len() {
        problems.push(format!("{differ} nodes differ once complete"));
    }
    let mut ia: Vec<_> = full.images.keys().collect();
    let mut ib: Vec<_> = lazy.images.keys().collect();
    ia.sort();
    ib.sort();
    if ia != ib || full.by_override_key != lazy.by_override_key || full.pages != lazy.pages {
        problems.push("images, override keys, or pages differ".into());
    }
    println!(
        "{}: full open {full_open:?}, lazy open {lazy_open:?} (decoded {decoded} of {} nodes; \
         page 0 scene {first_page:?}), rest after every page {complete:?}: {}",
        stem(path),
        lazy.nodes.len(),
        if problems.is_empty() {
            "same".to_owned()
        } else {
            problems.join("; ")
        }
    );
}
