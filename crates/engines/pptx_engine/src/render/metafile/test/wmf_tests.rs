//! WMF record semantics, checked on rendered pixels.

use super::builder::{Emf, Wmf, dib24, le, le16, rgb};
use super::{load, near, px, render};
use crate::render::metafile::charset::decode_ansi;

const SETWINDOWORG: u16 = 0x020B;
const SETWINDOWEXT: u16 = 0x020C;
const SETBKMODE: u16 = 0x0102;
const SELECTOBJECT: u16 = 0x012D;
const DELETEOBJECT: u16 = 0x01F0;
const CREATEPENINDIRECT: u16 = 0x02FA;
const CREATEBRUSHINDIRECT: u16 = 0x02FC;
const RECTANGLE: u16 = 0x041B;
const SETTEXTALIGN: u16 = 0x012E;
const TEXTOUT: u16 = 0x0521;
const CREATEFONTINDIRECT: u16 = 0x02FB;
const CREATEREGION: u16 = 0x06FF;
const FILLREGION: u16 = 0x0228;
const SELECTCLIPREGION: u16 = 0x012C;
const STRETCHDIB: u16 = 0x0F43;
const ESCAPE: u16 = 0x0626;
const PATBLT: u16 = 0x061D;

fn brush(w: &mut Wmf, color: u32) {
    let mut p = le16(&[0]);
    p.extend_from_slice(&color.to_le_bytes());
    p.extend(le16(&[0]));
    w.raw(CREATEBRUSHINDIRECT, &p);
}

fn null_pen(w: &mut Wmf) {
    let mut p = le16(&[5, 0, 0]);
    p.extend_from_slice(&0u32.to_le_bytes());
    w.raw(CREATEPENINDIRECT, &p);
}

/// Draws `rect` (left, top, right, bottom) with the given selected slots.
fn rect(w: &mut Wmf, [l, t, r, b]: [i16; 4]) {
    w.rec(RECTANGLE, &[b, r, t, l]);
}

#[test]
fn placeable_header_maps_the_window_onto_the_picture() {
    let mut w = Wmf::placeable([0, 0, 1000, 1000], 1000);
    w.rec(SETWINDOWORG, &[0, 0])
        .rec(SETWINDOWEXT, &[1000, 1000]);
    null_pen(&mut w);
    brush(&mut w, 0x0000FF);
    w.rec(SELECTOBJECT, &[0]).rec(SELECTOBJECT, &[1]);
    rect(&mut w, [500, 0, 1000, 500]);
    let m = load(&w.finish());
    assert!((m.width_pt - 72.0).abs() < 0.01 && (m.height_pt - 72.0).abs() < 0.01);
    let r = render(&m, 2.0);
    assert!(near(px(&r, 100, 40), [255, 0, 0]));
    assert_eq!(px(&r, 40, 40)[3], 0);
    assert_eq!(px(&r, 100, 100)[3], 0);
}

#[test]
fn window_records_override_the_placeable_bounds() {
    let mut w = Wmf::placeable([0, 0, 1000, 1000], 1000);
    w.rec(SETWINDOWEXT, &[2000, 2000]);
    null_pen(&mut w);
    brush(&mut w, 0x0000FF);
    w.rec(SELECTOBJECT, &[0]).rec(SELECTOBJECT, &[1]);
    rect(&mut w, [0, 0, 1000, 1000]);
    let r = render(&load(&w.finish()), 2.0);
    assert!(near(px(&r, 30, 30), [255, 0, 0]));
    assert_eq!(px(&r, 100, 100)[3], 0, "the window is twice the picture");
}

