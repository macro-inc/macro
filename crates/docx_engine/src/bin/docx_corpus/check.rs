//! `docx_corpus check`: every document through the engine's paths, not only
//! rendering: layout and every page drawn, the collaborative state round
//! trip, edits with undo and redo, tracked changes, a header edit, copy and
//! paste, and saving and reopening. Any panic or mismatch fails the document.

use docx_engine::Document;
use docx_engine::collab::CollabState;
use docx_engine::edit::{EditOp, Pos, Session};
use docx_engine::render::ImageCache;
use pptx_engine::font::FontDb;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::time::Instant;

/// Options of `docx_corpus check`.
#[derive(clap::Args)]
pub struct Args {
    /// Page width in pixels for the render pass.
    #[arg(long, default_value_t = 200)]
    width: u32,
    /// Documents.
    files: Vec<PathBuf>,
}

type Check = Result<(), String>;

fn texts(doc: &Document) -> Vec<String> {
    doc.body()
        .paragraphs()
        .iter()
        .filter_map(|id| doc.body().get(id).map(|b| b.content.text()))
        .collect()
}

fn ensure(ok: bool, what: impl FnOnce() -> String) -> Check {
    if ok { Ok(()) } else { Err(what()) }
}

fn apply(s: &mut Session, ops: Vec<EditOp>, fonts: &FontDb) -> Check {
    s.apply(&ops, None, fonts)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Applies an edit that must change the document.
fn change(s: &mut Session, op: EditOp, fonts: &FontDb) -> Check {
    let what = format!("{op:?}");
    let sel = format!("{:?}", s.selection());
    let r = s.apply(&[op], None, fonts).map_err(|e| e.to_string())?;
    ensure(r.changed, || format!("{what} at {sel} changed nothing"))
}

/// Applies an edit that may legitimately change nothing (deleting across
/// empty table cells); returns whether it changed the document.
fn maybe(s: &mut Session, op: EditOp, fonts: &FontDb) -> Result<bool, String> {
    let r = s.apply(&[op], None, fonts).map_err(|e| e.to_string())?;
    Ok(r.changed)
}

fn select(s: &mut Session, a: Pos, f: Pos, fonts: &FontDb) -> Check {
    apply(
        s,
        vec![EditOp::Select {
            anchor: a,
            focus: f,
        }],
        fonts,
    )
}

/// Paragraphs to edit: up to `n`, spread through the document.
fn targets(doc: &Document, n: usize) -> Vec<(docx_engine::model::block::BlockId, usize)> {
    let ids = doc.body().paragraphs();
    if ids.is_empty() {
        return Vec::new();
    }
    let step = (ids.len() / n).max(1);
    ids.iter()
        .step_by(step)
        .take(n)
        .filter_map(|id| Some((id.clone(), doc.body().get(id)?.content.len())))
        .collect()
}

fn check_render(doc: &Document, width: u32, fonts: &FontDb) -> Result<usize, String> {
    let layout = doc.layout(fonts);
    let mut images = ImageCache::new();
    for i in 0..layout.pages.len() {
        doc.render_page(&layout, i, width, fonts, &mut images)
            .ok_or_else(|| format!("page {i} did not render"))?;
    }
    Ok(layout.pages.len())
}

fn check_collab(doc: &Document, pages: usize, fonts: &FontDb) -> Check {
    let state = doc.collab_state().map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    let back: CollabState = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let shared = Document::from_collab_state(&back, 7).map_err(|e| e.to_string())?;
    ensure(texts(&shared) == texts(doc), || {
        "shared text differs".into()
    })?;
    let shared_pages = shared.layout(fonts).pages.len();
    ensure(shared_pages == pages, || {
        format!("shared state lays out {shared_pages} pages, the file {pages}")
    })?;
    // The shared state saves as a package that opens again.
    let saved = shared.save().map_err(|e| e.to_string())?;
    let reopened = Document::open(saved).map_err(|e| e.to_string())?;
    ensure(texts(&reopened) == texts(doc), || {
        "saved shared state differs".into()
    })
}

fn check_edits(doc: &Document, fonts: &FontDb) -> Check {
    let original = texts(doc);
    let mut s = Session::new(doc.clone());
    // Plain edits: a document saved with Track Changes on records them.
    apply(&mut s, vec![EditOp::SetTracking { on: false }], fonts)?;
    let mut steps = 0;
    for (id, len) in targets(doc, 8) {
        let at = Pos::new(id, len.min(3));
        select(&mut s, at.clone(), at, fonts)?;
        change(&mut s, EditOp::InsertText { text: "XYZ".into() }, fonts)?;
        steps += 1;
    }
    // Enter in the middle of a paragraph, and a delete across two.
    let ids = s.document().body().paragraphs();
    if let Some(id) = ids.get(ids.len() / 2) {
        let len = s.document().body().get(id).map_or(0, |b| b.content.len());
        let at = Pos::new(id.clone(), len / 2);
        select(&mut s, at.clone(), at, fonts)?;
        change(&mut s, EditOp::InsertParagraph, fonts)?;
        steps += 1;
    }
    let ids = s.document().body().paragraphs();
    if ids.len() > 4 {
        let a = &ids[ids.len() / 3];
        let b = &ids[ids.len() / 3 + 1];
        let a_len = s.document().body().get(a).map_or(0, |x| x.content.len());
        let b_len = s.document().body().get(b).map_or(0, |x| x.content.len());
        select(
            &mut s,
            Pos::new(a.clone(), a_len.min(1)),
            Pos::new(b.clone(), b_len.min(1)),
            fonts,
        )?;
        let deleted = maybe(
            &mut s,
            EditOp::Delete {
                forward: false,
                unit: Default::default(),
            },
            fonts,
        )?;
        steps += usize::from(deleted);
    }
    let edited = texts(s.document());
    for _ in 0..steps {
        s.undo(fonts).ok_or("nothing to undo")?;
    }
    ensure(texts(s.document()) == original, || {
        "undo did not restore the text".into()
    })?;
    for _ in 0..steps {
        s.redo(fonts).ok_or("nothing to redo")?;
    }
    ensure(texts(s.document()) == edited, || {
        "redo did not repeat the edits".into()
    })?;
    let saved = s.document().save().map_err(|e| e.to_string())?;
    let reopened = Document::open(saved).map_err(|e| e.to_string())?;
    ensure(texts(&reopened) == edited, || {
        "the saved edits differ".into()
    })
}

fn check_tracking(doc: &Document, fonts: &FontDb) -> Check {
    let original = texts(doc);
    let mut s = Session::new(doc.clone());
    s.set_author("Corpus");
    apply(&mut s, vec![EditOp::SetTracking { on: true }], fonts)?;
    let tracked = texts(s.document());
    ensure(tracked == original, || {
        "turning tracking on changed the text".into()
    })?;
    let picks = targets(doc, 4);
    for (id, len) in &picks {
        let at = Pos::new(id.clone(), (*len).min(2));
        select(&mut s, at.clone(), at, fonts)?;
        apply(
            &mut s,
            vec![EditOp::InsertText { text: "QQ".into() }],
            fonts,
        )?;
        if *len > 4 {
            apply(
                &mut s,
                vec![EditOp::Delete {
                    forward: true,
                    unit: Default::default(),
                }],
                fonts,
            )?;
        }
    }
    let mut rejected = Session::new(s.document().clone());
    apply(
        &mut rejected,
        vec![EditOp::RejectChanges { all: true }],
        fonts,
    )?;
    // Rejecting returns the text this check started from. Revisions the
    // file already had are rejected too, so compare with that state.
    let mut baseline = Session::new(doc.clone());
    apply(
        &mut baseline,
        vec![EditOp::RejectChanges { all: true }],
        fonts,
    )?;
    ensure(
        texts(rejected.document()) == texts(baseline.document()),
        || "rejecting the tracked edits did not restore the text".into(),
    )?;
    apply(&mut s, vec![EditOp::AcceptChanges { all: true }], fonts)?;
    let saved = s.document().save().map_err(|e| e.to_string())?;
    Document::open(saved).map(|_| ()).map_err(|e| e.to_string())
}

fn check_header(doc: &Document, fonts: &FontDb) -> Check {
    let mut s = Session::new(doc.clone());
    let pages = s.pages(fonts);
    let Some(area) = pages
        .first()
        .and_then(|p| p.header.clone())
        .filter(|a| a.editable)
    else {
        return Ok(());
    };
    let width = pages[0].width;
    let r = s
        .apply(
            &[EditOp::EnterStory {
                page: 0,
                x: width / 2.0,
                y: (area.top + area.bottom) / 2.0,
            }],
            None,
            fonts,
        )
        .map_err(|e| e.to_string())?;
    if r.story.kind != docx_engine::edit::StoryKind::Header {
        return Ok(());
    }
    apply(
        &mut s,
        vec![EditOp::InsertText { text: "HDR".into() }],
        fonts,
    )?;
    apply(&mut s, vec![EditOp::ExitStory], fonts)?;
    let saved = s.document().save().map_err(|e| e.to_string())?;
    let reopened = Document::open(saved).map_err(|e| e.to_string())?;
    let xml_has = reopened.package().part_names().any(|name| {
        name.contains("header")
            && reopened
                .package()
                .read(name)
                .is_ok_and(|b| String::from_utf8_lossy(&b).contains("HDR"))
    });
    ensure(xml_has, || "the header edit was not saved".into())?;
    ensure(texts(&reopened) == texts(doc), || {
        "the header edit changed the body".into()
    })
}

fn check_clipboard(doc: &Document, fonts: &FontDb) -> Check {
    let mut s = Session::new(doc.clone());
    let ids = s.document().body().paragraphs();
    if ids.len() < 3 {
        return Ok(());
    }
    let a = ids[1].clone();
    let b = ids[2].clone();
    let b_len = s.document().body().get(&b).map_or(0, |x| x.content.len());
    select(&mut s, Pos::new(a, 0), Pos::new(b, b_len), fonts)?;
    let clip = s.copy_selection();
    let last = ids[ids.len() - 1].clone();
    let len = s
        .document()
        .body()
        .get(&last)
        .map_or(0, |x| x.content.len());
    select(
        &mut s,
        Pos::new(last.clone(), len),
        Pos::new(last, len),
        fonts,
    )?;
    let before = s.document().body().paragraphs().len();
    apply(
        &mut s,
        vec![EditOp::Paste {
            paragraphs: clip.paragraphs.clone(),
            same_document: true,
        }],
        fonts,
    )?;
    let after = s.document().body().paragraphs().len();
    ensure(after + 1 >= before + clip.paragraphs.len(), || {
        format!(
            "pasting {} paragraphs made {}",
            clip.paragraphs.len(),
            after - before
        )
    })?;
    let saved = s.document().save().map_err(|e| e.to_string())?;
    Document::open(saved).map(|_| ()).map_err(|e| e.to_string())
}

fn check(file: &PathBuf, width: u32, fonts: &FontDb) -> Result<String, String> {
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    let doc = Document::open(bytes).map_err(|e| format!("open: {e}"))?;
    let pages = check_render(&doc, width, fonts).map_err(|e| format!("render: {e}"))?;
    check_collab(&doc, pages, fonts).map_err(|e| format!("collab: {e}"))?;
    check_edits(&doc, fonts).map_err(|e| format!("edits: {e}"))?;
    check_tracking(&doc, fonts).map_err(|e| format!("tracking: {e}"))?;
    check_header(&doc, fonts).map_err(|e| format!("header: {e}"))?;
    check_clipboard(&doc, fonts).map_err(|e| format!("clipboard: {e}"))?;
    Ok(format!("{pages} pages"))
}

/// Runs the command.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let fonts = FontDb::global();
    let mut failed = 0;
    // Panics are reported per document, not printed by the hook.
    std::panic::set_hook(Box::new(|_| {}));
    for file in &args.files {
        let started = Instant::now();
        let outcome = catch_unwind(AssertUnwindSafe(|| check(file, args.width, fonts)))
            .unwrap_or_else(|panic| {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                    .unwrap_or_default();
                Err(format!("panic: {message}"))
            });
        let name = file
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
        let ms = started.elapsed().as_millis();
        match outcome {
            Ok(summary) => println!("ok    {name}: {summary} ({ms} ms)"),
            Err(error) => {
                failed += 1;
                println!("FAIL  {name}: {error} ({ms} ms)");
            }
        }
    }
    println!(
        "{} of {} documents passed",
        args.files.len() - failed,
        args.files.len()
    );
    Ok(failed == 0)
}
