//! `fig_render pdf`: "Export frames to PDF" for each file's first page.

use fig_engine::images::ImageStore;
use fig_engine::{Document, Scene};
use std::path::Path;
use std::time::Instant;

pub fn export(path: &Path, out: &Path) {
    let Ok(bytes) = std::fs::read(path) else {
        eprintln!("{}: unreadable", path.display());
        return;
    };
    let doc = match Document::open(&bytes) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{}: {e}", path.display());
            return;
        }
    };
    let Some(&page) = doc.pages.first() else {
        return;
    };
    let started = Instant::now();
    let scene = Scene::build(&doc, page);
    let mut images = ImageStore::default();
    let Some(pdf) = fig_engine::export::frames_pdf(&doc, &scene, &mut images) else {
        println!("{}: no frames", path.display());
        return;
    };
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let pages = pdf.windows(12).filter(|w| w == b"/Type /Page ").count();
    let _ = std::fs::write(out.join(format!("{stem}.pdf")), &pdf);
    println!(
        "{stem}: {pages} pages, {} KB in {:.2}s",
        pdf.len() / 1024,
        started.elapsed().as_secs_f64()
    );
}
