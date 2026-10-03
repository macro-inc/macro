//! `pptx_corpus roundtrip`: for every corpus deck, check that a no-op save is
//! lossless, that content edits leave other slides' renders untouched, that
//! structural edits keep the package sound, and that undoing everything
//! restores the original bytes.

use super::corpus::{self, Deck, FINGERPRINT_WIDTH};
use pptx_engine::edit::{EditOp, NewShape, RunPatch, TextPos};
use pptx_engine::font::FontDb;
use pptx_engine::inspect::ShapeKindName;
use pptx_engine::opc::Package;
use pptx_engine::{Editor, Error, Presentation, fidelity};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Options of `pptx_corpus roundtrip`.
#[derive(clap::Args)]
pub struct Args {
    /// Corpus directory (default: the crate's tests/corpus).
    #[arg(long)]
    corpus: Option<PathBuf>,
    /// Write each edited deck here (`<stem>.pptx`).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Only decks whose corpus path contains one of these strings.
    #[arg(long, value_delimiter = ',')]
    only: Vec<String>,
    /// Also convert every edited deck to PDF with LibreOffice and check its page count.
    #[arg(long, requires = "out")]
    libreoffice: bool,
    /// Worker threads.
    #[arg(long)]
    jobs: Option<usize>,
}

type Problems = Vec<String>;

fn fingerprints(pres: &mut Presentation, fonts: &FontDb) -> Result<HashMap<u32, String>, Error> {
    let ids: Vec<u32> = pres.slides().iter().map(|s| s.id).collect();
    let mut out = HashMap::new();
    for (i, id) in ids.into_iter().enumerate() {
        out.insert(id, fidelity::fingerprint(&pres.render_slide(i, FINGERPRINT_WIDTH, fonts)?));
    }
    Ok(out)
}

/// Parts whose bytes differ between two packages (or exist in only one).
fn package_differences(a: &Package, b: &Package) -> Vec<String> {
    let mut diffs = Vec::new();
    for name in a.part_names() {
        match (a.read(name), b.read(name)) {
            (Ok(x), Ok(y)) if x == y => {}
            (Ok(_), Ok(_)) => diffs.push(format!("{name} changed")),
            _ => diffs.push(format!("{name} missing")),
        }
    }
    for name in b.part_names() {
        if !a.has_part(name) {
            diffs.push(format!("{name} added"));
        }
    }
    diffs
}

/// The first top-level shape with editable, non-empty text.
fn text_target(pres: &mut Presentation, index: usize) -> Option<(u32, usize)> {
    let outline = pres.slide_outline(index).ok()?;
    outline
        .shapes
        .iter()
        .filter(|s| s.text_editable && matches!(s.kind, ShapeKindName::Text | ShapeKindName::Shape))
        .find_map(|s| s.paragraphs.first().filter(|p| !p.text.is_empty()).map(|_| (s.id, 0)))
}

