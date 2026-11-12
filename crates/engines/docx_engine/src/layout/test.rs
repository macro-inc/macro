//! Laying a document out again from the cache after edits gives the same
//! pages as laying it out afresh.

use crate::document::Document;
use crate::edit::{BreakKind, EditOp, Pos, Session, Unit};
use crate::model::block::{BlockId, BlockKind};
use crate::test_support::{Parts, docx, fonts, layout_diff};
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read(path).expect("fixture")
}

/// Where the session's layout (laid out again from its cache) differs
/// from laying its document out afresh.
fn stale(s: &mut Session) -> Option<String> {
    let cached = s.layout(fonts());
    let fresh = s.document().layout(fonts());
    layout_diff(&cached, &fresh)
}

fn check(s: &mut Session, what: &str, failures: &mut Vec<String>) {
    if let Some(d) = stale(s) {
        failures.push(format!("after {what}: {d}"));
    }
}

fn caret(s: &mut Session, block: &BlockId, offset: usize) {
    let at = Pos::new(block.clone(), offset);
    s.apply(
        &[EditOp::Select {
            anchor: at.clone(),
            focus: at,
        }],
        None,
        fonts(),
    )
    .expect("select");
}

fn type_text(s: &mut Session, text: &str) {
    s.apply(
        &[EditOp::InsertText {
            text: text.to_owned(),
        }],
        Some("typing"),
        fonts(),
    )
    .expect("type");
}

/// Runs an edit that may not apply to every document (a row outside a
/// table): only the layout afterwards matters.
fn run(s: &mut Session, op: EditOp) {
    let _ = s.apply(&[op], None, fonts());
}

fn backspace(s: &mut Session) {
    run(
        s,
        EditOp::Delete {
            forward: false,
            unit: Unit::Char,
        },
    );
}

/// Body paragraphs to edit.
struct Targets {
    first: BlockId,
    in_table: Option<BlockId>,
    in_list: Option<BlockId>,
    middle: BlockId,
    last: BlockId,
}

fn targets(doc: &Document) -> Option<Targets> {
    let body = doc.body();
    let paras = body.paragraphs();
    let in_table = paras
        .iter()
        .find(|id| {
            body.ancestors(id)
                .iter()
                .any(|a| body.get(a).is_some_and(|b| b.kind == BlockKind::Cell))
        })
        .cloned();
    let in_list = paras
        .iter()
        .find(|id| body.get(id).is_some_and(|b| b.props.contains("numPr")))
        .cloned();
    Some(Targets {
        first: paras.first()?.clone(),
        in_table,
        in_list,
        middle: paras.get(paras.len() / 2)?.clone(),
        last: paras.last()?.clone(),
    })
}

fn len_of(s: &Session, id: &BlockId) -> usize {
    s.document().body().get(id).map_or(0, |b| b.content.len())
}

/// Types into, splits and joins paragraphs, breaks pages, adds a note and
/// a table row, then undoes it all and redoes a step, comparing the
/// session's layout with a fresh one after each.
fn exercise(s: &mut Session) -> Vec<String> {
    let mut failures = Vec::new();
    check(s, "opening", &mut failures);
    let Some(t) = targets(s.document()) else {
        return failures;
    };
    let typed = [
        Some(&t.first),
        t.in_table.as_ref(),
        t.in_list.as_ref(),
        Some(&t.middle),
        Some(&t.last),
    ];
    for (k, id) in typed.into_iter().flatten().enumerate() {
        caret(s, id, 1.min(len_of(s, id)));
        type_text(s, "x");
        check(s, &format!("typing in paragraph {k}"), &mut failures);
    }
    // A new list item renumbers the items after it.
    let item = t.in_list.as_ref().unwrap_or(&t.middle);
    caret(s, item, 0);
    run(s, EditOp::InsertParagraph);
    check(s, "starting a paragraph", &mut failures);
    backspace(s);
    check(s, "joining it again", &mut failures);
    caret(s, &t.middle, len_of(s, &t.middle));
    run(
        s,
        EditOp::InsertBreak {
            kind: BreakKind::Page,
        },
    );
    check(s, "breaking the page", &mut failures);
    backspace(s);
    check(s, "removing the break", &mut failures);
    if let Some(cell) = &t.in_table {
        caret(s, cell, 0);
        run(s, EditOp::InsertRow { below: true });
        check(s, "adding a table row", &mut failures);
    }
    // A note before the others renumbers them.
    caret(s, &t.first, 1.min(len_of(s, &t.first)));
    run(s, EditOp::InsertNote { endnote: false });
    type_text(s, "A new note.");
    run(s, EditOp::ExitStory);
    check(s, "adding a footnote", &mut failures);
    caret(s, &t.middle, 0);
    type_text(
        s,
        "Several more words that make the paragraph longer, so that it takes \
         another line and what follows it moves down the page. ",
    );
    check(s, "lengthening a paragraph", &mut failures);
    while s.can_undo() {
        s.undo(fonts());
        check(s, "undo", &mut failures);
    }
    s.redo(fonts());
    check(s, "redo", &mut failures);
    failures
}

#[test]
fn relaying_out_after_edits_matches_a_fresh_layout() {
    for name in ["complex-msa.docx", "mutual-nda.docx", "simple_test.docx"] {
        let doc = Document::open(fixture(name)).expect("open");
        let failures = exercise(&mut Session::new(doc));
        assert!(failures.is_empty(), "{name}: {}", failures.join("\n"));
    }
}

const NUMBERING: &str = r#"<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#;

const FOOTNOTES: &str = r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The first note.</w:t></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The second note, which is long enough to take more than one line at the foot of the page.</w:t></w:r></w:p></w:footnote>"#;

