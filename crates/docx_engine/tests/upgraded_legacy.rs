//! A legacy `.doc` upgraded to `.docx` by LibreOffice, as the convert service
//! does on upload (`fixtures/upgraded-from-doc.docx`, from
//! `services/convert_service/fixtures/legacy/memo.doc`), opens, lays out,
//! renders, edits and saves in the engine.

use docx_engine::Document;
use docx_engine::edit::{EditOp, Pos, Session};
use docx_engine::model::block::{BlockId, BlockKind};
use docx_engine::render::{ImageCache, Renderer};
use pptx_engine::font::FontDb;

fn fonts() -> FontDb {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../pptx_engine/fonts");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("the PPTX engine's fonts")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "ttf"))
        .collect();
    files.sort();
    let mut db = FontDb::new();
    for file in files {
        db.register(std::fs::read(file).expect("a font file"));
    }
    db
}

fn upgraded_bytes() -> Vec<u8> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/upgraded-from-doc.docx"),
    )
    .expect("the upgraded fixture")
}

/// Top-level paragraph texts of the body, in order.
fn paragraphs(document: &Document) -> Vec<(BlockId, String)> {
    let body = document.body();
    body.children(None)
        .iter()
        .filter_map(|id| body.get(id))
        .filter(|block| block.kind == BlockKind::Paragraph)
        .map(|block| (block.id.clone(), block.content.text()))
        .collect()
}

#[test]
fn upgraded_document_lays_out_and_renders() {
    let document = Document::open(upgraded_bytes()).expect("the upgraded document opens");
    let fonts = fonts();

    let layout = document.layout(&fonts);

    // The memo has a page break before its appendix.
    assert!(layout.pages.len() >= 2, "{} pages", layout.pages.len());
    let mut images = ImageCache::new();
    let mut renderer = Renderer {
        doc: &document,
        fonts: &fonts,
        images: &mut images,
    };
    for page in &layout.pages {
        let raster = renderer.render_page(page, 0.5);
        assert!(raster.width > 0);
    }
}

#[test]
fn paragraph_text_survives_the_upgrade() {
    let document = Document::open(upgraded_bytes()).unwrap();
    let texts: Vec<String> = paragraphs(&document).into_iter().map(|(_, t)| t).collect();
    let all = texts.join("\n");

    for expected in [
        "Quarterly Memo",
        "Revenue grew twelve percent quarter over quarter, with margins holding steady.",
        "Launched the new editor",
        "Closed three enterprise deals",
        "Appendix",
        "Café façade naïve – unicode survives the round trip.",
    ] {
        assert!(all.contains(expected), "missing {expected:?} in {texts:?}");
    }
    let xml = document.document_xml();
    assert!(xml.contains("<w:tbl>"), "table lost");
}

#[test]
fn upgraded_document_is_editable_and_saves() {
    let fonts = fonts();
    let document = Document::open(upgraded_bytes()).unwrap();
    let (title, _) = paragraphs(&document)
        .into_iter()
        .find(|(_, text)| text == "Quarterly Memo")
        .expect("the title paragraph");
    let mut editor = Session::new(document);

    let caret = Pos::new(title, 0);
    editor
        .apply(
            &[
                EditOp::Select {
                    anchor: caret.clone(),
                    focus: caret,
                },
                EditOp::InsertText {
                    text: "Upgraded ".to_string(),
                },
            ],
            None,
            &fonts,
        )
        .expect("the title is editable");
    let saved = editor.save().expect("the edited document saves");

    let reopened = Document::open(saved).expect("the saved document reopens");
    assert!(
        paragraphs(&reopened)
            .iter()
            .any(|(_, text)| text == "Upgraded Quarterly Memo")
    );
}

#[test]
fn unedited_save_keeps_every_paragraph() {
    let document = Document::open(upgraded_bytes()).unwrap();
    let before: Vec<String> = paragraphs(&document).into_iter().map(|(_, t)| t).collect();

    let reopened = Document::open(document.save().unwrap()).unwrap();

    let after: Vec<String> = paragraphs(&reopened).into_iter().map(|(_, t)| t).collect();
    assert_eq!(before, after);
}
