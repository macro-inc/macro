//! `fig_render library`: publishes each file as a team library, checks the
//! publish survives saving (no changes left to publish after reopening),
//! then places up to eight of its published components in a blank design
//! through library packages, saves that, and checks each instance in the
//! reopened design draws what the library's component draws.

use fig_engine::edit::{History, LibrarySpec, Op};
use fig_engine::images::ImageStore;
use fig_engine::library::{self, AssetKind};
use fig_engine::render::{RenderOptions, render_node};
use fig_engine::{Document, Scene};
use std::path::Path;

/// Components placed per file.
const LIMIT: usize = 8;

/// A component's (or instance's) pixels at a small scale.
fn pixels(doc: &Document, id: &str) -> Option<(u32, u32, Vec<u8>)> {
    let guid = fig_engine::model::Guid::parse(id)?;
    let i = doc.find(guid)?;
    let canvas = doc.page_of(i)?;
    let scene = Scene::build(doc, canvas);
    let at = scene.find(doc, id)?;
    let b = scene.node(at).bounds;
    let scale = (128.0 / b.w.max(b.h).max(1.0)).min(1.0);
    let p = render_node(
        doc,
        &scene,
        &mut ImageStore::default(),
        at,
        scale,
        RenderOptions::default(),
    )?;
    Some((p.width(), p.height(), p.data().to_vec()))
}

/// The share of channel values within 8 of each other (sizes must match).
fn similarity(a: &(u32, u32, Vec<u8>), b: &(u32, u32, Vec<u8>)) -> f64 {
    if (a.0, a.1) != (b.0, b.1) || a.2.is_empty() {
        return 0.0;
    }
    let close = a
        .2
        .iter()
        .zip(&b.2)
        .filter(|(x, y)| x.abs_diff(**y) <= 8)
        .count();
    close as f64 / a.2.len() as f64
}

pub fn check(path: &Path) {
    let name = path.display();
    let Ok(bytes) = std::fs::read(path) else {
        println!("{name}: unreadable");
        return;
    };
    let mut doc = match Document::open(&bytes) {
        Ok(d) => d,
        Err(e) => {
            println!("{name}: {e}");
            return;
        }
    };
    let ops: Vec<Op> = serde_json::from_str(r#"[{"op":"publishLibrary","seed":"check"}]"#)
        .expect("the publish op parses");
    if let Err(e) = History::default().apply(&mut doc, &ops, None) {
        println!("{name}: PUBLISH FAILED: {e}");
        return;
    }
    let left = library::status(&doc).changes.len();
    let saved = match fig_engine::save::save(&doc, &bytes) {
        Ok(s) => s,
        Err(e) => {
            println!("{name}: SAVE FAILED: {e}");
            return;
        }
    };
    let lib = match Document::open(&saved) {
        Ok(d) => d,
        Err(e) => {
            println!("{name}: REOPEN FAILED: {e}");
            return;
        }
    };
    let status = library::status(&lib);
    let published = library::published(&lib);
    print!(
        "{name}: {} assets, {} changed after publishing, {} after reopening",
        published.assets.len(),
        left,
        status.changes.len()
    );
    if !status.changes.is_empty() {
        let names: Vec<&str> = status
            .changes
            .iter()
            .take(4)
            .map(|c| c.name.as_str())
            .collect();
        print!(" {names:?}");
    }
    let components: Vec<_> = published
        .assets
        .iter()
        .filter(|a| a.kind == AssetKind::Component)
        .take(LIMIT)
        .collect();
    if components.is_empty() {
        println!();
        return;
    }
    let blank = fig_engine::save::blank("Uses");
    let mut app = Document::open(&blank).expect("a blank design opens");
    let mut history = History::default();
    let mut placed = Vec::new();
    for (k, c) in components.iter().enumerate() {
        let package = match library::package(&lib, &saved, std::slice::from_ref(&c.key)) {
            Ok(p) => p,
            Err(e) => {
                println!(" PACKAGE FAILED: {e}");
                return;
            }
        };
        let spec = serde_json::json!({
            "library": "check",
            "then": [{"op": "instantiate", "component": format!("key:{}", c.key),
                      "parent": "0:1", "x": (k as f64) * 400.0, "y": 0}],
        });
        let spec: LibrarySpec = serde_json::from_value(spec).expect("the spec parses");
        match history.import_library(
            &mut app,
            &blank,
            &package.document,
            Some(&package.images),
            &spec,
        ) {
            Ok(applied) => placed.extend(applied.created.into_iter().map(|id| (id, c.id.clone()))),
            Err(e) => {
                println!(" IMPORT FAILED: {e}");
                return;
            }
        }
    }
    let reopened = match fig_engine::save::save(&app, &blank).and_then(|b| Document::open(&b)) {
        Ok(d) => d,
        Err(e) => {
            println!(" USE SAVE FAILED: {e}");
            return;
        }
    };
    let mut scores = Vec::new();
    for (instance, component) in &placed {
        let (Some(a), Some(b)) = (pixels(&reopened, instance), pixels(&lib, component)) else {
            continue;
        };
        scores.push(similarity(&a, &b));
    }
    let mean = scores.iter().sum::<f64>() / scores.len().max(1) as f64;
    let low = scores.iter().filter(|&&s| s < 0.95).count();
    println!(
        "; placed {} components, similarity {:.1}%{}",
        placed.len(),
        mean * 100.0,
        if low > 0 {
            format!(" ({low} below 95%)")
        } else {
            String::new()
        }
    );
}
