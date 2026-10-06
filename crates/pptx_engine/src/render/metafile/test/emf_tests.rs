//! EMF record semantics, checked on rendered pixels.

use super::builder::{dib1, dib24, dib32, le, lef, rgb};
use super::{Emf, load, near, px, render};

const RED: u32 = 0x0000FF;
const GREEN: u32 = 0x00FF00;
const BLUE: u32 = 0xFF0000;
const NULL_PEN: u32 = 0x8000_0008;
const BLACK_BRUSH: u32 = 0x8000_0004;
const SETMAPMODE: u32 = 17;
const SETWINDOWEXTEX: u32 = 9;
const SETWINDOWORGEX: u32 = 10;
const SETVIEWPORTEXTEX: u32 = 11;
const SETBKMODE: u32 = 18;
const SETPOLYFILLMODE: u32 = 19;
const SETTEXTALIGN: u32 = 22;
const SETTEXTCOLOR: u32 = 24;
const SETBKCOLOR: u32 = 25;
const SAVEDC: u32 = 33;
const RESTOREDC: u32 = 34;
const SETWORLDTRANSFORM: u32 = 35;
const MODIFYWORLDTRANSFORM: u32 = 36;
const MOVETOEX: u32 = 27;
const LINETO: u32 = 54;
const PIE: u32 = 47;
const SETARCDIRECTION: u32 = 57;
const BEGINPATH: u32 = 59;
const ENDPATH: u32 = 60;
const FILLPATH: u32 = 62;
const SELECTCLIPPATH: u32 = 67;
const EXCLUDECLIPRECT: u32 = 29;
const INTERSECTCLIPRECT: u32 = 30;
const EXTSELECTCLIPRGN: u32 = 75;
const POLYGON16: u32 = 86;

/// A red solid brush without an outline.
fn red_fill(e: &mut Emf) -> &mut Emf {
    e.brush(1, 0, RED, 0).select(1).select(NULL_PEN)
}

#[test]
fn header_gives_the_natural_size() {
    let m = load(&Emf::new(192, 96).finish());
    assert!(
        (m.width_pt - 144.0).abs() < 0.1 && (m.height_pt - 72.0).abs() < 0.1,
        "{} x {}",
        m.width_pt,
        m.height_pt
    );
}

#[test]
fn mm_text_rectangle_lands_in_picture_space() {
    let mut e = Emf::new(192, 192);
    red_fill(&mut e).rect(48, 48, 144, 144);
    let r = render(&load(&e.finish()), 1.0);
    assert!(near(px(&r, 72, 72), [255, 0, 0]));
    assert!(near(px(&r, 40, 72), [255, 0, 0]));
    assert_eq!(px(&r, 30, 72)[3], 0);
    assert_eq!(px(&r, 120, 120)[3], 0);
}

#[test]
fn anisotropic_window_maps_onto_viewport() {
    let mut e = Emf::new(192, 192);
    e.ints(SETMAPMODE, &[8])
        .ints(SETWINDOWEXTEX, &[1000, 2000])
        .ints(SETVIEWPORTEXTEX, &[192, 192]);
    red_fill(&mut e).rect(500, 0, 1000, 1000);
    let r = render(&load(&e.finish()), 1.0);
    // Logical (500..1000, 0..1000) → device (96..192, 0..96) → points (72..144, 0..72).
    assert!(near(px(&r, 100, 30), [255, 0, 0]));
    assert_eq!(px(&r, 100, 100)[3], 0);
    assert_eq!(px(&r, 40, 30)[3], 0);
}

#[test]
fn metric_mapping_mode_flips_y() {
    let mut e = Emf::new(192, 192);
    // MM_HIMETRIC: 0.01 mm per unit, y up; 2540 units = 1 inch = 96 px.
    e.ints(SETMAPMODE, &[3]).ints(SETWINDOWORGEX, &[0, 0]);
    e.ints(12, &[0, 192]);
    red_fill(&mut e).rect(0, 0, 2540, 2540);
    let r = render(&load(&e.finish()), 1.0);
    // Viewport origin at the bottom-left: the square covers device (0..96, 96..192).
    assert!(near(px(&r, 30, 110), [255, 0, 0]));
    assert_eq!(px(&r, 30, 30)[3], 0);
}

