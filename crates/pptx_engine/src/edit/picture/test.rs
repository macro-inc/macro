use super::*;
use crate::edit::{EditOp, EditResult, Editor};
use crate::inspect::ShapeOutline;
use crate::path::Point;
use crate::render::scene::{Node, Paint, Raster};
use crate::test_support::{deck_with_media, fonts, text_box};
use serde_json::json;

const SLIDE: u32 = 256;
/// A 200 × 100 pt box at (100, 100) pt.
const XFRM: &str =
    r#"<a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="1270000"/></a:xfrm>"#;

/// A 200 × 100 image: red, green (top), blue, yellow (bottom) quadrants.
fn quadrants() -> Vec<u8> {
    let (w, h) = (200u32, 100u32);
    let mut r = Raster::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let c = match (x < w / 2, y < h / 2) {
                (true, true) => [255, 0, 0],
                (false, true) => [0, 255, 0],
                (true, false) => [0, 0, 255],
                (false, false) => [255, 255, 0],
            };
            let i = ((y * w + x) * 4) as usize;
            r.pixels[i..i + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
    r.to_png()
}

/// A picture of `media/image1.png` (`rId10`) with blip children and a crop.
fn pic(id: u32, xfrm: &str, blip: &str, crop: &str) -> String {
    format!(
        r#"<p:pic><p:nvPicPr><p:cNvPr id="{id}" name="Picture {id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId10">{blip}</a:blip>{crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#
    )
}

fn open(shapes: &str) -> Presentation {
    let png = quadrants();
    Presentation::open(deck_with_media(
        &[shapes],
        &[("image1.png", &png), ("original.png", &png)],
    ))
    .unwrap()
}

fn op(fields: serde_json::Value) -> EditOp {
    let mut op = json!({"slide": SLIDE});
    for (k, v) in fields.as_object().unwrap() {
        op[k] = v.clone();
    }
    serde_json::from_value(op).unwrap()
}

fn apply(pres: &mut Presentation, op: EditOp) -> EditResult {
    pres.apply(&[op], fonts()).unwrap()
}

fn error(pres: &mut Presentation, op: EditOp) -> String {
    pres.apply(&[op], fonts()).unwrap_err().to_string()
}

fn outline(pres: &mut Presentation, id: u32) -> ShapeOutline {
    let slide = pres.slide_outline(0).unwrap();
    find_outline(&slide.shapes, id).unwrap()
}

fn find_outline(shapes: &[ShapeOutline], id: u32) -> Option<ShapeOutline> {
    shapes.iter().find_map(|s| {
        if s.id == id {
            Some(s.clone())
        } else {
            find_outline(&s.children, id)
        }
    })
}

fn slide_xml(pres: &mut Presentation) -> String {
    pres.flush();
    let part = pres.slides()[0].part.clone();
    String::from_utf8(pres.package().read(&part).unwrap().into_owned()).unwrap()
}

/// The markup of the first `p:blipFill`.
fn blip_fill(pres: &mut Presentation) -> String {
    let xml = slide_xml(pres);
    let start = xml.find("<p:blipFill").unwrap();
    let end = xml.find("</p:blipFill>").unwrap() + "</p:blipFill>".len();
    xml[start..end].to_owned()
}

fn assert_reopens(pres: &mut Presentation) -> Presentation {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

fn frame(s: &ShapeOutline) -> [f32; 4] {
    [s.x, s.y, s.w, s.h].map(|v| (v * 100.0).round() / 100.0)
}

/// Pixel `(x, y)` of the slide rendered at one pixel per point.
fn pixel(pres: &mut Presentation, x: u32, y: u32) -> [u8; 4] {
    let r = pres.render_slide(0, 960, fonts()).unwrap();
    let i = ((y * r.width + x) * 4) as usize;
    [
        r.pixels[i],
        r.pixels[i + 1],
        r.pixels[i + 2],
        r.pixels[i + 3],
    ]
}

const RED: [u8; 4] = [255, 0, 0, 255];
const GREEN: [u8; 4] = [0, 255, 0, 255];
const WHITE: [u8; 4] = [255, 255, 255, 255];

#[test]
fn cropping_moves_the_frame_and_keeps_the_image_in_place() {
    let mut pres = open(&pic(2, XFRM, "", ""));
    let picture = outline(&mut pres, 2).picture.unwrap();
    assert_eq!(picture.crop, CropOutline::default());
    assert_eq!(
        (picture.natural_width, picture.natural_height),
        (Some(200), Some(100))
    );
    apply(
        &mut pres,
        op(
            json!({"op": "cropPicture", "shape": 2, "left": 0.25, "right": 0.25,
                  "top": null, "bottom": null, "mode": null}),
        ),
    );
    let s = outline(&mut pres, 2);
    assert_eq!(frame(&s), [150.0, 100.0, 100.0, 100.0]);
    let crop = s.picture.unwrap().crop;
    assert_eq!((crop.left, crop.right, crop.top), (0.25, 0.25, 0.0));
    assert!(blip_fill(&mut pres).contains(r#"<a:srcRect l="25000" r="25000"/><a:stretch>"#));
    // The visible part is drawn where it was: red, then green, and nothing outside.
    assert_eq!(pixel(&mut pres, 160, 120), RED);
    assert_eq!(pixel(&mut pres, 240, 120), GREEN);
    assert_eq!(pixel(&mut pres, 110, 120), WHITE);
    assert_eq!(pixel(&mut pres, 290, 120), WHITE);
    // Uncropping one edge grows the frame back on that side only.
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "left": 0})),
    );
    assert_eq!(frame(&outline(&mut pres, 2)), [100.0, 100.0, 150.0, 100.0]);
    // Negative crops pad with empty space.
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "bottom": -0.5})),
    );
    let s = outline(&mut pres, 2);
    assert_eq!(frame(&s), [100.0, 100.0, 150.0, 150.0]);
    assert_eq!(s.picture.unwrap().crop.bottom, -0.5);
    assert_eq!(pixel(&mut pres, 120, 220), WHITE);
    let mut reopened = assert_reopens(&mut pres);
    assert_eq!(
        outline(&mut reopened, 2).picture,
        outline(&mut pres, 2).picture
    );
}

