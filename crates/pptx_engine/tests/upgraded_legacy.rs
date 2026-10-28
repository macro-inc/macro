//! A legacy `.ppt` deck upgraded to `.pptx` by LibreOffice, as the convert
//! service does on upload (`fixtures/upgraded-from-ppt.pptx`, from
//! `services/convert_service/fixtures/legacy/deck.ppt`), opens, renders, edits
//! and saves in the engine.

use pptx_engine::font::FontDb;
use pptx_engine::{EditOp, Presentation};

fn fonts() -> FontDb {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("the fonts directory")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("ttf") || e.eq_ignore_ascii_case("otf"))
        })
        .collect();
    files.sort();
    let mut db = FontDb::new();
    for file in files {
        db.register(std::fs::read(file).expect("a font file"));
    }
    db
}

fn upgraded_deck() -> Presentation {
    let bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/upgraded-from-ppt.pptx"),
    )
    .expect("the upgraded fixture");
    Presentation::open(bytes).expect("the upgraded deck opens")
}

fn slide_xml(presentation: &Presentation, index: usize) -> String {
    let part = presentation.slides()[index].part.clone();
    String::from_utf8(presentation.read_bytes(&part).unwrap()).unwrap()
}

/// The `p:cNvPr` id of the shape whose text contains `needle`.
fn shape_id_with_text(xml: &str, needle: &str) -> u32 {
    let at = xml.find(needle).expect("text on the slide");
    let tag = xml[..at]
        .rfind("<p:cNvPr id=\"")
        .expect("a shape before the text");
    let rest = &xml[tag + "<p:cNvPr id=\"".len()..];
    rest[..rest.find('"').unwrap()].parse().unwrap()
}

#[test]
fn every_slide_renders() {
    let mut presentation = upgraded_deck();
    let fonts = fonts();

    assert_eq!(presentation.slides().len(), 4);
    for index in 0..presentation.slides().len() {
        let raster = presentation
            .render_slide(index, 320, &fonts)
            .unwrap_or_else(|e| panic!("slide {} failed to render: {e}", index + 1));
        assert_eq!(raster.width, 320);
    }
}

#[test]
fn slide_content_survives_the_upgrade() {
    let presentation = upgraded_deck();

    assert!(slide_xml(&presentation, 0).contains("Board Update"));
    let highlights = slide_xml(&presentation, 1);
    assert!(highlights.contains("Revenue up 12%"));
    assert!(highlights.contains("Three new customers"));
    assert!(slide_xml(&presentation, 2).contains("<a:tbl>"));
    let shapes = slide_xml(&presentation, 3);
    assert!(shapes.contains("Shape text"));
    assert!(shapes.contains("<p:pic>"), "picture lost");
}

#[test]
fn upgraded_deck_is_editable_and_saves() {
    let mut presentation = upgraded_deck();
    let fonts = fonts();
    let slide = presentation.slides()[0].id;
    let shape = shape_id_with_text(&slide_xml(&presentation, 0), "Board Update");

    presentation
        .apply(
            &[EditOp::SetText {
                slide,
                shape,
                cell: None,
                text: "Board Update (edited)".to_string(),
            }],
            &fonts,
        )
        .expect("the title is editable");
    let saved = presentation.save().expect("the edited deck saves");

    let mut reopened = Presentation::open(saved).expect("the saved deck reopens");
    assert!(slide_xml(&reopened, 0).contains("Board Update (edited)"));
    reopened
        .render_slide(0, 320, &fonts)
        .expect("the edited slide renders");
}

#[test]
fn unedited_save_keeps_the_upgrade() {
    let mut presentation = upgraded_deck();
    let before: Vec<String> = (0..4).map(|i| slide_xml(&presentation, i)).collect();

    let reopened = Presentation::open(presentation.save().unwrap()).unwrap();

    let after: Vec<String> = (0..4).map(|i| slide_xml(&reopened, i)).collect();
    assert_eq!(before, after);
}