#[test]
fn isotropic_mode_keeps_units_square() {
    let mut e = Emf::new(192, 192);
    e.ints(SETMAPMODE, &[7])
        .ints(SETWINDOWEXTEX, &[100, 200])
        .ints(SETVIEWPORTEXTEX, &[192, 192]);
    red_fill(&mut e).rect(0, 0, 100, 200);
    let r = render(&load(&e.finish()), 1.0);
    // The x extent shrinks to 96 device pixels.
    assert!(near(px(&r, 30, 100), [255, 0, 0]));
    assert_eq!(px(&r, 100, 100)[3], 0);
}

#[test]
fn world_transforms_compose() {
    let mut e = Emf::new(192, 192);
    let mut body = lef(&[2.0, 0.0, 0.0, 2.0, 10.0, 10.0]);
    e.rec(SETWORLDTRANSFORM, &body);
    // Left-multiply: the translation applies before the existing scale.
    body = lef(&[1.0, 0.0, 0.0, 1.0, 10.0, 0.0]);
    body.extend(le(&[2]));
    e.rec(MODIFYWORLDTRANSFORM, &body);
    red_fill(&mut e).rect(0, 0, 20, 20);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    // Device x = 2 * (x + 10) + 10 → 30..70; y = 2y + 10 → 10..50.
    assert!(near(px(&r, 50, 30), [255, 0, 0]));
    assert_eq!(px(&r, 25, 30)[3], 0);
    assert_eq!(px(&r, 75, 30)[3], 0);
    // Identity reset.
    let mut e = Emf::new(192, 192);
    e.rec(SETWORLDTRANSFORM, &lef(&[2.0, 0.0, 0.0, 2.0, 10.0, 10.0]));
    let mut reset = lef(&[0.0; 6]);
    reset.extend(le(&[1]));
    e.rec(MODIFYWORLDTRANSFORM, &reset);
    red_fill(&mut e).rect(0, 0, 20, 20);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 10, 10), [255, 0, 0]));
    assert_eq!(px(&r, 30, 30)[3], 0);
}

fn star(e: &mut Emf) {
    e.poly16(
        POLYGON16,
        &[(96, 10), (150, 180), (10, 70), (182, 70), (42, 180)],
    );
}

#[test]
fn polygon_fill_modes() {
    let mut e = Emf::new(192, 192);
    red_fill(&mut e);
    star(&mut e);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert_eq!(px(&r, 96, 100)[3], 0, "ALTERNATE leaves the center open");
    assert!(near(px(&r, 96, 40), [255, 0, 0]));
    let mut e = Emf::new(192, 192);
    red_fill(&mut e).ints(SETPOLYFILLMODE, &[2]);
    star(&mut e);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(
        near(px(&r, 96, 100), [255, 0, 0]),
        "WINDING fills the center"
    );
}

#[test]
fn stock_objects_and_pens() {
    let mut e = Emf::new(192, 192);
    e.select(BLACK_BRUSH).select(NULL_PEN).rect(0, 0, 96, 96);
    // A thick blue geometric pen with a null brush.
    e.pen(2, 0, 10, BLUE)
        .select(2)
        .select(0x8000_0005)
        .rect(110, 110, 180, 180);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 48, 48), [0, 0, 0]));
    assert!(
        near(px(&r, 110, 145), [0, 0, 255]),
        "{:?}",
        px(&r, 110, 145)
    );
    assert_eq!(px(&r, 145, 145)[3], 0, "null brush leaves the inside empty");
}

#[test]
fn dashed_cosmetic_pen_and_opaque_gaps() {
    let line = |opaque: bool| {
        let mut e = Emf::new(192, 192);
        e.pen(1, 1, 0, BLUE)
            .select(1)
            .ints(SETBKMODE, &[if opaque { 2 } else { 1 }])
            .ints(SETBKCOLOR, &[RED as i32]);
        e.ints(MOVETOEX, &[0, 50]).ints(LINETO, &[192, 50]);
        render(&load(&e.finish()), 1.0 / 0.75)
    };
    let r = line(false);
    let row: Vec<[u8; 4]> = (0..192).map(|x| px(&r, x, 50)).collect();
    assert!(row.iter().any(|p| p[3] > 100 && p[2] > 150), "dashes drawn");
    assert!(row.iter().any(|p| p[3] < 20), "gaps left open");
    let r = line(true);
    let row: Vec<[u8; 4]> = (0..192).map(|x| px(&r, x, 50)).collect();
    assert!(
        row.iter().any(|p| p[3] > 100 && p[0] > 150 && p[2] < 100),
        "opaque gaps take the background color"
    );
}