fn check(deck: &Deck, out: Option<&Path>) -> Result<Problems, Box<dyn std::error::Error>> {
    let mut problems = Vec::new();
    let source = std::fs::read(&deck.path)?;
    if corpus::is_lfs_pointer(&source) {
        return Ok(vec!["Git LFS pointer; run `git lfs pull`".into()]);
    }
    let original = Package::open(source.clone())?;
    let fonts = FontDb::global();

    // 1. A save without edits keeps every part's bytes.
    let mut pres = Presentation::open(source.clone())?;
    let resaved = Package::open(pres.save()?)?;
    problems.extend(package_differences(&original, &resaved).into_iter().map(|d| format!("no-op save: {d}")));

    // 2. Content edits on the first slides leave every other slide's render unchanged.
    let before = fingerprints(&mut pres, fonts)?;
    let ids: Vec<u32> = pres.slides().iter().map(|s| s.id).collect();
    let Some(&first) = ids.first() else { return Ok(problems) };
    let mut ed = Editor::new(pres);
    let mut batches: Vec<Vec<EditOp>> = Vec::new();
    if let Some((shape, paragraph)) = text_target(ed.presentation_mut(), 0) {
        let at = TextPos { paragraph, offset: 0 };
        batches.push(vec![
            EditOp::InsertText { slide: first, shape, cell: None, at, text: "Edited · ".into() },
            EditOp::FormatText {
                slide: first,
                shape,
                cell: None,
                start: Some(at),
                end: Some(TextPos { paragraph, offset: 9 }),
                props: RunPatch { bold: Some(true), color: Some("C00000".into()), ..RunPatch::default() },
            },
        ]);
    }
    batches.push(vec![EditOp::AddShape {
        slide: first,
        shape: NewShape::TextBox { text: "Added by pptx_engine".into() },
        x: 24.0,
        y: 24.0,
        w: 360.0,
        h: 40.0,
    }]);
    if let Some(&second) = ids.get(1) {
        batches.push(vec![EditOp::SetNotes { slide: second, text: "Notes written by pptx_engine".into() }]);
    }
    for b in &batches {
        if let Err(e) = ed.apply(b, None, fonts) {
            problems.push(format!("content edit {b:?} failed: {e}"));
        }
    }
    let after = fingerprints(ed.presentation_mut(), fonts)?;
    for (id, fp) in &before {
        if *id != first && after.get(id) != Some(fp) {
            problems.push(format!("slide id {id} rendered differently after edits to slide id {first}"));
        }
    }

    // 3. Structural edits keep the package sound.
    let mut structural = vec![EditOp::DuplicateSlide { slide: first }];
    if ids.len() >= 3 {
        structural.push(EditOp::MoveSlide { slide: ids[ids.len() - 1], to: 0 });
    }
    if ids.len() >= 4 {
        structural.push(EditOp::DeleteSlide { slide: ids[2] });
    }
    for op in structural {
        if let Err(e) = ed.apply(std::slice::from_ref(&op), None, fonts) {
            problems.push(format!("{op:?} failed: {e}"));
        }
    }
    let add = |title: Option<&str>, body: Option<&str>| EditOp::AddSlide {
        layout: None,
        after: Some(first),
        title: title.map(str::to_owned),
        body: body.map(str::to_owned),
    };
    let added = ed.apply(&[add(Some("New slide"), Some("First point\nSecond point"))], None, fonts);
    if let Err(Error::InvalidEdit(_)) = added {
        if let Err(e) = ed.apply(&[add(None, None)], None, fonts) {
            problems.push(format!("AddSlide failed: {e}"));
        }
    } else if let Err(e) = added {
        problems.push(format!("AddSlide failed: {e}"));
    }
    let edited = ed.save()?;
    let mut reopened = Presentation::open(edited.clone())?;
    problems.extend(reopened.integrity_problems()?.into_iter().map(|p| format!("after edits: {p}")));
    for i in 0..reopened.slides().len() {
        if let Err(e) = reopened.render_slide(i, FINGERPRINT_WIDTH, fonts) {
            problems.push(format!("edited slide {} failed to render: {e}", i + 1));
        }
    }
    if let Some(dir) = out {
        std::fs::write(dir.join(format!("{}.pptx", deck.stem())), &edited)?;
    }

    // 4. Undoing everything restores the original bytes.
    while ed.can_undo() {
        ed.undo();
    }
    let restored = Package::open(ed.save()?)?;
    problems.extend(package_differences(&original, &restored).into_iter().map(|d| format!("after undo: {d}")));
    Ok(problems)
}

/// Converts an edited deck with LibreOffice and compares the page count to the slide count.
fn libreoffice_check(file: &Path, profile: &Path) -> Result<(), String> {
    let out = file.with_extension("lo");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let status = Command::new("soffice")
        .arg(format!("-env:UserInstallation=file://{}", profile.display()))
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&out)
        .arg(file)
        .output()
        .map_err(|e| format!("soffice: {e}"))?;
    let pdf = out.join(file.with_extension("pdf").file_name().unwrap_or_default());
    if !pdf.exists() {
        return Err(format!("LibreOffice could not convert it: {}", String::from_utf8_lossy(&status.stderr)));
    }
    let info = Command::new("pdfinfo").arg(&pdf).output().map_err(|e| format!("pdfinfo: {e}"))?;
    let pages = String::from_utf8_lossy(&info.stdout)
        .lines()
        .find_map(|l| l.strip_prefix("Pages:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
        .unwrap_or(0);
    let slides = Presentation::open(std::fs::read(file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?.slides().len();
    let hidden_ok = pages <= slides && pages > 0;
    if !hidden_ok {
        return Err(format!("LibreOffice produced {pages} pages for {slides} slides"));
    }
    Ok(())
}

/// Runs the command; returns whether every deck passed.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let root = args.corpus.clone().unwrap_or_else(corpus::default_corpus);
    let decks = corpus::discover(&root, &args.only)?;
    if let Some(out) = &args.out {
        std::fs::create_dir_all(out)?;
    }
    let jobs = args.jobs.unwrap_or_else(corpus::default_jobs);
    let results = corpus::par_map(&decks, jobs, |d| check(d, args.out.as_deref()).map_err(|e| e.to_string()));
    let mut failed = 0;
    for (deck, result) in decks.iter().zip(&results) {
        match result {
            Ok(p) if p.is_empty() => println!("ok      {}", deck.key),
            Ok(p) => {
                failed += 1;
                println!("FAILED  {}", deck.key);
                for problem in p.iter().take(20) {
                    println!("        - {problem}");
                }
            }
            Err(e) => {
                failed += 1;
                println!("ERROR   {}: {e}", deck.key);
            }
        }
    }
    if args.libreoffice {
        if let Some(out) = &args.out {
            let lo_jobs = (jobs / 2).max(1);
            let checks = corpus::par_map(&decks, lo_jobs, |d| {
                let profile = std::env::temp_dir().join(format!("pptx-roundtrip-lo-{}", d.stem()));
                libreoffice_check(&out.join(format!("{}.pptx", d.stem())), &profile)
            });
            for (deck, c) in decks.iter().zip(checks) {
                if let Err(e) = c {
                    failed += 1;
                    println!("LIBREOFFICE {}: {e}", deck.key);
                }
            }
        }
    }
    println!("{} decks, {failed} failed", decks.len());
    Ok(failed == 0)
}