#[test]
fn the_image_paint_maps_the_visible_part_onto_the_frame() {
    let mut pres = open(&pic(2, XFRM, "", ""));
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "left": 0.25, "top": 0.1})),
    );
    let nodes = pres.slide_display_list(0, fonts()).unwrap();
    let (path, transform) = nodes
        .iter()
        .find_map(|n| match n {
            Node::Fill {
                path,
                paint: Paint::Image { transform, .. },
                ..
            } => Some((path.clone(), *transform)),
            _ => None,
        })
        .expect("an image fill");
    // Clipped to the new frame: (150, 110), 150 × 90 pt.
    let b = path.bounds().unwrap();
    assert!(
        (b.x - 150.0).abs() < 0.01 && (b.y - 110.0).abs() < 0.01,
        "{b:?}"
    );
    assert!(
        (b.w - 150.0).abs() < 0.01 && (b.h - 90.0).abs() < 0.01,
        "{b:?}"
    );
    // Image pixel (50, 10) (51, 11 with the 1 px border) lands on the frame's corner.
    let corner = transform.apply(Point::new(51.0, 11.0));
    assert!(
        (corner.x - 150.0).abs() < 0.01 && (corner.y - 110.0).abs() < 0.01,
        "{corner:?}"
    );
    let far = transform.apply(Point::new(201.0, 101.0));
    assert!(
        (far.x - 300.0).abs() < 0.01 && (far.y - 200.0).abs() < 0.01,
        "{far:?}"
    );
}