#[test]
fn save_and_restore_dc() {
    let mut e = Emf::new(192, 192);
    e.brush(1, 0, RED, 0)
        .brush(2, 0, BLUE, 0)
        .select(1)
        .select(NULL_PEN);
    e.ints(SAVEDC, &[])
        .select(2)
        .ints(SETMAPMODE, &[8])
        .ints(SETWINDOWEXTEX, &[10, 10])
        .ints(SETVIEWPORTEXTEX, &[1000, 1000]);
    e.ints(RESTOREDC, &[-1]).rect(0, 0, 96, 96);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 48, 48), [255, 0, 0]));
    assert_eq!(px(&r, 120, 120)[3], 0, "mapping restored too");
}

#[test]
fn clip_rectangles() {
    let mut e = Emf::new(192, 192);
    red_fill(&mut e)
        .ints(INTERSECTCLIPRECT, &[0, 0, 96, 96])
        .ints(EXCLUDECLIPRECT, &[20, 20, 40, 40])
        .rect(0, 0, 192, 192);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 60, 60), [255, 0, 0]));
    assert_eq!(px(&r, 30, 30)[3], 0, "excluded hole");
    assert_eq!(px(&r, 150, 150)[3], 0, "outside the clip");
}

#[test]
fn region_clip_select_and_reset() {
    let rgn = |mode: i32, rects: &[[i32; 4]]| {
        let mut body = le(&[
            32 + 16 * rects.len() as i32,
            mode,
            32,
            1,
            rects.len() as i32,
            16 * rects.len() as i32,
            0,
            0,
            192,
            192,
        ]);
        for r in rects {
            body.extend(le(r));
        }
        body
    };
    let mut e = Emf::new(192, 192);
    red_fill(&mut e);
    e.rec(
        EXTSELECTCLIPRGN,
        &rgn(5, &[[0, 0, 50, 192], [150, 0, 192, 192]]),
    );
    e.rect(0, 0, 192, 100);
    // A copy without region data resets the clip.
    e.ints(EXTSELECTCLIPRGN, &[0, 5]).rect(0, 100, 192, 192);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 25, 50), [255, 0, 0]));
    assert!(near(px(&r, 170, 50), [255, 0, 0]));
    assert_eq!(px(&r, 100, 50)[3], 0);
    assert!(near(px(&r, 100, 150), [255, 0, 0]));
}

#[test]
fn clip_path_from_an_ellipse() {
    let mut e = Emf::new(192, 192);
    red_fill(&mut e)
        .ints(BEGINPATH, &[])
        .ellipse(0, 0, 192, 192)
        .ints(ENDPATH, &[])
        .ints(SELECTCLIPPATH, &[5]);
    e.rect(0, 0, 192, 192);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 96, 96), [255, 0, 0]));
    assert_eq!(px(&r, 5, 5)[3], 0);
}

#[test]
fn path_bracket_fill() {
    let mut e = Emf::new(192, 192);
    red_fill(&mut e)
        .ints(BEGINPATH, &[])
        .ints(MOVETOEX, &[10, 10])
        .ints(LINETO, &[180, 10])
        .ints(LINETO, &[10, 180]);
    e.ints(ENDPATH, &[]).ints(FILLPATH, &[0, 0, 0, 0]);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(
        near(px(&r, 40, 40), [255, 0, 0]),
        "open figure closed by FillPath"
    );
    assert_eq!(px(&r, 150, 150)[3], 0);
}

#[test]
fn pie_follows_arc_direction() {
    let pie = |clockwise: bool| {
        let mut e = Emf::new(192, 192);
        red_fill(&mut e).ints(SETARCDIRECTION, &[if clockwise { 2 } else { 1 }]);
        // From the right radial to the top radial.
        e.ints(PIE, &[0, 0, 192, 192, 192, 96, 96, 0]);
        render(&load(&e.finish()), 1.0 / 0.75)
    };
    let ccw = pie(false);
    assert!(near(px(&ccw, 140, 50), [255, 0, 0]), "upper-right quadrant");
    assert_eq!(px(&ccw, 50, 140)[3], 0);
    let cw = pie(true);
    assert_eq!(px(&cw, 140, 50)[3], 0);
    assert!(near(px(&cw, 50, 140), [255, 0, 0]));
}

#[test]
fn hatched_brush_leaves_gaps() {
    let mut e = Emf::new(192, 192);
    e.brush(1, 2, GREEN, 4)
        .select(1)
        .select(NULL_PEN)
        .ints(SETBKMODE, &[1])
        .rect(0, 0, 192, 192);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    let row: Vec<[u8; 4]> = (0..64).map(|x| px(&r, x, 3)).collect();
    assert!(row.iter().any(|p| p[3] > 100 && p[1] > 150), "hatch lines");
    assert!(row.iter().any(|p| p[3] < 30), "transparent background");
}

