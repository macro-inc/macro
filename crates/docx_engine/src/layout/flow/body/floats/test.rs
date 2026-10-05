use crate::Document;
use crate::layout::inline::Kind;
use crate::layout::{Item, Layout, PlacedLine, StoryRef};
use crate::test_support::{Parts, docx, fonts};
use pptx_engine::path::Rect;

const ARIAL_10: &str = r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>"#;

/// A letter page with one-inch margins, in two columns half an inch apart
/// (216pt wide, at x 72 and 324).
const TWO_COLUMNS: &str = r#"<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:cols w:num="2" w:space="720"/></w:sectPr>"#;

/// Points in an EMU.
const EMU: i64 = 12_700;

fn layout(body: &str) -> Layout {
    let parts = Parts {
        styles: Some(ARIAL_10),
        ..Parts::default()
    };
    Document::open(docx(body, &parts)).unwrap().layout(fonts())
}

fn text(p: &PlacedLine) -> String {
    let l = p.line();
    p.para.inline.clusters[l.start..l.end]
        .iter()
        .filter(|c| matches!(c.kind, Kind::Text | Kind::Space))
        .map(|c| c.ch)
        .collect()
}

fn body_lines(l: &Layout) -> Vec<&PlacedLine> {
    l.pages[0].lines_of(&StoryRef::Body).collect()
}

fn find<'a>(l: &'a Layout, t: &str) -> &'a PlacedLine {
    body_lines(l)
        .into_iter()
        .find(|p| text(p) == t)
        .unwrap_or_else(|| panic!("no line {t:?}"))
}

fn drawings(l: &Layout) -> Vec<Rect> {
    l.pages[0]
        .all_items()
        .filter_map(|i| match i {
            Item::Drawing(d) => Some(d.rect),
            _ => None,
        })
        .collect()
}

fn para(t: &str) -> String {
    format!("<w:p><w:r><w:t>{t}</w:t></w:r></w:p>")
}

/// A one-inch picture anchored to its paragraph with `wrap`, `offset`
/// points below the paragraph's top.
fn anchored_picture(wrap: &str, offset: i64) -> String {
    format!(
        r#"<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>{}</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>{wrap}<wp:docPr id="1" name="p"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rIdX"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>"#,
        offset * EMU
    )
}

#[test]
fn top_and_bottom_floats_push_text_below_them() {
    let body = format!(
        "<w:p>{}<w:r><w:t>Beside</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapTopAndBottom/>", 0)
    );
    let l = layout(&body);
    let ls = body_lines(&l);
    // The picture spans 72..144: its paragraph's text goes below it.
    assert!((ls[0].y - 144.0).abs() < 0.01, "{}", ls[0].y);
    // Text that ignores it stays put.
    let body = format!(
        "<w:p>{}<w:r><w:t>Over</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapNone/>", 0)
    );
    let l = layout(&body);
    assert!((body_lines(&l)[0].y - 72.0).abs() < 0.01);
}

#[test]
fn text_continues_below_a_band_further_down() {
    // A picture an inch below its paragraph: the paragraph's line stays on
    // top, the next paragraph jumps the band instead of the page.
    let body = format!(
        "<w:p>{}<w:r><w:t>Above</w:t></w:r></w:p><w:p><w:r><w:t>Below</w:t></w:r></w:p>",
        anchored_picture("<wp:wrapTopAndBottom/>", 12)
    );
    let l = layout(&body);
    assert_eq!(l.pages.len(), 1);
    let ls = body_lines(&l);
    assert!((ls[0].y - 72.0).abs() < 0.01, "{}", ls[0].y);
    assert!((ls[1].y - (72.0 + 12.0 + 72.0)).abs() < 0.01, "{}", ls[1].y);
}

#[test]
fn drawings_that_move_their_paragraph_to_the_next_column_go_with_it() {
    // The picture's paragraph comes less than an inch above the bottom of
    // the first column: picture and paragraph go to the top of the second,
    // and the text after them goes below the picture there. A picture
    // raised above its paragraph does the same.
    for raise in [0, 10] {
        let filler: String = (0..52).map(|k| para(&format!("Line {k}"))).collect();
        let body = format!(
            "{filler}<w:p>{}<w:r><w:t>Anchor</w:t></w:r></w:p>{}{TWO_COLUMNS}",
            anchored_picture("<wp:wrapTopAndBottom/>", -raise),
            para("After")
        );
        let l = layout(&body);
        let last = find(&l, "Line 51");
        assert!(last.y + last.line().height + 72.0 > 720.0, "{}", last.y);
        let picture = drawings(&l)[0];
        let top = 72.0 - raise as f32;
        assert!((picture.x - 324.0).abs() < 0.01, "{}", picture.x);
        assert!((picture.y - top).abs() < 0.01, "{}", picture.y);
        let (anchor, after) = (find(&l, "Anchor"), find(&l, "After"));
        assert!((anchor.x - 324.0).abs() < 0.01, "{}", anchor.x);
        assert!((anchor.y - (top + 72.0)).abs() < 0.01, "{}", anchor.y);
        assert!((after.x - 324.0).abs() < 0.01, "{}", after.x);
        let below = anchor.y + anchor.line().height;
        assert!((after.y - below).abs() < 0.01, "{}", after.y);
    }
}

#[test]
fn bands_keep_text_out_of_the_columns_they_cross_only() {
    // A picture across the first column: the second column's text runs
    // past the picture's height undisturbed.
    let right: String = (1..10).map(|k| para(&format!("Right {k}"))).collect();
    let body = format!(
        r#"{}<w:p>{}</w:p>{}<w:p><w:r><w:br w:type="column"/><w:t>Right 0</w:t></w:r></w:p>{right}{TWO_COLUMNS}"#,
        para("Intro"),
        anchored_picture("<wp:wrapTopAndBottom/>", 0),
        para("Below"),
    );
    let l = layout(&body);
    let h = find(&l, "Intro").line().height;
    let picture = drawings(&l)[0];
    assert!((picture.x - 72.0).abs() < 0.01, "{}", picture.x);
    assert!(find(&l, "Below").y >= picture.y + picture.h - 0.01);
    for k in 0..10 {
        let line = find(&l, &format!("Right {k}"));
        assert!((line.x - 324.0).abs() < 0.01, "{}", line.x);
        let y = 72.0 + k as f32 * h;
        assert!((line.y - y).abs() < 0.01, "Right {k}: {} != {y}", line.y);
    }
}