#[test]
fn rotated_and_flipped_pictures_crop_in_place() {
    for attrs in [
        r#" rot="5400000""#,
        r#" flipH="1""#,
        r#" rot="1800000" flipV="1""#,
    ] {
        let xfrm = XFRM.replace("<a:xfrm>", &format!("<a:xfrm{attrs}>"));
        let mut pres = open(&pic(2, &xfrm, "", ""));
        let corners = |pres: &mut Presentation| {
            // Where the whole image's corners are on the slide, as an editor
            // computes them from the outline.
            let s = outline(pres, 2);
            let c = s.picture.unwrap().crop;
            let full_w = s.w / (1.0 - c.left - c.right);
            let full_h = s.h / (1.0 - c.top - c.bottom);
            let (cx, cy) = (s.x + s.w / 2.0, s.y + s.h / 2.0);
            let (sin, cos) = s.rotation.to_radians().sin_cos();
            let fx = if s.flip_h { -1.0 } else { 1.0 };
            let fy = if s.flip_v { -1.0 } else { 1.0 };
            [(0.0, 0.0), (1.0, 1.0)].map(|(u, v)| {
                let lx = (-c.left + u) * full_w - s.w / 2.0;
                let ly = (-c.top + v) * full_h - s.h / 2.0;
                let (lx, ly) = (lx * fx, ly * fy);
                let x = cx + lx * cos - ly * sin;
                let y = cy + lx * sin + ly * cos;
                ((x * 100.0).round() / 100.0, (y * 100.0).round() / 100.0)
            })
        };
        let before = corners(&mut pres);
        apply(
            &mut pres,
            op(json!({"op": "cropPicture", "shape": 2, "left": 0.3, "bottom": 0.2, "right": 0.1})),
        );
        assert_eq!(corners(&mut pres), before, "{attrs}");
        let s = outline(&mut pres, 2);
        assert!((s.w - 120.0).abs() < 0.01 && (s.h - 80.0).abs() < 0.01);
    }
}

#[test]
fn fill_and_fit_crop_to_the_frame_aspect() {
    // A 100 × 100 pt frame for a 2:1 image.
    let square =
        r#"<a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="1270000" cy="1270000"/></a:xfrm>"#;
    let mut pres = open(&pic(2, square, "", ""));
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "mode": "fill"})),
    );
    let s = outline(&mut pres, 2);
    assert_eq!(frame(&s), [100.0, 100.0, 100.0, 100.0], "the frame stays");
    let c = s.picture.unwrap().crop;
    assert_eq!((c.left, c.top, c.right, c.bottom), (0.25, 0.0, 0.25, 0.0));
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "mode": "fit"})),
    );
    let s = outline(&mut pres, 2);
    assert_eq!(frame(&s), [100.0, 100.0, 100.0, 100.0]);
    let c = s.picture.unwrap().crop;
    assert_eq!((c.left, c.top, c.right, c.bottom), (0.0, -0.5, 0.0, -0.5));
    // Letterboxed: empty above, the image in the middle band.
    assert_eq!(pixel(&mut pres, 150, 110), WHITE);
    assert_eq!(pixel(&mut pres, 140, 140), RED);
    assert!(
        error(
            &mut pres,
            op(json!({"op": "cropPicture", "shape": 2, "mode": "fill", "left": 0.1}))
        )
        .contains("not both")
    );
}

#[test]
fn group_members_crop_in_slide_space_and_the_group_refits() {
    let group = format!(
        r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group 5"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="5080000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></p:grpSpPr>{}{}</p:grpSp>"#,
        pic(
            2,
            r#"<a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>"#,
            "",
            ""
        ),
        text_box(
            3,
            1_270_000,
            635_000,
            1_270_000,
            635_000,
            "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>"
        )
    );
    let mut pres = open(&group);
    // The group doubles its members: the picture shows at (100, 100), 200 × 100 pt.
    assert_eq!(frame(&outline(&mut pres, 2)), [100.0, 100.0, 200.0, 100.0]);
    apply(
        &mut pres,
        op(json!({"op": "cropPicture", "shape": 2, "left": 0.5})),
    );
    assert_eq!(frame(&outline(&mut pres, 2)), [200.0, 100.0, 100.0, 100.0]);
    // The group shrank to its members; the text box did not move.
    let g = outline(&mut pres, 5);
    assert_eq!(frame(&g), [200.0, 100.0, 300.0, 200.0]);
    assert_eq!(frame(&outline(&mut pres, 3)), [300.0, 200.0, 200.0, 100.0]);
    assert_reopens(&mut pres);
}

