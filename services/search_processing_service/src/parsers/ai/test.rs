use super::*;
use ai_engine::edit::{History, NewNode, Op, Position};
use ai_engine::geom::Point;

/// A saved letter-size document with one text object reading "Quarterly
/// report".
fn document() -> Vec<u8> {
    let blank = ai_engine::save::blank_file(612.0, 792.0).expect("a blank document saves");
    let mut doc = ai_engine::build::open(&blank)
        .expect("the blank document opens")
        .document;
    History::new()
        .apply(
            &mut doc,
            &[Op::Create {
                node: NewNode::Text {
                    at: Point { x: 72.0, y: 96.0 },
                    text: "Quarterly report".into(),
                    family: "Inter".into(),
                    style: "Regular".into(),
                    size: 24.0,
                    fill: None,
                    width: None,
                    align: Default::default(),
                },
                parent: None,
                position: Position::Top,
            }],
            None,
        )
        .expect("the text is added");
    ai_engine::save::save(&doc).expect("the document saves")
}

#[test]
fn indexes_the_text_of_text_objects() {
    let text = parse_ai_text(&document()).expect("the document reads");
    let lines: Vec<&str> = text.lines().collect();
    assert!(lines.contains(&"Quarterly report"), "{lines:?}");
}

#[test]
fn reads_are_stable() {
    let bytes = document();
    assert_eq!(
        parse_ai_text(&bytes).unwrap(),
        parse_ai_text(&bytes).unwrap()
    );
}

#[test]
fn rejects_postscript_era_and_other_files() {
    let legacy = b"%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(TM) 8.0\n%%EOF\n";
    let err = parse_ai_text(legacy).unwrap_err();
    assert!(format!("{err:#}").contains("Illustrator 8"), "{err:#}");
    assert!(parse_ai_text(b"not an Illustrator document").is_err());
}
