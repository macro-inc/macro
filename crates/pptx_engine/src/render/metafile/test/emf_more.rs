//! More EMF records: text variants, pens, brushes, palettes, regions, blits.

use super::builder::{dib1, dib24, le, le16, lef};
use super::{Emf, load, near, px, render};
use crate::test_support::fonts;

const NULL_PEN: u32 = 0x8000_0008;
const SETBKMODE: u32 = 18;
const SETTEXTALIGN: u32 = 22;
const SCALE: f32 = 1.0 / 0.75;

/// Bounding box of everything drawn, in device pixels of the reference device.
fn ink(e: &Emf) -> crate::path::Rect {
    let r = crate::render::raster::nodes_bounds(&load(&e.finish()).nodes).expect("ink");
    crate::path::Rect::from_xywh(r.x / 0.75, r.y / 0.75, r.w / 0.75, r.h / 0.75)
}

fn text_setup(e: &mut Emf, face: &str) {
    e.font(1, -40, 0, 400, face)
        .select(1)
        .ints(SETBKMODE, &[1])
        .ints(SETTEXTALIGN, &[24]);
}

/// `EMR_EXTTEXTOUTW` with `ETO_GLYPH_INDEX` and advances.
fn glyph_text(e: &mut Emf, ids: &[u16], dx: &[i32]) {
    let n = ids.len() as i32;
    let string_len = (ids.len() * 2).div_ceil(4) * 4;
    let mut body = le(&[0, 0, -1, -1, 1]);
    body.extend(lef(&[0.0, 0.0]));
    body.extend(le(&[
        20,
        100,
        n,
        76,
        0x10,
        0,
        0,
        0,
        0,
        76 + string_len as i32,
    ]));
    let mut s: Vec<u8> = ids.iter().flat_map(|g| g.to_le_bytes()).collect();
    s.resize(string_len, 0);
    body.extend(s);
    body.extend(le(dx));
    e.rec(84, &body);
}

#[test]
fn glyph_index_text() {
    // An installed family: indices are used as they are.
    let db = fonts();
    let face = db
        .select("Liberation Sans", false, false)
        .expect("font")
        .face;
    let ids: Vec<u16> = "Hi"
        .chars()
        .map(|c| db.glyph(face, c).expect("glyph"))
        .collect();
    let mut e = Emf::new(400, 200);
    text_setup(&mut e, "Liberation Sans");
    glyph_text(&mut e, &ids, &[29, 9]);
    assert!(ink(&e).w > 20.0);
    // A substituted family: indices follow the standard Macintosh order when
    // the recorded advances agree ("Hello" = 43 72 79 79 82).
    let mut e = Emf::new(400, 200);
    text_setup(&mut e, "Arial");
    glyph_text(&mut e, &[43, 72, 79, 79, 82], &[29, 22, 9, 9, 22]);
    assert!(ink(&e).w > 60.0);
    // Advances that contradict the guess: nothing is drawn rather than garbage.
    let mut e = Emf::new(400, 200);
    text_setup(&mut e, "Arial");
    glyph_text(&mut e, &[43, 72, 79, 79, 82], &[90, 4, 70, 3, 60]);
    assert!(load(&e.finish()).nodes.is_empty());
}

#[test]
fn small_and_poly_text() {
    let mut e = Emf::new(400, 200);
    text_setup(&mut e, "Arial");
    // EMR_SMALLTEXTOUT with 8-bit characters and no rectangle.
    let mut body = le(&[20, 100, 3, 0x100 | 0x200, 1]);
    body.extend(lef(&[0.0, 0.0]));
    body.extend_from_slice(b"abc\0");
    e.rec(108, &body);
    let small = ink(&e);
    assert!(small.w > 40.0 && small.x >= 19.0, "{small:?}");
    // EMR_POLYTEXTOUTW with two strings.
    let mut e = Emf::new(400, 200);
    text_setup(&mut e, "Arial");
    let mut body = le(&[0, 0, -1, -1, 1]);
    body.extend(lef(&[0.0, 0.0]));
    body.extend(le(&[2]));
    let strings_at = 8 + body.len() as i32 + 80;
    body.extend(le(&[20, 60, 2, strings_at, 0, 0, 0, 0, 0, 0]));
    body.extend(le(&[20, 160, 2, strings_at + 4, 0, 0, 0, 0, 0, 0]));
    body.extend(le16(&[
        i16::from(b'A'),
        i16::from(b'B'),
        i16::from(b'C'),
        i16::from(b'D'),
    ]));
    e.rec(97, &body);
    let both = ink(&e);
    assert!(both.y < 40.0 && both.bottom() > 150.0, "{both:?}");
}