#[test]
fn pictures_take_preset_geometry_and_render_clipped_to_it() {
    let mut pres = open(&pic(2, XFRM, "", ""));
    apply(
        &mut pres,
        op(json!({"op": "setGeometry", "shape": 2, "preset": "ellipse"})),
    );
    assert_eq!(outline(&mut pres, 2).geometry.as_deref(), Some("ellipse"));
    assert_eq!(pixel(&mut pres, 103, 103), WHITE, "outside the ellipse");
    assert_eq!(pixel(&mut pres, 150, 140), RED, "inside it");
    assert!(blip_fill(&mut pres).contains("<a:blip r:embed=\"rId10\"/>"));
}

#[test]
fn adjustments_write_blip_effects_in_order_and_read_back() {
    // A "set transparent color" effect the engine keeps ahead of its own.
    let keep = r#"<a:clrChange><a:clrFrom><a:srgbClr val="FFFFFF"/></a:clrFrom><a:clrTo><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>"#;
    let ext = r#"<a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst>"#;
    let mut pres = open(&pic(2, XFRM, &format!("{keep}{ext}"), ""));
    apply(
        &mut pres,
        op(
            json!({"op": "formatPicture", "shapes": [2], "brightness": 0.2, "contrast": -0.4,
                  "recolor": "grayscale", "transparency": 0.25, "reset": null}),
        ),
    );
    let xml = blip_fill(&mut pres);
    let order = [
        "<a:clrChange>",
        r#"<a:lum bright="20000" contrast="-40000"/>"#,
        "<a:grayscl/>",
        r#"<a:alphaModFix amt="75000"/>"#,
        "<a:extLst>",
    ];
    let positions: Vec<usize> = order
        .iter()
        .map(|s| xml.find(s).unwrap_or_else(|| panic!("{s} missing: {xml}")))
        .collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "{xml}");
    let p = outline(&mut pres, 2).picture.unwrap();
    assert_eq!((p.brightness, p.contrast), (0.2, -0.4));
    assert_eq!((p.recolor.as_str(), p.transparency), ("grayscale", 0.25));
    // Omitted fields stay; zero removes.
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "contrast": 0, "transparency": 0})),
    );
    let p = outline(&mut pres, 2).picture.unwrap();
    assert_eq!((p.brightness, p.contrast, p.transparency), (0.2, 0.0, 0.0));
    assert_eq!(p.recolor, "grayscale");
    let xml = blip_fill(&mut pres);
    assert!(
        xml.contains(r#"<a:lum bright="20000"/><a:grayscl/><a:extLst>"#),
        "{xml}"
    );
    let mut reopened = assert_reopens(&mut pres);
    assert_eq!(
        outline(&mut reopened, 2).picture,
        outline(&mut pres, 2).picture
    );
}