#[test]
fn stretch_dib_orientation() {
    let (r_, g_, b_, w_) = ([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]);
    let dib = dib24(&[&[r_, g_], &[b_, w_]]);
    let mut e = Emf::new(192, 192);
    e.stretch_dib([0, 0, 192, 192], [0, 0, 2, 2], &dib, 0x00CC_0020);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(
        near(px(&r, 40, 40), [255, 0, 0]),
        "top-left {:?}",
        px(&r, 40, 40)
    );
    assert!(near(px(&r, 150, 40), [0, 255, 0]));
    assert!(near(px(&r, 40, 150), [0, 0, 255]));
    assert!(near(px(&r, 150, 150), [255, 255, 255]));
}

#[test]
fn stretch_dib_source_rect_is_bottom_up() {
    let (r_, g_, b_, w_) = ([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]);
    let dib = dib24(&[&[r_, g_], &[b_, w_]]);
    let mut e = Emf::new(192, 192);
    // ySrc = 0 is the bottom row of a bottom-up DIB.
    e.stretch_dib([0, 0, 192, 192], [0, 0, 1, 1], &dib, 0x00CC_0020);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 96, 96), [0, 0, 255]), "{:?}", px(&r, 96, 96));
}

#[test]
fn alpha_blend_constant_and_per_pixel() {
    let solid = dib32(2, 2, [0, 0, 255, 255]);
    let mut e = Emf::new(192, 192);
    // SourceConstantAlpha 128 without per-pixel alpha.
    e.blt(
        114,
        [0, 0, 96, 192],
        0x0080_0000,
        [0, 0, 2, 2],
        Some(&solid),
    );
    // Per-pixel alpha 0: fully transparent.
    let clear = dib32(2, 2, [0, 0, 0, 0]);
    let mut half = dib32(2, 2, [0, 0, 128, 128]);
    half.1[3] = 128;
    e.blt(114, [96, 0, 96, 96], 0x01FF_0000, [0, 0, 2, 2], Some(&half));
    e.blt(
        114,
        [96, 96, 96, 96],
        0x01FF_0000,
        [0, 0, 2, 2],
        Some(&clear),
    );
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    let a = px(&r, 48, 96);
    assert!((100..160).contains(&a[3]) && a[2] > 200, "{a:?}");
    let b = px(&r, 150, 48);
    assert!((100..160).contains(&b[3]) && b[2] > 200, "{b:?}");
    let c = px(&r, 150, 150);
    assert!(c[3] < 10, "{c:?}");
}

#[test]
fn mask_and_invert_blits_are_transparent_outside_the_mask() {
    // Mask: black where the image is, white elsewhere; image: black outside.
    let mask = dib1(&[&[false, true], &[true, true]]);
    let image = dib24(&[&[[255, 0, 0], [0, 0, 0]], &[[0, 0, 0], [0, 0, 0]]]);
    let mut e = Emf::new(192, 192);
    e.ints(SETTEXTCOLOR, &[0]).ints(SETBKCOLOR, &[0xFFFFFF]);
    e.blt(77, [0, 0, 192, 192], 0x0088_00C6, [0, 0, 2, 2], Some(&mask));
    e.blt(
        77,
        [0, 0, 192, 192],
        0x0066_0046,
        [0, 0, 2, 2],
        Some(&image),
    );
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 48, 48), [255, 0, 0]), "{:?}", px(&r, 48, 48));
    assert!(px(&r, 150, 150)[3] < 10, "{:?}", px(&r, 150, 150));
}

#[test]
fn patcopy_and_blackness_fill_without_a_bitmap() {
    let mut e = Emf::new(192, 192);
    e.brush(1, 0, GREEN, 0).select(1);
    e.blt(76, [0, 0, 96, 96], 0x00F0_0021, [0, 0, 0, 0], None);
    e.blt(76, [96, 96, 96, 96], 0x0000_0042, [0, 0, 0, 0], None);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(near(px(&r, 48, 48), [0, 255, 0]));
    assert!(near(px(&r, 150, 150), [0, 0, 0]));
    assert_eq!(px(&r, 150, 48)[3], 0);
}

/// The bounding box of all drawn nodes (device pixels via picture points).
fn ink(m: &super::Metafile) -> crate::path::Rect {
    crate::render::raster::nodes_bounds(&m.nodes).expect("something drawn")
}