#[test]
fn objects_take_the_lowest_free_slot() {
    let mut w = Wmf::placeable([0, 0, 100, 100], 100);
    null_pen(&mut w); // slot 0
    brush(&mut w, 0x0000FF); // slot 1: red
    brush(&mut w, 0xFF0000); // slot 2: blue
    w.rec(SELECTOBJECT, &[0]).rec(DELETEOBJECT, &[0]);
    brush(&mut w, 0x00FF00); // reuses slot 0: green
    null_pen(&mut w); // slot 3
    w.rec(SELECTOBJECT, &[3]).rec(SELECTOBJECT, &[0]);
    rect(&mut w, [0, 0, 50, 100]);
    w.rec(SELECTOBJECT, &[2]);
    rect(&mut w, [50, 0, 100, 100]);
    // A deleted slot selects nothing: the blue brush stays.
    w.rec(DELETEOBJECT, &[1]).rec(SELECTOBJECT, &[1]);
    rect(&mut w, [50, 50, 100, 100]);
    let r = render(&load(&w.finish()), 1.0);
    assert!(near(px(&r, 18, 36), [0, 255, 0]), "{:?}", px(&r, 18, 36));
    assert!(near(px(&r, 54, 18), [0, 0, 255]));
    assert!(near(px(&r, 54, 54), [0, 0, 255]));
}

#[test]
fn plain_wmf_uses_the_window_for_its_size() {
    let mut w = Wmf::plain();
    // Parameters are (y, x).
    w.rec(SETWINDOWORG, &[0, 0]).rec(SETWINDOWEXT, &[192, 96]);
    null_pen(&mut w);
    brush(&mut w, 0x0000FF);
    w.rec(SELECTOBJECT, &[0]).rec(SELECTOBJECT, &[1]);
    rect(&mut w, [0, 0, 96, 96]);
    let m = load(&w.finish());
    assert!(
        (m.width_pt - 72.0).abs() < 0.01 && (m.height_pt - 144.0).abs() < 0.01,
        "{} x {}",
        m.width_pt,
        m.height_pt
    );
    let r = render(&m, 1.0);
    assert!(near(px(&r, 36, 36), [255, 0, 0]));
    assert_eq!(px(&r, 36, 108)[3], 0);
}

#[test]
fn plain_wmf_without_a_window_fits_the_drawing() {
    let mut w = Wmf::plain();
    null_pen(&mut w);
    brush(&mut w, 0x0000FF);
    w.rec(SELECTOBJECT, &[0]).rec(SELECTOBJECT, &[1]);
    rect(&mut w, [100, 100, 196, 148]);
    let m = load(&w.finish());
    assert!(
        (m.width_pt - 72.0).abs() < 0.5 && (m.height_pt - 36.0).abs() < 0.5,
        "{} x {}",
        m.width_pt,
        m.height_pt
    );
    let r = render(&m, 1.0);
    assert!(near(px(&r, 36, 18), [255, 0, 0]));
}

#[test]
fn ansi_text_decoding() {
    assert_eq!(
        decode_ansi(&[0x80, b'a', 0xE9, 0x96], 0, false),
        vec!['€', 'a', 'é', '–']
    );
    assert_eq!(decode_ansi(&[0xC0, 0xFF], 204, false), vec!['А', 'я']);
    assert_eq!(decode_ansi(&[0xA3], 238, false), vec!['Ł']);
    assert_eq!(decode_ansi(&[0xC1], 161, false), vec!['Α']);
    assert_eq!(decode_ansi(&[0xF0], 162, false), vec!['ğ']);
    assert_eq!(
        decode_ansi(&[0xA7, 0x80], 2, false),
        vec!['\u{A7}', '\u{80}'],
        "symbol fonts keep byte codes"
    );
}

fn font16(w: &mut Wmf, height: i16, face: &str) {
    let mut p = le16(&[height, 0, 0, 0, 400]);
    p.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
    let mut name = face.as_bytes().to_vec();
    name.resize(32, 0);
    p.extend(name);
    w.raw(CREATEFONTINDIRECT, &p);
}

#[test]
fn textout_draws_cp1252_text() {
    let mut w = Wmf::placeable([0, 0, 400, 100], 96);
    font16(&mut w, -40, "Arial");
    w.rec(SELECTOBJECT, &[0])
        .rec(SETBKMODE, &[1])
        .rec(SETTEXTALIGN, &[24]);
    let mut p = le16(&[3]);
    p.extend_from_slice(&[0x80, b'A', 0xE9, 0]);
    p.extend(le16(&[60, 10]));
    w.raw(TEXTOUT, &p);
    let m = load(&w.finish());
    let b = crate::render::raster::nodes_bounds(&m.nodes).expect("text drawn");
    // Baseline at y = 60 px = 45 pt; three glyphs of a 30 pt font.
    assert!(
        b.bottom() <= 46.0 && b.y > 15.0 && b.x >= 7.0 && b.w > 30.0 && b.w < 70.0,
        "{b:?}"
    );
}

