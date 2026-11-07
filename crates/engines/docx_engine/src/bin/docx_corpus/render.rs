//! `docx_corpus render`: PNG pages of documents.

use docx_engine::Document;
use docx_engine::render::ImageCache;
use pptx_engine::font::FontDb;
use std::path::PathBuf;
use std::time::Instant;

/// Options of `docx_corpus render`.
#[derive(clap::Args)]
pub struct Args {
    /// Output directory (one subdirectory per document).
    #[arg(long)]
    out: PathBuf,
    /// Page width in pixels.
    #[arg(long, default_value_t = 816)]
    width: u32,
    /// Only the first N pages.
    #[arg(long)]
    pages: Option<usize>,
    /// Documents.
    files: Vec<PathBuf>,
}

/// Runs the command.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let fonts = FontDb::global();
    let mut ok = true;
    for file in &args.files {
        let stem = file
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "doc".into());
        let started = Instant::now();
        let doc = match Document::open(std::fs::read(file)?) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("{}: {e}", file.display());
                ok = false;
                continue;
            }
        };
        let opened = started.elapsed();
        let layout = doc.layout(fonts);
        let laid = started.elapsed() - opened;
        let dir = args.out.join(&stem);
        std::fs::create_dir_all(&dir)?;
        let mut images = ImageCache::new();
        let count = args
            .pages
            .map_or(layout.pages.len(), |n| n.min(layout.pages.len()));
        for i in 0..count {
            if let Some(r) = doc.render_page(&layout, i, args.width, fonts, &mut images) {
                std::fs::write(dir.join(format!("page-{:03}.png", i + 1)), r.to_png())?;
            }
        }
        println!(
            "{stem}: {} pages (open {:.0} ms, layout {:.0} ms, total {:.0} ms)",
            layout.pages.len(),
            opened.as_secs_f64() * 1000.0,
            laid.as_secs_f64() * 1000.0,
            started.elapsed().as_secs_f64() * 1000.0
        );
    }
    Ok(ok)
}