#[test]
fn text_stays_upright_with_y_up_mapping() {
    let mut e = Emf::new(400, 400);
    // MM_HIMETRIC (y up) with the origin moved to the bottom-left.
    e.ints(17, &[3]).ints(12, &[0, 400]);
    e.font(1, -1000, 0, 400, "Arial")
        .select(1)
        .ints(SETBKMODE, &[1])
        .ints(SETTEXTALIGN, &[24]);
    e.text(500, 5000, "Ty", None, 0, [0; 4]);
    let b = ink(&e);
    // Baseline at 5000 units = 189 px above the bottom → device y = 211.
    // Upright glyphs have most of their ink above the baseline.
    assert!(b.y < 200.0 && b.bottom() < 235.0, "{b:?}");
}

#[test]
fn user_dashes_and_inside_frame() {
    let mut e = Emf::new(200, 200);
    // Geometric user-style pen: 20 on, 20 off (logical units), flat caps.
    e.rec(
        95,
        &le(&[
            1,
            0,
            0,
            0,
            0,
            0x1_0000 | 0x200 | 7,
            6,
            0,
            0xFF0000,
            0,
            2,
            20,
            20,
        ]),
    );
    e.select(1).ints(27, &[0, 50]).ints(54, &[200, 50]);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 10, 50), [0, 0, 255]));
    assert_eq!(px(&r, 30, 50)[3], 0);
    // PS_INSIDEFRAME keeps a 20 px pen inside the box.
    let mut e = Emf::new(200, 200);
    e.pen(1, 6, 20, 0x0000FF)
        .select(1)
        .select(0x8000_0005)
        .rect(50, 50, 150, 150);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 52, 100), [255, 0, 0]));
    assert_eq!(px(&r, 47, 100)[3], 0);
}

#[test]
fn gradient_fills() {
    let vertex = |x: i32, y: i32, r: u16, g: u16, b: u16| {
        let mut v = le(&[x, y]);
        v.extend(le16(&[r as i16, g as i16, b as i16, 0]));
        v
    };
    let mut e = Emf::new(200, 200);
    let mut body = le(&[0, 0, 0, 0, 2, 1, 0]);
    body.extend(vertex(0, 0, 0, 0, 0));
    body.extend(vertex(200, 100, -256i16 as u16, 0, 0));
    body.extend(le(&[0, 1]));
    e.rec(118, &body);
    let mut body = le(&[0, 0, 0, 0, 3, 1, 2]);
    body.extend(vertex(0, 100, 0, -256i16 as u16, 0));
    body.extend(vertex(200, 100, 0, -256i16 as u16, 0));
    body.extend(vertex(100, 200, 0, -256i16 as u16, 0));
    body.extend(le(&[0, 1, 2]));
    e.rec(118, &body);
    let r = render(&load(&e.finish()), SCALE);
    assert!(
        px(&r, 190, 50)[0] > 200 && px(&r, 10, 50)[0] < 40,
        "horizontal ramp"
    );
    assert!(
        near(px(&r, 100, 130), [0, 255, 0]),
        "{:?}",
        px(&r, 100, 130)
    );
    assert_eq!(px(&r, 20, 190)[3], 0, "outside the triangle");
}

