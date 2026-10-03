use super::*;
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
