//! `pptx_corpus score`: render the corpus, compare it with LibreOffice
//! reference renders, and check (or update) the fidelity baseline.
//!
//! The baseline is a ratchet: SSIM per slide may only go up unless a drop is
//! accepted explicitly, and render fingerprints catch any visual change even
//! where no reference renders are available (CI).

use super::corpus::{self, Baseline, Deck, FINGERPRINT_WIDTH, SlideBaseline, fingerprint_changed};
use super::report::{self, SlideRow};
use pptx_engine::Presentation;
use pptx_engine::fidelity::{self, Score};
use pptx_engine::font::FontDb;
use pptx_engine::render::image::decode_raster;
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Options of `pptx_corpus score`.
#[derive(clap::Args)]
pub struct Args {
    /// Corpus directory (default: the crate's tests/corpus).
    #[arg(long)]
    corpus: Option<PathBuf>,
    /// LibreOffice reference renders (OUT_DIR of scripts/render_references.py).
    #[arg(long)]
    refs: Option<PathBuf>,
    /// Directory for renders, diffs, and report.html.
    #[arg(long)]
    out: Option<PathBuf>,
    /// Only decks whose corpus path contains one of these strings.
    #[arg(long, value_delimiter = ',')]
    only: Vec<String>,
    /// Record the new results in the baseline.
    #[arg(long)]
    update: bool,
    /// With --update, also record lower scores (deliberate behavior changes).
    #[arg(long)]
    accept_regressions: bool,
    /// Allowed SSIM drop before a slide counts as regressed.
    #[arg(long, default_value_t = 0.005)]
    tolerance: f32,
    /// Worker threads.
    #[arg(long)]
    jobs: Option<usize>,
}

struct SlideResult {
    fingerprint: String,
    score: Option<Score>,
    millis: u128,
    error: Option<String>,
}

struct DeckResult {
    deck: Deck,
    slides: Vec<SlideResult>,
    error: Option<String>,
}

fn process(deck: &Deck, refs: Option<&Path>, out: Option<&Path>, width: u32) -> DeckResult {
    let fail = |e: String| DeckResult {
        deck: deck.clone(),
        slides: Vec::new(),
        error: Some(e),
    };
    let bytes = match std::fs::read(&deck.path) {
        Ok(b) => b,
        Err(e) => return fail(e.to_string()),
    };
    if corpus::is_lfs_pointer(&bytes) {
        return fail("Git LFS pointer; run `git lfs pull`".into());
    }
    let mut pres = match Presentation::open(bytes) {
        Ok(p) => p,
        Err(e) => return fail(e.to_string()),
    };
    let fonts = FontDb::global();
    let dir = out.map(|o| o.join(deck.stem()));
    if let Some(d) = &dir {
        std::fs::create_dir_all(d).ok();
    }
    let mut slides = Vec::new();
    for i in 0..pres.slides().len() {
        let start = Instant::now();
        let mut result = SlideResult {
            fingerprint: String::new(),
            score: None,
            millis: 0,
            error: None,
        };
        match pres.render_slide(i, FINGERPRINT_WIDTH, fonts) {
            Ok(r) => result.fingerprint = fidelity::fingerprint(&r),
            Err(e) => result.error = Some(e.to_string()),
        }
        let reference = refs
            .map(|r| r.join(deck.stem()).join(format!("slide-{:03}.png", i + 1)))
            .filter(|p| p.exists());
        if let (Some(reference), None) = (reference, &result.error) {
            let scored = (|| -> Result<Score, Box<dyn std::error::Error>> {
                let ours = pres.render_slide(i, width, fonts)?;
                let theirs = decode_raster(&std::fs::read(&reference)?)?;
                let score = fidelity::compare(&ours, &theirs);
                if let Some(d) = &dir {
                    std::fs::write(d.join(format!("ours-{:03}.png", i + 1)), ours.to_png())?;
                    std::fs::write(
                        d.join(format!("diff-{:03}.png", i + 1)),
                        fidelity::diff_image(&ours, &theirs).to_png(),
                    )?;
                    std::fs::copy(&reference, d.join(format!("ref-{:03}.png", i + 1)))?;
                }
                Ok(score)
            })();
            match scored {
                Ok(s) => result.score = Some(s),
                Err(e) => result.error = Some(e.to_string()),
            }
        }
        result.millis = start.elapsed().as_millis();
        slides.push(result);
    }
    DeckResult {
        deck: deck.clone(),
        slides,
        error: None,
    }
}