#[test]
fn pattern_and_mono_brushes() {
    let pattern = dib24(&[&[[255, 0, 0], [0, 0, 255]], &[[0, 0, 255], [255, 0, 0]]]);
    let brush_record = |ty: u32, dib: &(Vec<u8>, Vec<u8>)| {
        let (bmi, bits) = dib;
        let mut body = le(&[
            1,
            0,
            32,
            bmi.len() as i32,
            32 + bmi.len() as i32,
            bits.len() as i32,
        ]);
        body.extend_from_slice(bmi);
        body.extend_from_slice(bits);
        (ty, body)
    };
    let mut e = Emf::new(64, 64);
    let (ty, body) = brush_record(94, &pattern);
    e.rec(ty, &body)
        .select(1)
        .select(NULL_PEN)
        .rect(0, 0, 64, 64);
    let r = render(&load(&e.finish()), SCALE * 4.0);
    let colors: Vec<[u8; 4]> = (0..16).map(|x| px(&r, x, 2)).collect();
    assert!(
        colors.iter().any(|p| near(*p, [255, 0, 0]))
            && colors.iter().any(|p| near(*p, [0, 0, 255])),
        "{colors:?}"
    );
    // A monochrome brush takes the text (clear bits) and background (set bits) colors.
    let mono = dib1(&[&[true, false], &[false, true]]);
    let mut e = Emf::new(64, 64);
    e.ints(24, &[0x00FF00]).ints(25, &[0x0000FF]);
    let (ty, body) = brush_record(93, &mono);
    e.rec(ty, &body)
        .select(1)
        .select(NULL_PEN)
        .rect(0, 0, 64, 64);
    let r = render(&load(&e.finish()), SCALE * 4.0);
    let colors: Vec<[u8; 4]> = (0..16).map(|x| px(&r, x, 2)).collect();
    assert!(
        colors.iter().any(|p| near(*p, [0, 255, 0]))
            && colors.iter().any(|p| near(*p, [255, 0, 0]))
    );
}

#[test]
fn palette_indices_and_mix_modes() {
    let mut e = Emf::new(100, 100);
    // A palette whose entry 1 is green, selected, then a PALETTEINDEX(1) brush.
    e.rec(
        49,
        &[
            le(&[5]),
            le16(&[0x300, 2]),
            vec![255, 0, 0, 0, 0, 255, 0, 0],
        ]
        .concat(),
    );
    e.ints(48, &[5]);
    e.brush(1, 0, 0x0100_0001, 0)
        .select(1)
        .select(NULL_PEN)
        .rect(0, 0, 50, 100);
    // R2_NOP draws nothing; R2_BLACK draws black.
    e.brush(2, 0, 0x0000FF, 0)
        .select(2)
        .ints(20, &[11])
        .rect(50, 0, 100, 50);
    e.ints(20, &[1]).rect(50, 50, 100, 100);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 25, 50), [0, 255, 0]), "{:?}", px(&r, 25, 50));
    assert_eq!(px(&r, 75, 25)[3], 0);
    assert!(near(px(&r, 75, 75), [0, 0, 0]));
}

#[test]
fn region_painting_meta_region_and_offsets() {
    let rgn = |rects: &[[i32; 4]]| {
        let mut d = le(&[
            32,
            1,
            rects.len() as i32,
            16 * rects.len() as i32,
            0,
            0,
            100,
            100,
        ]);
        for r in rects {
            d.extend(le(r));
        }
        d
    };
    let mut e = Emf::new(100, 100);
    e.brush(1, 0, 0x0000FF, 0).brush(2, 0, 0xFF0000, 0);
    // FILLRGN with brush 1.
    let data = rgn(&[[0, 0, 40, 40]]);
    e.rec(
        71,
        &[le(&[0, 0, 0, 0, data.len() as i32, 1]), data].concat(),
    );
    // FRAMERGN with brush 2, 5 × 5 frame.
    let data = rgn(&[[50, 0, 100, 50]]);
    e.rec(
        72,
        &[le(&[0, 0, 0, 0, data.len() as i32, 2, 5, 5]), data].concat(),
    );
    // A meta region keeps clipping after the clip region is reset; offsets move the clip.
    e.ints(30, &[0, 50, 100, 100])
        .ints(28, &[])
        .ints(30, &[0, 0, 10, 100])
        .ints(26, &[90, 0]);
    e.select(1).select(NULL_PEN).rect(0, 0, 100, 100);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 20, 20), [255, 0, 0]));
    assert!(near(px(&r, 52, 25), [0, 0, 255]), "frame edge");
    assert_eq!(px(&r, 75, 25)[3], 0, "frame interior");
    assert!(
        near(px(&r, 95, 75), [255, 0, 0]),
        "offset clip inside the meta region"
    );
    assert_eq!(px(&r, 50, 75)[3], 0);
    assert_eq!(px(&r, 92, 30)[3], 0, "meta region still clips");
}