#[test]
fn every_recolor_round_trips() {
    let mut pres = open(&pic(2, XFRM, "", ""));
    let cases: &[(&str, &str, &str)] = &[
        ("grayscale", "grayscale", "<a:grayscl/>"),
        (
            "sepia",
            "sepia",
            r#"<a:duotone><a:prstClr val="black"/><a:srgbClr val="D9C3A5"><a:tint val="50000"/><a:satMod val="180000"/></a:srgbClr></a:duotone>"#,
        ),
        (
            "washout",
            "washout",
            r#"<a:lum bright="70000" contrast="-70000"/>"#,
        ),
        ("blackWhite", "blackWhite", r#"<a:biLevel thresh="50000"/>"#),
        (
            "blackWhite25",
            "blackWhite25",
            r#"<a:biLevel thresh="25000"/>"#,
        ),
        (
            "blackWhite75",
            "blackWhite75",
            r#"<a:biLevel thresh="75000"/>"#,
        ),
        (
            "duotone:accent2",
            "duotone:accent2",
            r#"<a:duotone><a:schemeClr val="accent2"><a:shade val="45000"/><a:satMod val="135000"/></a:schemeClr><a:prstClr val="white"/></a:duotone>"#,
        ),
        (
            "duotoneLight:1F4E79",
            "duotoneLight:1F4E79",
            r#"<a:duotone><a:prstClr val="black"/><a:srgbClr val="1F4E79"><a:tint val="45000"/><a:satMod val="400000"/></a:srgbClr></a:duotone>"#,
        ),
        (
            "duotone:accent1,FFC000",
            "duotone:accent1,FFC000",
            r#"<a:duotone><a:schemeClr val="accent1"/><a:srgbClr val="FFC000"/></a:duotone>"#,
        ),
        ("none", "none", r#"<a:blip r:embed="rId10"/>"#),
    ];
    for (spec, read, markup) in cases {
        apply(
            &mut pres,
            op(json!({"op": "formatPicture", "shapes": [2], "recolor": spec})),
        );
        let xml = blip_fill(&mut pres);
        assert!(xml.contains(markup), "{spec}: {xml}");
        assert_eq!(outline(&mut pres, 2).picture.unwrap().recolor, *read);
    }
    // Washout keeps its own a:lum next to brightness and contrast.
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "recolor": "washout", "brightness": -0.1})),
    );
    let p = outline(&mut pres, 2).picture.unwrap();
    assert_eq!((p.recolor.as_str(), p.brightness), ("washout", -0.1));
    assert!(
        blip_fill(&mut pres)
            .contains(r#"<a:lum bright="-10000"/><a:lum bright="70000" contrast="-70000"/>"#)
    );
}

#[test]
fn adjustments_render() {
    let mut pres = open(&pic(2, XFRM, "", ""));
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "recolor": "grayscale"})),
    );
    let gray = pixel(&mut pres, 120, 120);
    assert!(
        gray[0] == gray[1] && gray[1] == gray[2] && gray[0] < 120,
        "{gray:?}"
    );
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "recolor": "none", "transparency": 0.5})),
    );
    let faint = pixel(&mut pres, 120, 120);
    assert!(
        (faint[1] as i32 - 128).abs() <= 2 && faint[0] == 255,
        "half red over white: {faint:?}"
    );
    apply(
        &mut pres,
        op(
            json!({"op": "formatPicture", "shapes": [2], "transparency": 0, "recolor": "blackWhite"}),
        ),
    );
    // Green is above the threshold, blue below.
    assert_eq!(pixel(&mut pres, 250, 120), WHITE);
    assert_eq!(pixel(&mut pres, 120, 180), [0, 0, 0, 255]);
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "recolor": "none", "brightness": 0.5})),
    );
    let bright = pixel(&mut pres, 120, 180);
    assert!(
        bright[0] > 100 && bright[2] == 255,
        "brighter blue: {bright:?}"
    );
}

