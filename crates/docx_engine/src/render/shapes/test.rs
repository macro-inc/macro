use super::*;
use crate::Document;
use crate::render::ImageCache;
use crate::test_support::{Parts, docx, fonts, shape_paragraph};

#[test]
fn vml_colors_read_hex_and_names() {
    assert_eq!(vml_color("#ff0000"), Rgba::from_hex("ff0000"));
    assert_eq!(vml_color("#0f0"), Rgba::from_hex("00ff00"));
    assert_eq!(vml_color("black [3213]"), Some(Rgba::BLACK));
    assert_eq!(vml_color("window"), Some(Rgba::WHITE));
    assert!(vml_on(None, true));
    assert!(!vml_on(Some("f"), true));
}

/// The RGB of pixel (x, y) of a page rendered one pixel per point.
fn pixel(r: &pptx_engine::render::scene::Raster, x: u32, y: u32) -> [u8; 3] {
    let i = ((y * r.width + x) * 4) as usize;
    [r.pixels[i], r.pixels[i + 1], r.pixels[i + 2]]
}

/// The first page of a Letter document with `content` in its body,
/// rendered one pixel per point.
fn render(content: &str) -> pptx_engine::render::scene::Raster {
    let body = format!(
        r#"{content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>"#
    );
    let doc = Document::open(docx(&body, &Parts::default())).unwrap();
    let layout = doc.layout(fonts());
    let mut images = ImageCache::new();
    doc.render_page(&layout, 0, 612, fonts(), &mut images)
        .expect("a page")
}

#[test]
fn shapes_draw_their_fill_and_outline() {
    let page = render(&shape_paragraph("page", 200, 300, None));
    // Red inside the 200x100pt box at (200, 300), black along its 2pt edge.
    assert_eq!(pixel(&page, 300, 350), [255, 0, 0]);
    let edge = pixel(&page, 200, 350);
    assert!(edge.iter().all(|&c| c < 64), "{edge:?}");
    assert_eq!(pixel(&page, 150, 350), [255, 255, 255]);
}

/// A paragraph with VML element `el` at (x, y) points on the page, 200x100pt
/// large, with `rest` as its attributes and content.
fn vml_paragraph(el: &str, x: u32, y: u32, rest: &str) -> String {
    format!(
        r#"<w:p><w:r><w:pict><v:{el} style="position:absolute;margin-left:{x}pt;margin-top:{y}pt;width:200pt;height:100pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" fillcolor="red" strokecolor="black" strokeweight="2pt" {rest}</v:{el}></w:pict></w:r></w:p>"#
    )
}

#[test]
fn vml_boxes_are_drawn_but_not_word_art() {
    let page = render(&format!(
        "{}{}",
        vml_paragraph("rect", 200, 100, ">"),
        vml_paragraph(
            "shape",
            200,
            400,
            r##"type="#_x0000_t136"><v:textpath string="Draft"/>"##
        ),
    ));
    assert_eq!(pixel(&page, 300, 150), [255, 0, 0]);
    let edge = pixel(&page, 200, 150);
    assert!(edge.iter().all(|&c| c < 64), "{edge:?}");
    // WordArt fills its letters, not its box.
    assert_eq!(pixel(&page, 300, 450), [255, 255, 255]);
}