/// Runs the command; returns whether everything passed.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let root = args.corpus.clone().unwrap_or_else(corpus::default_corpus);
    let baseline_path = root.join("baseline.json");
    let mut baseline = Baseline::load(&baseline_path)?;
    let decks = corpus::discover(&root, &args.only)?;
    let jobs = args.jobs.unwrap_or_else(corpus::default_jobs);
    let started = Instant::now();
    let results = corpus::par_map(&decks, jobs, |d| {
        process(
            d,
            args.refs.as_deref(),
            args.out.as_deref(),
            baseline.score_width,
        )
    });

    let mut rows = Vec::new();
    let (mut failures, mut regressions, mut improvements, mut changed) = (0, 0, 0, 0);
    for r in &results {
        if let Some(e) = &r.error {
            println!("ERROR {}: {e}", r.deck.key);
            failures += 1;
            continue;
        }
        let old = baseline.decks.get(&r.deck.key);
        if old.is_some_and(|o| o.len() != r.slides.len()) {
            println!(
                "CHANGED {}: {} slides (baseline has {})",
                r.deck.key,
                r.slides.len(),
                old.map_or(0, Vec::len)
            );
            changed += 1;
        }
        for (i, s) in r.slides.iter().enumerate() {
            let prev = old.and_then(|o| o.get(i));
            let label = format!("{} #{}", r.deck.key, i + 1);
            if let Some(e) = &s.error {
                println!("ERROR {label}: {e}");
                failures += 1;
            }
            let fp_changed = prev.is_some_and(|p| {
                !p.unstable && fingerprint_changed(&p.fingerprint, &s.fingerprint)
            });
            if fp_changed {
                changed += 1;
                println!("CHANGED {label}: render fingerprint differs from the baseline");
            }
            let delta = match (s.score, prev.and_then(|p| p.ssim)) {
                (Some(new), Some(old)) => Some(new.ssim - old),
                _ => None,
            };
            if delta.is_some_and(|d| d < -args.tolerance) {
                regressions += 1;
                println!(
                    "REGRESSED {label}: ssim {:.4} → {:.4}",
                    prev.and_then(|p| p.ssim).unwrap_or(0.0),
                    s.score.map_or(0.0, |x| x.ssim)
                );
            } else if delta.is_some_and(|d| d > args.tolerance) {
                improvements += 1;
            }
            rows.push(SlideRow {
                deck: r.deck.key.clone(),
                stem: r.deck.stem(),
                slide: i + 1,
                score: s.score,
                baseline_ssim: prev.and_then(|p| p.ssim),
                note: prev.and_then(|p| p.note.clone()),
                millis: s.millis,
                fingerprint_changed: fp_changed,
                error: s.error.clone(),
            });
        }
    }

    let scored: Vec<f32> = rows
        .iter()
        .filter_map(|r| r.score.map(|s| s.ssim))
        .collect();
    let mean = if scored.is_empty() {
        0.0
    } else {
        scored.iter().sum::<f32>() / scored.len() as f32
    };
    println!(
        "{} decks, {} slides in {:.1}s; {} scored (mean SSIM {:.4}); {regressions} regressed, {improvements} improved, {changed} changed, {failures} errors",
        results.len(),
        rows.len(),
        started.elapsed().as_secs_f32(),
        scored.len(),
        mean
    );
    if let Some(out) = &args.out {
        report::write(out, &rows)?;
        println!("report: {}", out.join("report.html").display());
    }

    if args.update {
        if regressions > 0 && !args.accept_regressions {
            println!(
                "not updating: {regressions} slides regressed (pass --accept-regressions to record them)"
            );
            return Ok(false);
        }
        if args.only.is_empty() {
            let keys: Vec<&str> = results.iter().map(|r| r.deck.key.as_str()).collect();
            baseline.decks.retain(|k, _| keys.contains(&k.as_str()));
        }
        if let Some(refs) = &args.refs
            && let Some(version) = reference_version(refs)
        {
            baseline.reference = version;
        }
        for r in results.iter().filter(|r| r.error.is_none()) {
            let old = baseline.decks.get(&r.deck.key).cloned().unwrap_or_default();
            let slides = r
                .slides
                .iter()
                .enumerate()
                .map(|(i, s)| {
                    let prev = old.get(i).cloned().unwrap_or_default();
                    SlideBaseline {
                        fingerprint: s.fingerprint.clone(),
                        ssim: s.score.map(|x| round4(x.ssim)).or(prev.ssim),
                        mismatch: s.score.map(|x| round4(x.mismatch)).or(prev.mismatch),
                        note: prev.note,
                        unstable: prev.unstable,
                    }
                })
                .collect();
            baseline.decks.insert(r.deck.key.clone(), slides);
        }
        baseline.save(&baseline_path)?;
        println!("baseline updated: {}", baseline_path.display());
        return Ok(failures == 0);
    }
    Ok(failures == 0 && regressions == 0 && changed == 0)
}

fn round4(v: f32) -> f32 {
    (v * 10_000.0).round() / 10_000.0
}

/// The LibreOffice version recorded by `render_references.py`.
fn reference_version(refs: &Path) -> Option<String> {
    let entries = std::fs::read_dir(refs).ok()?;
    for e in entries.flatten() {
        let meta = e.path().join("meta.json");
        if let Ok(bytes) = std::fs::read(&meta) {
            let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
            if let Some(s) = v.get("libreoffice_version").and_then(|s| s.as_str()) {
                // `pptx_corpus fontconfig` gives LibreOffice the engine's fonts.
                let fonts = if v.get("fontconfig_sha256").is_some_and(|f| !f.is_null()) {
                    ", engine fonts"
                } else {
                    ""
                };
                return Some(format!("{s}{fonts}"));
            }
        }
    }
    None
}
