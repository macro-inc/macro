use super::*;
use crate::path::Rect;
use crate::render::scene::{Node, Paint};
use crate::test_support::{deck, fonts};

fn rect_shape(id: u32, x: i64, color: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="R{id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="1270000"/><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></p:spPr></p:sp>"#
    )
}

fn px(r: &Raster, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * r.width + x) * 4) as usize;
    [
        r.pixels[i],
        r.pixels[i + 1],
        r.pixels[i + 2],
        r.pixels[i + 3],
    ]
}

#[test]
fn layers_split_a_shape_from_its_backdrop() {
    let shapes = rect_shape(2, 1_270_000, "FF0000") + &rect_shape(3, 3_810_000, "0000FF");
    let mut pres = Presentation::open(deck(&[&shapes])).unwrap();
    // 960 px wide for 960 pt: one pixel per point; shape 2 spans 100..200 pt.
    let all = pres.render_slide(0, 960, fonts()).unwrap();
    assert_eq!(px(&all, 150, 150), [255, 0, 0, 255]);
    let only = pres.render_layer(0, Layer::Only(2), 960, fonts()).unwrap();
    assert_eq!(px(&only, 150, 150), [255, 0, 0, 255]);
    assert_eq!(px(&only, 350, 150)[3], 0, "other shapes are not drawn");
    assert_eq!(px(&only, 5, 5)[3], 0, "the background is not drawn");
    let without = pres
        .render_layer(0, Layer::Without(2), 960, fonts())
        .unwrap();
    assert_eq!(px(&without, 150, 150), [255, 255, 255, 255]);
    assert_eq!(px(&without, 350, 150), [0, 0, 255, 255]);
}

/// Child coordinates in "master units" (576 per inch): the group maps them
/// to EMU, a scale of 1587.5. Text and outline weights must not scale with it.
#[test]
fn group_unit_scaling_stretches_boxes_not_text_or_lines() {
    let group = r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="508000"/><a:chOff x="0" y="0"/><a:chExt cx="1600" cy="320"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="5" name="Label"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1600" cy="320"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="99CCFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>Select category</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>"#;
    let mut pres = Presentation::open(deck(&[group])).unwrap();
    let nodes = pres.slide_display_list(0, fonts()).unwrap();
    // The box is 200 × 40 pt at (100, 100).
    let frame = Rect::from_xywh(100.0, 100.0, 200.0, 40.0);
    let mut strokes = 0;
    let mut glyphs = 0;
    for node in &nodes {
        match node {
            Node::Stroke { stroke, .. } => {
                strokes += 1;
                assert!((stroke.width - 0.75).abs() < 1e-3, "{}", stroke.width);
            }
            Node::Fill {
                path,
                paint: Paint::Solid(c),
                ..
            } if c.r == 0.0 => {
                glyphs += 1;
                let b = path.bounds().unwrap();
                assert!(
                    b.x >= frame.x && b.right() <= frame.right() && b.h < 30.0,
                    "text escapes its box: {b:?}"
                );
            }
            _ => {}
        }
    }
    assert_eq!(strokes, 1);
    assert_eq!(glyphs, 1, "one line of text");
    let layout = pres.text_layout(0, 5, None, fonts()).unwrap().unwrap();
    assert!((layout.size[0] - 200.0).abs() < 0.5, "{:?}", layout.size);
    assert_eq!(layout.lines.len(), 1);
}

#[test]
fn extreme_slide_aspect_stays_within_the_pixel_budget() {
    let bytes = deck(&[&rect_shape(2, 0, "FF0000")]);
    let mut package = crate::opc::Package::open(bytes).unwrap();
    let main = "/ppt/presentation.xml";
    let xml = String::from_utf8(package.read(main).unwrap().into_owned()).unwrap();
    // One EMU wide and taller than the schema allows: clamped to 1 × 56 inches.
    let xml = xml.replace(
        r#"<p:sldSz cx="12192000" cy="6858000"/>"#,
        r#"<p:sldSz cx="1" cy="999999999"/>"#,
    );
    package.write(main, xml.into_bytes(), None);
    let mut pres = Presentation::open(package.save().unwrap()).unwrap();
    assert_eq!(pres.slide_size(), (914_400, 51_206_400));
    let raster = pres.render_slide(0, 4096, fonts()).unwrap();
    assert_eq!(raster.width, 4096);
    assert!(
        u64::from(raster.width) * u64::from(raster.height) <= 1 << 25,
        "{} × {}",
        raster.width,
        raster.height
    );
}