const HEADER: &str = r#"<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>"#;

const SECTION: &str = r#"<w:headerReference w:type="default" r:id="rIdH1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>"#;

/// Several pages of paragraphs, list items, a heading kept with the next
/// paragraph, a table with a nested table and list items in its cells,
/// footnotes, a header with page fields and two sections.
fn long_document() -> Vec<u8> {
    let text = "The parties agree that the terms of this agreement apply to every \
                order placed under it, unless an order says otherwise in writing.";
    let para = |s: &str| format!(r#"<w:p><w:r><w:t xml:space="preserve">{s}</w:t></w:r></w:p>"#);
    let item = |s: &str| {
        format!(
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">{s}</w:t></w:r></w:p>"#
        )
    };
    let noted = |s: &str, id: u32| {
        format!(
            r#"<w:p><w:r><w:t xml:space="preserve">{s}</w:t></w:r><w:r><w:footnoteReference w:id="{id}"/></w:r></w:p>"#
        )
    };
    let cell = |inner: &str| {
        format!(r#"<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>{inner}</w:tc>"#)
    };
    let nested = format!(
        r#"<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>{}{}</w:tr></w:tbl>{}"#,
        cell(&para("Inner one")),
        cell(&para("Inner two")),
        para("")
    );
    let table = format!(
        r#"<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>{}{}</w:tr><w:tr>{}{}</w:tr><w:tr>{}{}</w:tr></w:tbl>"#,
        cell(&item("A numbered cell")),
        cell(&para(text)),
        cell(&nested),
        cell(&item("Another numbered cell")),
        cell(&para("Short")),
        cell(&para(text)),
    );
    let mut body = String::new();
    for i in 0..30 {
        body.push_str(&para(&format!("{i}. {text}")));
    }
    body.push_str(&noted("A paragraph with a note.", 1));
    for i in 0..6 {
        body.push_str(&item(&format!("Item {i}: {text}")));
    }
    body.push_str(r#"<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:t>A heading kept with the table</w:t></w:r></w:p>"#);
    body.push_str(&table);
    for i in 0..24 {
        body.push_str(&para(&format!("{i}. {text} {text}")));
    }
    body.push_str(&format!(
        r#"<w:p><w:pPr><w:sectPr>{SECTION}<w:type w:val="nextPage"/></w:sectPr></w:pPr></w:p>"#
    ));
    body.push_str(&noted("The second section, with another note.", 2));
    for i in 0..16 {
        body.push_str(&item(&format!("Later item {i}: {text}")));
        body.push_str(&para(&format!("{text} {text} {text}")));
    }
    body.push_str(&format!("<w:sectPr>{SECTION}</w:sectPr>"));
    docx(
        &body,
        &Parts {
            numbering: Some(NUMBERING),
            header: Some(HEADER),
            footnotes: Some(FOOTNOTES),
            ..Parts::default()
        },
    )
}

#[test]
fn relaying_out_a_long_document_after_edits_matches_a_fresh_layout() {
    let doc = Document::open(long_document()).expect("open");
    let mut s = Session::new(doc);
    let pages = s.pages(fonts()).len();
    assert!(pages >= 5, "{pages} pages");
    let failures = exercise(&mut s);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// The documents named by `DOCX_ENGINE_DOCS`: `.docx` files, or
/// directories of them, separated by the platform's path separator.
fn docs_from_env() -> Vec<PathBuf> {
    let Some(list) = std::env::var_os("DOCX_ENGINE_DOCS") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for path in std::env::split_paths(&list) {
        if path.is_dir() {
            let mut files: Vec<PathBuf> = std::fs::read_dir(&path)
                .map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).collect())
                .unwrap_or_default();
            files.retain(|f| f.extension().is_some_and(|e| e == "docx"));
            files.sort();
            out.extend(files);
        } else {
            out.push(path);
        }
    }
    out
}

fn open_path(path: &Path) -> Option<Session> {
    let doc = Document::open(std::fs::read(path).ok()?).ok()?;
    Some(Session::new(doc))
}

#[test]
#[ignore = "edits the documents named by DOCX_ENGINE_DOCS; run with --ignored --nocapture"]
fn zz_relaying_out_documents_matches_a_fresh_layout() {
    let mut failed = Vec::new();
    for path in docs_from_env() {
        let Some(mut s) = open_path(&path) else {
            eprintln!("{}: does not open", path.display());
            continue;
        };
        let failures = exercise(&mut s);
        eprintln!("{}: {} differences", path.display(), failures.len());
        if let Some(first) = failures.first() {
            failed.push(format!("{}: {first}", path.display()));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n\n"));
}

#[test]
#[ignore = "times typing in the documents named by DOCX_ENGINE_DOCS; run with --ignored --nocapture"]
fn zz_typing_time() {
    /// Keystrokes timed per document.
    const KEYSTROKES: u32 = 30;
    for path in docs_from_env() {
        let Some(mut s) = open_path(&path) else {
            continue;
        };
        let pages = s.pages(fonts()).len();
        let paras = s.document().body().paragraphs();
        let Some(target) = paras.get(40).or(paras.last()).cloned() else {
            continue;
        };
        caret(&mut s, &target, 1);
        let started = std::time::Instant::now();
        for _ in 0..KEYSTROKES {
            type_text(&mut s, "x");
        }
        let each = started.elapsed() / KEYSTROKES;
        let name = path.file_stem().unwrap_or_default().to_string_lossy();
        eprintln!("{name}: {pages} pages, {each:?} per keystroke");
    }
}
