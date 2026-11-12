//! `docx_corpus score`: renders documents and compares every page with
//! reference renders (LibreOffice, and Word where a Word PDF exists).

use docx_engine::Document;
use docx_engine::render::ImageCache;
use pptx_engine::fidelity::{self, Score};
use pptx_engine::font::FontDb;
use pptx_engine::render::image::decode_raster;
use pptx_engine::render::scene::Raster;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

/// Options of `docx_corpus score`.
#[derive(clap::Args)]
pub struct Args {
    /// Reference renders (OUT_DIR of scripts/render_references.py).
    #[arg(long)]
    refs: PathBuf,
    /// Directory for our renders and report.html.
    #[arg(long)]
    out: PathBuf,
    /// Page width in pixels (must match the references).
    #[arg(long, default_value_t = 816)]
    width: u32,
    /// Worker threads.
    #[arg(long, default_value_t = 4)]
    jobs: usize,
    /// Documents.
    files: Vec<PathBuf>,
}

/// Scores of one document against one reference set.
#[derive(Clone, Debug, Default, Serialize)]
pub struct RefScore {
    /// Reference page count.
    pub pages: usize,
    /// Per-page scores (pages both have).
    pub page_scores: Vec<Score>,
    /// Mean SSIM over the compared pages.
    pub ssim: f32,
}

/// Results for one document.
#[derive(Clone, Debug, Default, Serialize)]
pub struct DocResult {
    /// File stem.
    pub stem: String,
    /// Our page count.
    pub pages: usize,
    /// Layout + render time.
    pub millis: u128,
    /// Error, when the document failed.
    pub error: Option<String>,
    /// Against LibreOffice.
    pub lo: Option<RefScore>,
    /// Against Word.
    pub word: Option<RefScore>,
}

fn load_refs(dir: &Path) -> Vec<Raster> {
    let mut out = Vec::new();
    for i in 1.. {
        let p = dir.join(format!("page-{i:03}.png"));
        let Ok(bytes) = std::fs::read(&p) else {
            break;
        };
        match decode_raster(&bytes) {
            Ok(r) => out.push(r),
            Err(_) => break,
        }
    }
    out
}

fn score(ours: &[Raster], refs: &[Raster]) -> RefScore {
    let n = ours.len().min(refs.len());
    let page_scores: Vec<Score> = (0..n)
        .map(|i| fidelity::compare(&ours[i], &refs[i]))
        .collect();
    let ssim = if n == 0 {
        0.0
    } else {
        page_scores.iter().map(|s| s.ssim).sum::<f32>() / n as f32
    };
    RefScore {
        pages: refs.len(),
        page_scores,
        ssim,
    }
}

fn process(file: &Path, args: &Args, fonts: &FontDb) -> DocResult {
    let stem = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let started = Instant::now();
    let mut result = DocResult {
        stem: stem.clone(),
        ..DocResult::default()
    };
    let bytes = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) => {
            result.error = Some(e.to_string());
            return result;
        }
    };
    let doc = match Document::open(bytes) {
        Ok(d) => d,
        Err(e) => {
            result.error = Some(e.to_string());
            return result;
        }
    };
    let layout = doc.layout(fonts);
    let mut images = ImageCache::new();
    let dir = args.out.join(&stem);
    let _ = std::fs::create_dir_all(&dir);
    let mut ours = Vec::new();
    for i in 0..layout.pages.len() {
        if let Some(r) = doc.render_page(&layout, i, args.width, fonts, &mut images) {
            let _ = std::fs::write(dir.join(format!("page-{:03}.png", i + 1)), r.to_png());
            ours.push(r);
        }
    }
    result.millis = started.elapsed().as_millis();
    result.pages = ours.len();
    let lo = load_refs(&args.refs.join("lo").join(&stem));
    if !lo.is_empty() {
        result.lo = Some(score(&ours, &lo));
    }
    let word = load_refs(&args.refs.join("word").join(&stem));
    if !word.is_empty() {
        result.word = Some(score(&ours, &word));
    }
    result
}

fn rel(from: &Path, to: &Path) -> String {
    pathdiff(to, from).unwrap_or_else(|| to.display().to_string())
}

fn pathdiff(path: &Path, base: &Path) -> Option<String> {
    let path = std::fs::canonicalize(path).ok()?;
    let base = std::fs::canonicalize(base).ok()?;
    let mut pc = path.components().peekable();
    let mut bc = base.components().peekable();
    while let (Some(a), Some(b)) = (pc.peek(), bc.peek()) {
        if a != b {
            break;
        }
        pc.next();
        bc.next();
    }
    let mut out = PathBuf::new();
    for _ in bc {
        out.push("..");
    }
    for c in pc {
        out.push(c);
    }
    Some(out.display().to_string())
}

