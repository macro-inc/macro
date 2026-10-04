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

#[test]
fn group_children_are_scaled_into_the_group() {
    // A 200x100pt group at (100, 100) whose children span 2000x1000 units
    // from (1000, 1000): a child at (2000, 1500) sized 1000x500 covers
    // (200, 150) to (300, 200) on the page.
    let child = r#"<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="2000" y="1500"/><a:ext cx="1000" cy="500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></wps:spPr><wps:bodyPr/></wps:wsp>"#;
    let group = format!(
        r#"<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>1270000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>1270000</wp:posOffset></wp:positionV><wp:extent cx="2540000" cy="1270000"/><wp:wrapNone/><wp:docPr id="1" name="Group"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="1000" y="1000"/><a:chExt cx="2000" cy="1000"/></a:xfrm></wpg:grpSpPr>{child}</wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>"#
    );
    let page = render(&group);
    assert_eq!(pixel(&page, 250, 175), [255, 0, 0]);
    assert_eq!(pixel(&page, 197, 175), [255, 255, 255]);
    assert_eq!(pixel(&page, 250, 203), [255, 255, 255]);
    assert_eq!(pixel(&page, 150, 120), [255, 255, 255]);
}
