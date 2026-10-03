use super::*;
use crate::edit::{EditOp, NewShape};
use crate::test_support::{deck, fonts, text_box};

fn title(text: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#
    )
}

#[test]
fn outline_lists_shapes_text_tables_and_notes() {
    let body = r#"<a:p><a:r><a:rPr lang="en-US"/><a:t>First</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr lang="en-US"/><a:t>line</a:t></a:r></a:p>"#;
    let shapes = title("Quarterly results") + &text_box(2, 914_400, 457_200, 2_540_000, 1_270_000, body);
    let mut pres = Presentation::open(deck(&[&shapes])).unwrap();
    let cells = vec![vec!["Revenue".to_owned(), "1.2".to_owned()]];
    pres.apply(
        &[
            EditOp::AddShape { slide: 256, shape: NewShape::Table { cells }, x: 10.0, y: 10.0, w: 200.0, h: 20.0 },
            EditOp::SetNotes { slide: 256, text: "Say hello".into() },
        ],
        fonts(),
    )
    .unwrap();
    let outline = pres.outline().unwrap();
    assert_eq!((outline.width, outline.height), (960.0, 540.0));
    assert_eq!(outline.layouts.len(), 1);
    assert!(outline.theme_colors.contains(&("accent1".to_owned(), "#4472C4".to_owned())));
    let slide = &outline.slides[0];
    assert_eq!(slide.title.as_deref(), Some("Quarterly results"));
    assert_eq!(slide.layout, "Title and Content");
    assert_eq!(slide.notes.as_deref(), Some("Say hello"));
    let tb = slide.shapes.iter().find(|s| s.id == 2).unwrap();
    assert_eq!(tb.kind, ShapeKindName::Text);
    assert_eq!((tb.x, tb.y, tb.w, tb.h), (72.0, 36.0, 200.0, 100.0));
    assert_eq!(tb.paragraphs.len(), 2);
    assert_eq!(tb.paragraphs[1], ParagraphOutline { text: "Second\u{b}line".into(), level: 1 });
    let title = slide.shapes.iter().find(|s| s.id == 5).unwrap();
    assert_eq!(title.placeholder.as_deref(), Some("title"));
    // The title inherits its box from the master.
    assert!((title.x - 66.0).abs() < 0.01 && title.w > 800.0, "{title:?}");
    let table = slide.shapes.iter().find(|s| s.kind == ShapeKindName::Table).unwrap();
    let t = table.table.as_ref().unwrap();
    assert_eq!(t.rows, vec![vec!["Revenue".to_owned(), "1.2".to_owned()]]);
    assert!(!table.text_editable);
    let json = serde_json::to_value(&outline).unwrap();
    assert_eq!(json["slides"][0]["shapes"][0]["kind"], "text");
}

#[test]
fn text_layout_reports_caret_stops_in_slide_space() {
    let body = r#"<a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>Hello</a:t></a:r></a:p><a:p><a:endParaRPr lang="en-US" sz="2000"/></a:p>"#;
    let mut pres = Presentation::open(deck(&[&text_box(2, 914_400, 457_200, 2_540_000, 1_270_000, body)])).unwrap();
    let lay = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    assert_eq!(lay.paragraphs, vec!["Hello".to_owned(), String::new()]);
    assert_eq!(lay.lines.len(), 2);
    let first = &lay.lines[0];
    assert_eq!(first.stops.len(), 6, "a stop before each character and after the last");
    assert!(first.stops.windows(2).all(|w| w[1].x > w[0].x));
    // Layout space is the text rectangle; positions include the 7.2pt left inset.
    let [a, _, _, d, e, f] = lay.transform;
    assert_eq!((a, d, e, f), (1.0, 1.0, 72.0, 36.0));
    assert!((first.stops[0].x - 7.2).abs() < 0.01, "{:?}", first.stops[0]);
    assert!(first.top >= 3.6 - 0.01, "{first:?}");
    // The empty paragraph still has a caret position.
    assert_eq!(lay.lines[1].stops.len(), 1);
    assert!(matches!(pres.text_layout(0, 99, None, fonts()), Err(Error::NotFound(_))));
}