#[test]
fn reset_removes_the_crop_and_every_adjustment() {
    let mut pres = open(&pic(
        2,
        XFRM,
        r#"<a:grayscl/><a:alphaModFix amt="50000"/>"#,
        r#"<a:srcRect l="50000"/>"#,
    ));
    let mut ed = Editor::new(pres.clone());
    ed.apply(
        &[op(
            json!({"op": "formatPicture", "shapes": [2], "reset": true}),
        )],
        None,
        fonts(),
    )
    .unwrap();
    let s = outline(ed.presentation_mut(), 2);
    // The frame grows back to the whole image at its scale (400 pt wide).
    assert_eq!(frame(&s), [-100.0, 100.0, 400.0, 100.0]);
    let p = s.picture.unwrap();
    assert_eq!(
        (p.crop, p.recolor.as_str(), p.transparency),
        (CropOutline::default(), "none", 0.0)
    );
    assert!(blip_fill(ed.presentation_mut()).contains(r#"<a:blip r:embed="rId10"/><a:stretch>"#));
    // Reset first, then the other fields.
    ed.apply(
        &[op(
            json!({"op": "formatPicture", "shapes": [2], "reset": true, "recolor": "sepia"}),
        )],
        None,
        fonts(),
    )
    .unwrap();
    assert_eq!(
        outline(ed.presentation_mut(), 2).picture.unwrap().recolor,
        "sepia"
    );
    ed.undo().unwrap();
    ed.undo().unwrap();
    assert_eq!(
        outline(ed.presentation_mut(), 2).picture,
        outline(&mut pres, 2).picture
    );
    assert_eq!(ed.presentation_mut().save().unwrap(), pres.save().unwrap());
}

/// PowerPoint 2010+ corrections: `r:embed` is the corrected image, the
/// original (here `media/original.png`, `rId11`) sits in an image layer.
fn corrected(effects: &str) -> String {
    let ext = format!(
        r#"<a:extLst><a:ext uri="{{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}}"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a14:imgLayer r:embed="rId11"><a14:imgEffect>{effects}</a14:imgEffect></a14:imgLayer></a14:imgProps></a:ext></a:extLst>"#
    );
    pic(2, XFRM, &ext, "")
}

#[test]
fn powerpoint_2010_corrections_are_read_and_flattened() {
    let mut pres = open(&corrected(
        r#"<a14:brightnessContrast bright="20000" contrast="-20000"/>"#,
    ));
    let p = outline(&mut pres, 2).picture.unwrap();
    assert_eq!((p.brightness, p.contrast), (0.2, -0.2));
    // Changing brightness drops the layer: the corrected image is the picture.
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "brightness": 0.1})),
    );
    let p = outline(&mut pres, 2).picture.unwrap();
    assert_eq!((p.brightness, p.contrast), (0.1, 0.0));
    let xml = blip_fill(&mut pres);
    assert!(
        !xml.contains("imgProps") && xml.contains(r#"r:embed="rId10""#),
        "{xml}"
    );
    let reopened = assert_reopens(&mut pres);
    assert!(
        !reopened.package().has_part("/ppt/media/original.png"),
        "the original image went with its layer"
    );
    // Transparency alone keeps the layer.
    let mut pres = open(&corrected(r#"<a14:saturation sat="0"/>"#));
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "transparency": 0.3})),
    );
    assert!(blip_fill(&mut pres).contains("imgProps"));
    // Reset restores a decodable original.
    apply(
        &mut pres,
        op(json!({"op": "formatPicture", "shapes": [2], "reset": true})),
    );
    let xml = blip_fill(&mut pres);
    assert!(xml.contains(r#"<a:blip r:embed="rId11"/>"#), "{xml}");
}

#[test]
fn only_pictures_are_cropped_or_adjusted() {
    let body = "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Text</a:t></a:r></a:p>";
    let mut pres = open(&(pic(2, XFRM, "", "") + &text_box(3, 0, 0, 914_400, 457_200, body)));
    for o in [
        op(json!({"op": "cropPicture", "shape": 3, "left": 0.1})),
        op(json!({"op": "cropPicture", "shape": 3, "mode": "fit"})),
        op(json!({"op": "formatPicture", "shapes": [2, 3], "recolor": "grayscale"})),
    ] {
        let e = error(&mut pres, o);
        assert!(e.contains("shape 3 is not a picture"), "{e}");
    }
    // The batch is atomic: picture 2 was not recolored either.
    assert_eq!(outline(&mut pres, 2).picture.unwrap().recolor, "none");
    for (o, reason) in [
        (
            op(json!({"op": "cropPicture", "shape": 2, "left": 0.6, "right": 0.5})),
            "nothing of the picture",
        ),
        (
            op(json!({"op": "formatPicture", "shapes": [2], "brightness": 2})),
            "out of range",
        ),
        (
            op(json!({"op": "formatPicture", "shapes": [2], "recolor": "vintage"})),
            "unknown recolor",
        ),
        (
            op(json!({"op": "formatPicture", "shapes": [2], "recolor": "duotone:teal"})),
            "invalid color",
        ),
        (
            op(json!({"op": "formatPicture", "shapes": [], "recolor": "none"})),
            "at least one",
        ),
    ] {
        let e = error(&mut pres, o);
        assert!(e.contains(reason), "{e}");
    }
    assert!(outline(&mut pres, 3).picture.is_none());
}

#[test]
fn natural_size_reads_headers_without_inflating_whole_images() {
    let pres = open(&pic(2, XFRM, "", ""));
    assert_eq!(
        natural_size(&pres, "/ppt/media/image1.png"),
        Some((200, 100))
    );
    // BMP headers too (2 × 3, bottom-up).
    let mut bmp = b"BM".to_vec();
    bmp.extend_from_slice(&[0; 12]);
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&2i32.to_le_bytes());
    bmp.extend_from_slice(&(-3i32).to_le_bytes());
    assert_eq!(pixel_size(&bmp), Some((2, 3)));
    assert_eq!(pixel_size(b"not an image"), None);
}

