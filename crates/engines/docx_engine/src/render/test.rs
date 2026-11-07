use super::*;
use crate::layout::LayoutOptions;
use crate::test_support::{Parts, docx, fonts};

/// The height of the change bars drawn on the first page (0 for none).
fn bars(body: &str, markup: bool) -> f32 {
    let doc = Document::open(docx(body, &Parts::default())).expect("open");
    let options = LayoutOptions {
        markup,
        ..LayoutOptions::default()
    };
    let layout = doc.layout_with(fonts(), &options);
    let page = &layout.pages[0];
    let x = page.body.x - CHANGE_BAR_GAP - CHANGE_BAR_WIDTH / 2.0;
    let mut images = ImageCache::new();
    let mut r = Renderer {
        doc: &doc,
        fonts: fonts(),
        images: &mut images,
    };
    r.page_nodes(page)
        .iter()
        .filter_map(|n| match n {
            Node::Fill { path, .. } => path.bounds(),
            _ => None,
        })
        .filter(|b| (b.x - x).abs() < 0.01 && (b.w - CHANGE_BAR_WIDTH).abs() < 0.01)
        .map(|b| b.h)
        .sum()
}

const PLAIN: &str = r#"<w:p><w:r><w:t>Plain</w:t></w:r></w:p>"#;

#[test]
fn change_bars_mark_lines_with_tracked_changes() {
    assert_eq!(bars(PLAIN, true), 0.0);
    let inserted = format!(
        r#"{PLAIN}<w:p><w:ins w:id="1" w:author="A"><w:r><w:t>New</w:t></w:r></w:ins></w:p>"#
    );
    let one_line = bars(&inserted, true);
    assert!(one_line > 10.0 && one_line < 20.0, "{one_line}");
    // Formatting and paragraph property changes get a bar too.
    let formatted = r#"<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="2" w:author="A"><w:rPr/></w:rPrChange></w:rPr><w:t>Bold</w:t></w:r></w:p>"#;
    assert_eq!(bars(formatted, true), one_line);
    let para = r#"<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="3" w:author="A"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>Centered</w:t></w:r></w:p>"#;
    assert_eq!(bars(para, true), one_line);
    // Without markup the document shows as if the changes were accepted.
    assert_eq!(bars(&inserted, false), 0.0);
    assert_eq!(bars(formatted, false), 0.0);
}