#[test]
fn transparent_mask_and_parallelogram_blits() {
    let image = dib24(&[&[[255, 0, 0], [0, 255, 0]], &[[0, 255, 0], [255, 0, 0]]]);
    let mut e = Emf::new(200, 200);
    // TransparentBlt keyed on green.
    e.blt(116, [0, 0, 100, 100], 0x00FF00, [0, 0, 2, 2], Some(&image));
    // PlgBlt onto a parallelogram.
    let (bmi, bits) = &image;
    let mut body = le(&[0, 0, 0, 0, 100, 100, 200, 100, 100, 200, 0, 0, 2, 2]);
    body.extend(lef(&[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
    let off = 140;
    body.extend(le(&[
        0,
        0,
        off,
        bmi.len() as i32,
        off + bmi.len() as i32,
        bits.len() as i32,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ]));
    body.extend_from_slice(bmi);
    body.extend_from_slice(bits);
    e.rec(79, &body);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 25, 25), [255, 0, 0]));
    assert!(px(&r, 75, 25)[3] < 10, "keyed out");
    assert!(near(px(&r, 125, 125), [255, 0, 0]));
    assert!(near(px(&r, 175, 125), [0, 255, 0]));
}

#[test]
fn set_dibits_to_device_is_unscaled() {
    let image = dib24(&[&[[255, 0, 0], [0, 255, 0]], &[[0, 0, 255], [255, 255, 255]]]);
    let (bmi, bits) = &image;
    let mut e = Emf::new(100, 100);
    // Logical units are 10 device pixels, but the image keeps its 2 × 2 pixels.
    e.ints(17, &[8]).ints(9, &[10, 10]).ints(11, &[100, 100]);
    let mut body = le(&[
        0,
        0,
        0,
        0,
        5,
        5,
        0,
        0,
        2,
        2,
        76,
        bmi.len() as i32,
        76 + bmi.len() as i32,
        bits.len() as i32,
    ]);
    body.extend(le(&[0, 0, 2]));
    body.extend_from_slice(bmi);
    body.extend_from_slice(bits);
    e.rec(80, &body);
    let r = render(&load(&e.finish()), SCALE * 8.0);
    assert!(
        near(px(&r, 404, 404), [255, 0, 0]),
        "{:?}",
        px(&r, 404, 404)
    );
    assert!(near(px(&r, 412, 412), [255, 255, 255]));
    assert_eq!(px(&r, 430, 430)[3], 0);
}

#[test]
fn polydraw_anglearc_and_arcto() {
    let mut e = Emf::new(200, 200);
    e.pen(1, 0, 4, 0xFF0000).select(1);
    // PolyDraw: move, line, line | close.
    let mut body = le(&[0, 0, 0, 0, 3]);
    body.extend(le16(&[10, 10, 90, 10, 90, 90]));
    body.extend_from_slice(&[6, 2, 3, 0]);
    e.rec(92, &body);
    // AngleArc from the current position (90, 90).
    e.rec(41, &[le(&[150, 150, 40]), lef(&[0.0, 90.0])].concat());
    // ArcTo: the current position moved to the arc's end.
    e.ints(55, &[100, 100, 200, 200, 200, 150, 150, 100]);
    e.ints(54, &[0, 200]);
    let r = render(&load(&e.finish()), SCALE);
    assert!(near(px(&r, 50, 10), [0, 0, 255]), "first segment");
    assert!(near(px(&r, 50, 50), [0, 0, 255]), "closing diagonal");
    assert!(
        near(px(&r, 190, 150), [0, 0, 255]),
        "{:?}",
        px(&r, 190, 150)
    );
    let mid = px(&r, 75, 150);
    assert!(near(mid, [0, 0, 255]), "line from the arc end: {mid:?}");
}