#[test]
fn regions_fill_and_clip() {
    let region = |w: &mut Wmf, [l, t, r, b]: [i16; 4]| {
        let mut p = le16(&[0, 6]);
        p.extend(le(&[0]));
        p.extend(le16(&[34, 1, 2, l, t, r, b]));
        p.extend(le16(&[2, t, b, l, r, 2]));
        w.raw(CREATEREGION, &p);
    };
    let mut w = Wmf::placeable([0, 0, 100, 100], 72);
    null_pen(&mut w); // 0
    brush(&mut w, 0x0000FF); // 1
    brush(&mut w, 0x00FF00); // 2
    region(&mut w, [0, 0, 50, 50]); // 3
    region(&mut w, [50, 50, 100, 100]); // 4
    w.rec(FILLREGION, &[3, 2]);
    w.rec(SELECTOBJECT, &[0])
        .rec(SELECTOBJECT, &[1])
        .rec(SELECTCLIPREGION, &[4]);
    rect(&mut w, [0, 0, 100, 100]);
    let r = render(&load(&w.finish()), 1.0);
    assert!(near(px(&r, 25, 25), [0, 255, 0]));
    assert!(near(px(&r, 75, 75), [255, 0, 0]));
    assert_eq!(px(&r, 75, 25)[3], 0, "clipped by the selected region");
}

#[test]
fn stretch_dib_and_patblt() {
    let (bmi, bits) = dib24(&[&[[255, 0, 0], [0, 255, 0]]]);
    let mut w = Wmf::placeable([0, 0, 100, 100], 72);
    let mut p = 0x00CC_0020u32.to_le_bytes().to_vec();
    p.extend(le16(&[0, 1, 2, 0, 0, 50, 100, 0, 0]));
    p.extend(bmi);
    p.extend(bits);
    w.raw(STRETCHDIB, &p);
    brush(&mut w, 0xFF0000);
    w.rec(SELECTOBJECT, &[0]);
    let mut p = 0x00F0_0021u32.to_le_bytes().to_vec();
    p.extend(le16(&[50, 50, 50, 0]));
    w.raw(PATBLT, &p);
    let r = render(&load(&w.finish()), 1.0);
    assert!(near(px(&r, 25, 25), [255, 0, 0]), "{:?}", px(&r, 25, 25));
    assert!(near(px(&r, 75, 25), [0, 255, 0]));
    assert!(near(px(&r, 25, 75), [0, 0, 255]));
}

#[test]
fn embedded_emf_comments_take_precedence() {
    let mut e = Emf::new(96, 96);
    e.brush(1, 0, 0x0000FF, 0)
        .select(1)
        .select(0x8000_0008)
        .rect(0, 0, 96, 96);
    let emf = e.finish();
    let mut w = Wmf::placeable([0, 0, 100, 100], 100);
    let chunks: Vec<&[u8]> = emf.chunks(100).collect();
    for (i, chunk) in chunks.iter().enumerate() {
        let remaining = emf.len() - chunks[..=i].iter().map(|c| c.len()).sum::<usize>();
        let mut p = le16(&[0x0F, 34 + chunk.len() as i16]);
        p.extend_from_slice(&0x4346_4D57u32.to_le_bytes());
        p.extend(le(&[1, 0x10000]));
        p.extend(le16(&[0]));
        p.extend(le(&[
            0,
            chunks.len() as i32,
            chunk.len() as i32,
            remaining as i32,
            emf.len() as i32,
        ]));
        p.extend_from_slice(chunk);
        w.raw(ESCAPE, &p);
    }
    // The WMF records themselves would draw blue.
    brush(&mut w, 0xFF0000);
    w.rec(SELECTOBJECT, &[0]);
    rect(&mut w, [0, 0, 100, 100]);
    let m = load(&w.finish());
    assert!((m.width_pt - 72.0).abs() < 0.01);
    let r = render(&m, 1.0);
    assert!(near(px(&r, 36, 36), [255, 0, 0]), "{:?}", px(&r, 36, 36));
    let _ = rgb(0, 0, 0);
}