#[test]
fn text_alignment() {
    let draw = |align: i32| {
        let mut e = Emf::new(400, 200);
        e.font(1, -40, 0, 400, "Arial")
            .select(1)
            .ints(SETBKMODE, &[1])
            .ints(SETTEXTALIGN, &[align]);
        e.text(200, 100, "Hello", None, 0, [0; 4]);
        ink(&load(&e.finish()))
    };
    // Points are 0.75 device pixels.
    let left = draw(24);
    assert!((left.x - 150.0).abs() < 3.0, "{left:?}");
    assert!(
        left.bottom() <= 75.0 + 1.0 && left.y > 40.0,
        "baseline at y = 75 pt: {left:?}"
    );
    let right = draw(24 | 2);
    assert!((right.right() - 150.0).abs() < 3.0, "{right:?}");
    let center = draw(24 | 6);
    assert!(
        ((center.x + center.right()) / 2.0 - 150.0).abs() < 3.0,
        "{center:?}"
    );
    let top = draw(0);
    assert!(
        top.y >= 75.0 && top.y < 85.0,
        "top-aligned text hangs below the reference: {top:?}"
    );
}

#[test]
fn text_escapement_rotates() {
    let mut e = Emf::new(400, 400);
    e.font(1, -40, 900, 400, "Arial")
        .select(1)
        .ints(SETBKMODE, &[1])
        .ints(SETTEXTALIGN, &[24]);
    e.text(200, 300, "Hello", None, 0, [0; 4]);
    let b = ink(&load(&e.finish()));
    assert!(b.h > b.w * 2.0, "vertical text: {b:?}");
    assert!(
        b.bottom() <= 225.0 + 2.0,
        "runs upwards from the reference point: {b:?}"
    );
}

#[test]
fn text_advances_follow_dx() {
    let mut e = Emf::new(400, 200);
    e.font(1, -40, 0, 400, "Arial")
        .select(1)
        .ints(SETBKMODE, &[1])
        .ints(SETTEXTALIGN, &[24]);
    e.text(10, 100, "II", Some(&[300, 30]), 0, [0; 4]);
    let b = ink(&load(&e.finish()));
    // The second I starts 300 device pixels (225 pt) after the first.
    assert!(b.w > 220.0 && b.w < 240.0, "{b:?}");
}

#[test]
fn opaque_text_background_and_clipping() {
    let mut e = Emf::new(400, 200);
    e.font(1, -40, 0, 400, "Arial")
        .select(1)
        .ints(SETBKMODE, &[1])
        .ints(SETBKCOLOR, &[GREEN as i32]);
    e.ints(SETTEXTALIGN, &[24])
        .text(10, 100, "Clipped text", None, 6, [0, 0, 100, 200]);
    let r = render(&load(&e.finish()), 1.0 / 0.75);
    assert!(
        near(px(&r, 50, 20), [0, 255, 0]),
        "ETO_OPAQUE fills the rectangle"
    );
    let ink_right = (100..400)
        .filter(|&x| (60..110).any(|y| px(&r, x, y)[3] > 0))
        .count();
    assert_eq!(ink_right, 0, "text clipped to the rectangle");
    let ink_left = (0..100)
        .filter(|&x| (60..110).any(|y| px(&r, x, y)[1] < 100 && px(&r, x, y)[3] > 200))
        .count();
    assert!(ink_left > 10, "text drawn inside the rectangle");
}

#[test]
fn bold_underlined_font_draws_more_ink() {
    let draw = |weight: i32, underline: bool| {
        let mut e = Emf::new(400, 200);
        let mut body = le(&[1, -40, 0, 0, 0, weight]);
        body.extend_from_slice(&[0, u8::from(underline), 0, 0, 0, 0, 0, 0]);
        let mut name: Vec<u16> = "Arial".encode_utf16().collect();
        name.resize(32, 0);
        body.extend(name.iter().flat_map(|c| c.to_le_bytes()));
        e.rec(82, &body)
            .select(1)
            .ints(SETBKMODE, &[1])
            .ints(SETTEXTALIGN, &[24]);
        e.text(10, 100, "Hello", None, 0, [0; 4]);
        let r = render(&load(&e.finish()), 1.0 / 0.75);
        r.pixels.chunks_exact(4).filter(|p| p[3] > 128).count()
    };
    let plain = draw(400, false);
    assert!(draw(700, false) > plain, "bold is heavier");
    assert!(draw(400, true) > plain, "underline adds ink");
    let _ = rgb(0, 0, 0);
}