fn report(results: &[DocResult], args: &Args) -> std::io::Result<()> {
    let mut html = String::from(
        "<!doctype html><meta charset=utf-8><title>DOCX fidelity</title><style>body{font:13px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:3px 6px}img{width:300px;border:1px solid #ddd;margin:2px}.p{display:flex;gap:4px;align-items:flex-start}.bad{background:#fdd}</style><h1>DOCX fidelity</h1><table><tr><th>document</th><th>pages</th><th>LO pages</th><th>LO SSIM</th><th>Word pages</th><th>Word SSIM</th><th>ms</th></tr>",
    );
    for r in results {
        let lo = r.lo.as_ref();
        let wd = r.word.as_ref();
        let cls = |s: Option<&RefScore>| {
            if s.is_some_and(|s| s.pages != r.pages) {
                " class=bad"
            } else {
                ""
            }
        };
        html.push_str(&format!(
            "<tr><td><a href='#{0}'>{0}</a>{1}</td><td>{2}</td><td{3}>{4}</td><td>{5}</td><td{6}>{7}</td><td>{8}</td><td>{9}</td></tr>",
            r.stem,
            r.error.as_ref().map(|e| format!(" <b>{e}</b>")).unwrap_or_default(),
            r.pages,
            cls(lo),
            lo.map_or("-".into(), |s| s.pages.to_string()),
            lo.map_or("-".into(), |s| format!("{:.3}", s.ssim)),
            cls(wd),
            wd.map_or("-".into(), |s| s.pages.to_string()),
            wd.map_or("-".into(), |s| format!("{:.3}", s.ssim)),
            r.millis
        ));
    }
    html.push_str("</table>");
    for r in results {
        html.push_str(&format!("<h2 id='{0}'>{0}</h2>", r.stem));
        let pages = r
            .pages
            .max(r.lo.as_ref().map_or(0, |s| s.pages))
            .max(r.word.as_ref().map_or(0, |s| s.pages));
        for i in 1..=pages {
            html.push_str(&format!("<div>page {i}"));
            if let Some(s) = r.lo.as_ref().and_then(|s| s.page_scores.get(i - 1)) {
                html.push_str(&format!(" LO ssim {:.3}", s.ssim));
            }
            if let Some(s) = r.word.as_ref().and_then(|s| s.page_scores.get(i - 1)) {
                html.push_str(&format!(" Word ssim {:.3}", s.ssim));
            }
            html.push_str("</div><div class=p>");
            let ours = args.out.join(&r.stem).join(format!("page-{i:03}.png"));
            let lo = args
                .refs
                .join("lo")
                .join(&r.stem)
                .join(format!("page-{i:03}.png"));
            let word = args
                .refs
                .join("word")
                .join(&r.stem)
                .join(format!("page-{i:03}.png"));
            for (label, p) in [("ours", ours), ("LibreOffice", lo), ("Word", word)] {
                if p.exists() {
                    html.push_str(&format!(
                        "<figure><img loading=lazy src='{}'><figcaption>{label}</figcaption></figure>",
                        rel(&args.out, &p)
                    ));
                }
            }
            html.push_str("</div>");
        }
    }
    std::fs::write(args.out.join("report.html"), html)
}

/// Runs the command.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&args.out)?;
    let fonts = FontDb::global();
    let files: Vec<PathBuf> = args.files.clone();
    let queue = Mutex::new(files.iter().enumerate().collect::<Vec<_>>());
    let results: Mutex<Vec<(usize, DocResult)>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..args.jobs.max(1) {
            s.spawn(|| {
                loop {
                    let next = queue.lock().ok().and_then(|mut q| q.pop());
                    let Some((i, f)) = next else {
                        break;
                    };
                    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        process(f, args, fonts)
                    }))
                    .unwrap_or_else(|_| DocResult {
                        stem: f.display().to_string(),
                        error: Some("panicked".into()),
                        ..DocResult::default()
                    });
                    if let Ok(mut rs) = results.lock() {
                        rs.push((i, r));
                    }
                }
            });
        }
    });
    let mut results: Vec<(usize, DocResult)> = results.into_inner().unwrap_or_default();
    results.sort_by_key(|(i, _)| *i);
    let results: Vec<DocResult> = results.into_iter().map(|(_, r)| r).collect();
    println!(
        "{:<60} {:>5} {:>5} {:>7} {:>5} {:>7} {:>7}",
        "document", "pages", "lo", "ssim", "word", "ssim", "ms"
    );
    let (mut lo_sum, mut lo_n, mut wd_sum, mut wd_n) = (0.0, 0, 0.0, 0);
    let (mut lo_pages_ok, mut wd_pages_ok) = (0, 0);
    for r in &results {
        let lo = r.lo.as_ref();
        let wd = r.word.as_ref();
        if let Some(s) = lo {
            lo_sum += s.ssim;
            lo_n += 1;
            lo_pages_ok += usize::from(s.pages == r.pages);
        }
        if let Some(s) = wd {
            wd_sum += s.ssim;
            wd_n += 1;
            wd_pages_ok += usize::from(s.pages == r.pages);
        }
        println!(
            "{:<60} {:>5} {:>5} {:>7} {:>5} {:>7} {:>7}{}",
            r.stem.chars().take(60).collect::<String>(),
            r.pages,
            lo.map_or("-".into(), |s| s.pages.to_string()),
            lo.map_or("-".into(), |s| format!("{:.3}", s.ssim)),
            wd.map_or("-".into(), |s| s.pages.to_string()),
            wd.map_or("-".into(), |s| format!("{:.3}", s.ssim)),
            r.millis,
            r.error
                .as_ref()
                .map(|e| format!("  ERROR {e}"))
                .unwrap_or_default()
        );
    }
    if lo_n > 0 {
        println!(
            "LibreOffice: mean SSIM {:.4} over {lo_n} documents; page counts equal for {lo_pages_ok}",
            lo_sum / lo_n as f32
        );
    }
    if wd_n > 0 {
        println!(
            "Word: mean SSIM {:.4} over {wd_n} documents; page counts equal for {wd_pages_ok}",
            wd_sum / wd_n as f32
        );
    }
    std::fs::write(
        args.out.join("scores.json"),
        serde_json::to_string_pretty(&results)?,
    )?;
    report(&results, args)?;
    Ok(results.iter().all(|r| r.error.is_none()))
}
