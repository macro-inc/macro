use super::*;
use psd_engine::edit::{History, NewLayer, Op, Position};
use psd_engine::model::{ParagraphRun, TextLayer, TextRun};
use psd_engine::render::Renderer;
use psd_engine::{Document, Selection};

/// Point text at the top left of the canvas, in the default style.
fn text_layer(text: &str) -> TextLayer {
    let length = text.encode_utf16().count() as u32;
    TextLayer {
        text: text.to_string(),
        runs: vec![TextRun {
            length,
            style: Default::default(),
        }],
        paragraphs: vec![ParagraphRun {
            length,
            align: Default::default(),
        }],
        transform: [1.0, 0.0, 0.0, 1.0, 4.0, 30.0],
        area: None,
        orientation: Default::default(),
        anti_alias: Default::default(),
        warped: false,
    }
}

/// A small saved document: the white Background, an empty pixel layer
/// named "Logo", and a text layer named "Headline" reading "Quarterly
/// report".
fn document() -> Vec<u8> {
    let blank = psd_engine::save::blank_file(64, 48, true).expect("a blank document saves");
    let mut doc = Document::open(&blank).expect("the blank document opens");
    let mut renderer = Renderer::new();
    History::default()
        .apply(
            &mut doc,
            &[
                Op::NewLayer {
                    parent: None,
                    position: Position::Top,
                    name: Some("Logo".into()),
                    kind: NewLayer::Pixel,
                },
                Op::NewLayer {
                    parent: None,
                    position: Position::Top,
                    name: Some("Headline".into()),
                    kind: NewLayer::Text {
                        text: text_layer("Quarterly report"),
                    },
                },
            ],
            &Selection::none(),
            &mut renderer,
            None,
        )
        .expect("the layers are added");
    psd_engine::save::save(&doc, &mut renderer).expect("the document saves")
}

#[test]
fn indexes_layer_names_and_the_text_of_text_layers() {
    let text = parse_psd_text(&document()).expect("the document decodes");
    let lines: Vec<&str> = text.lines().collect();
    assert!(lines.contains(&"Quarterly report"), "{lines:?}");
    assert!(lines.contains(&"Logo"), "{lines:?}");
    assert!(lines.contains(&"Background"), "{lines:?}");
    assert!(
        !lines.contains(&"Headline"),
        "a text layer is indexed by its text: {lines:?}"
    );
}

#[test]
fn reads_are_stable() {
    let bytes = document();
    assert_eq!(
        parse_psd_text(&bytes).unwrap(),
        parse_psd_text(&bytes).unwrap()
    );
}

#[test]
fn rejects_files_that_are_not_photoshop_documents() {
    assert!(parse_psd_text(b"not a Photoshop document").is_err());
    assert!(parse_psd_text(b"").is_err());
}