/// Builds a deck that uses every picture tool and effect, saves it, and has
/// LibreOffice convert it to PDF. Needs `soffice` (LibreOffice with Impress).
#[test]
#[ignore = "needs LibreOffice (soffice)"]
fn libreoffice_opens_a_deck_with_every_picture_tool_and_effect() {
    let shapes = [
        pic(2, XFRM, "", ""),
        pic(
            3,
            &XFRM.replace("1270000\" y=\"1270000", "5080000\" y=\"1270000"),
            "",
            "",
        ),
        crate::test_support::text_box(
            4,
            1_270_000,
            3_810_000,
            5_080_000,
            1_270_000,
            "<a:p><a:r><a:rPr lang=\"en-US\" sz=\"4000\"/><a:t>WordArt</a:t></a:r></a:p>",
        ),
    ]
    .concat();
    let mut pres = open(&shapes);
    let ops = vec![
        op(json!({"op": "cropPicture", "shape": 2, "left": 0.1, "top": 0.05, "right": 0.2})),
        op(json!({"op": "setGeometry", "shape": 2, "preset": "roundRect"})),
        op(
            json!({"op": "formatPicture", "shapes": [2], "brightness": 0.2, "contrast": 0.1,
                  "recolor": "sepia", "transparency": 0.2}),
        ),
        op(json!({"op": "cropPicture", "shape": 3, "mode": "fit"})),
        op(json!({"op": "formatPicture", "shapes": [3], "recolor": "duotone:accent1"})),
        op(
            json!({"op": "setShapeEffects", "shapes": [2], "shadow": "perspectiveBelow",
                  "glow": {"color": "accent2", "sizePt": 8}, "reflection": "half4pt"}),
        ),
        op(
            json!({"op": "setShapeEffects", "shapes": [3], "shadow": "innerTopLeft",
                  "softEdge": {"sizePt": 5}}),
        ),
        op(json!({"op": "formatText", "shape": 4,
                  "props": {"shadow": "outerBottomRight", "glow": {"color": "FFC000", "sizePt": 5}}})),
    ];
    pres.apply(&ops, fonts()).unwrap();
    let bytes = assert_reopens(&mut pres).save().unwrap();
    let dir = std::env::temp_dir().join(format!("pptx-engine-lo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let deck = dir.join("every-feature.pptx");
    std::fs::write(&deck, bytes).unwrap();
    let profile = format!(
        "-env:UserInstallation=file://{}",
        dir.join("profile").display()
    );
    let status = std::process::Command::new("soffice")
        .args([
            profile.as_str(),
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
        ])
        .arg(&dir)
        .arg(&deck)
        .status()
        .expect("soffice runs");
    assert!(status.success());
    let pdf = std::fs::read(dir.join("every-feature.pdf")).expect("a PDF");
    assert!(pdf.starts_with(b"%PDF") && pdf.len() > 1000);
    let _ = std::fs::remove_dir_all(&dir);
}
