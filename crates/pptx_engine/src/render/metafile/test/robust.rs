//! Malformed input: truncations, byte flips, and hostile counts must never panic.

use super::builder::{Emf, Wmf, dib1, dib24, le, le16, lef};
use super::fixture_files;
use crate::render::raster::rasterize;
use crate::test_support::fonts;

/// An EMF touching most record families.
fn rich_emf() -> Vec<u8> {
    let mut e = Emf::new(120, 90);
    e.ints(17, &[8]).ints(9, &[1200, 900]).ints(11, &[120, 90]);
    e.pen(1, 0x1_0000 | 0x200 | 1, 30, 0x0000FF).select(1);
    e.brush(2, 2, 0x00FF00, 3)
        .select(2)
        .rect(10, 10, 600, 400)
        .ellipse(600, 10, 1100, 400);
    e.ints(44, &[10, 450, 500, 850, 100, 100]);
    e.ints(47, &[600, 450, 1100, 850, 1100, 650, 850, 450]);
    e.ints(55, &[600, 450, 1100, 850, 600, 650, 1100, 650]);
    e.rec(41, &[le(&[300, 300, 100]), lef(&[30.0, 120.0])].concat());
    e.poly16(86, &[(0, 0), (500, 100), (100, 500)])
        .poly16(88, &[(0, 0), (100, 100), (200, 0)]);
    e.ints(33, &[])
        .ints(30, &[0, 0, 600, 600])
        .ints(29, &[100, 100, 200, 200]);
    e.rec(35, &lef(&[0.8, 0.6, -0.6, 0.8, 50.0, 50.0]));
    e.font(3, -120, 450, 700, "Times New Roman").select(3);
    e.text(
        100,
        500,
        "Text €",
        Some(&[60, 60, 60, 60, 60, 60]),
        6,
        [0, 0, 800, 800],
    );
    e.ints(34, &[-1]);
    e.ints(59, &[])
        .ints(27, &[0, 0])
        .ints(54, &[300, 0])
        .ints(54, &[300, 300])
        .ints(61, &[])
        .ints(60, &[]);
    e.ints(67, &[1]);
    e.stretch_dib(
        [0, 0, 600, 600],
        [0, 0, 2, 2],
        &dib24(&[&[[1, 2, 3], [4, 5, 6]], &[[7, 8, 9], [10, 11, 12]]]),
        0x00CC_0020,
    );
    e.blt(
        77,
        [0, 0, 300, 300],
        0x0088_00C6,
        [0, 0, 2, 2],
        Some(&dib1(&[&[true, false], &[false, true]])),
    );
    e.blt(
        114,
        [0, 0, 300, 300],
        0x01FF_0000,
        [0, 0, 1, 1],
        Some(&super::builder::dib32(1, 1, [9, 9, 9, 9])),
    );
    let mut rgn = le(&[48, 5, 32, 1, 1, 16, 0, 0, 50, 50]);
    rgn.extend(le(&[0, 0, 50, 50]));
    e.rec(75, &rgn);
    e.rec(
        36,
        &[lef(&[2.0, 0.0, 0.0, 2.0, 0.0, 0.0]), le(&[3])].concat(),
    );
    e.ints(28, &[]).ints(62, &[0, 0, 0, 0]);
    e.finish()
}

/// A WMF touching most record families.
fn rich_wmf() -> Vec<u8> {
    let mut w = Wmf::placeable([0, 0, 1000, 800], 1440);
    w.rec(0x020B, &[0, 0]).rec(0x020C, &[800, 1000]);
    let mut pen = le16(&[1, 3, 0]);
    pen.extend_from_slice(&0x00FF00u32.to_le_bytes());
    w.raw(0x02FA, &pen);
    let mut brush = le16(&[2]);
    brush.extend_from_slice(&0xFF0000u32.to_le_bytes());
    brush.extend(le16(&[5]));
    w.raw(0x02FC, &brush);
    w.rec(0x012D, &[0]).rec(0x012D, &[1]);
    w.rec(0x041B, &[400, 500, 10, 10])
        .rec(0x0418, &[700, 900, 300, 300])
        .rec(0x081A, &[0, 500, 300, 900, 700, 900, 300, 300]);
    w.rec(0x0324, &[3, 0, 0, 500, 100, 100, 500]).rec(
        0x0538,
        &[2, 3, 3, 0, 0, 10, 0, 0, 10, 20, 20, 30, 20, 20, 30],
    );
    let mut font = le16(&[-100, 0, 300, 0, 700]);
    font.extend_from_slice(&[1, 1, 1, 0, 0, 0, 0, 0]);
    font.extend_from_slice(b"Arial\0");
    w.raw(0x02FB, &font).rec(0x012D, &[2]);
    let mut text = le16(&[100, 100, 4, 6, 0, 0, 500, 500]);
    text.extend_from_slice(b"\x80\x96ab");
    text.extend(le16(&[50, 50, 50, 50]));
    w.raw(0x0A32, &text);
    w.rec(0x001E, &[])
        .rec(0x0416, &[600, 600, 100, 100])
        .rec(0x0415, &[300, 300, 200, 200])
        .rec(0x0127, &[-1]);
    let (bmi, bits) = dib24(&[&[[1, 2, 3], [4, 5, 6]]]);
    let mut blt = 0x00CC_0020u32.to_le_bytes().to_vec();
    blt.extend(le16(&[1, 2, 0, 0, 500, 500, 0, 0]));
    blt.extend(bmi);
    blt.extend(bits);
    w.raw(0x0B41, &blt);
    w.finish()
}

/// Deterministic xorshift.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// Parses (and, when it parses, rasterizes at a tiny size) without panicking.
fn exercise(bytes: &[u8], draw: bool) {
    if let Ok(m) = super::super::parse(bytes, fonts()) {
        assert!(m.width_pt.is_finite() && m.height_pt.is_finite());
        if draw {
            let scale = 32.0 / m.width_pt.max(m.height_pt).max(1e-3);
            let _ = rasterize(&m.nodes, 32, 32, scale);
        }
    }
}

#[test]
fn rich_samples_parse() {
    for bytes in [rich_emf(), rich_wmf()] {
        let m = super::load(&bytes);
        assert!(!m.nodes.is_empty());
    }
}

#[test]
fn truncations_never_panic() {
    for bytes in [rich_emf(), rich_wmf()] {
        for len in 0..bytes.len() {
            exercise(&bytes[..len], len % 41 == 0);
        }
    }
}

#[test]
fn byte_flips_never_panic() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let mut samples = vec![rich_emf(), rich_wmf()];
    samples.extend(
        fixture_files()
            .into_iter()
            .map(|(_, b)| b)
            .filter(|b| b.len() < 64 * 1024),
    );
    for sample in &samples {
        for i in 0..250 {
            let mut b = sample.clone();
            for _ in 0..1 + rng.below(8) {
                let at = rng.below(b.len());
                b[at] = match rng.below(4) {
                    0 => 0xFF,
                    1 => 0x00,
                    2 => 0x80,
                    _ => rng.next() as u8,
                };
            }
            exercise(&b, i % 25 == 0);
        }
    }
}

#[test]
fn hostile_counts_and_sizes() {
    // A polygon claiming four billion points.
    let mut e = Emf::new(10, 10);
    e.ints(3, &[0, 0, 0, 0, -1]);
    exercise(&e.finish(), true);
    // A bitmap claiming to be enormous.
    let mut huge = le(&[40, 60_000, 60_000]);
    huge.extend(le16(&[1, 32]));
    huge.extend(le(&[0, 0, 0, 0, 0, 0]));
    let mut e = Emf::new(10, 10);
    e.stretch_dib(
        [0, 0, 10, 10],
        [0, 0, 60_000, 60_000],
        &(huge, vec![0; 64]),
        0x00CC_0020,
    );
    exercise(&e.finish(), true);
    // Object indices far out of range, deep RestoreDC, zero extents, NaN transforms.
    let mut e = Emf::new(10, 10);
    e.select(0x7FFF_FFFF)
        .ints(40, &[i32::MAX])
        .ints(34, &[-1000])
        .ints(34, &[1000]);
    e.ints(17, &[8]).ints(9, &[0, 0]).ints(11, &[0, 5]);
    e.rec(35, &lef(&[f32::NAN, 0.0, 0.0, f32::INFINITY, 0.0, 0.0]));
    e.rect(0, 0, 5, 5);
    for _ in 0..5000 {
        e.ints(33, &[]);
    }
    exercise(&e.finish(), true);
    // A record whose size runs past the end, and one of size zero.
    let mut bytes = Emf::new(10, 10).finish();
    let n = bytes.len();
    bytes[n - 16..n - 12].copy_from_slice(&1000u32.to_le_bytes());
    exercise(&bytes, true);
    let mut bytes = Emf::new(10, 10).finish();
    bytes.truncate(108);
    bytes.extend(le(&[43, 0]));
    exercise(&bytes, true);
    // Garbage that merely starts like a metafile.
    exercise(&[1, 0, 9, 0], true);
    exercise(&[0xD7, 0xCD, 0xC6, 0x9A], true);
    assert!(super::super::parse(b"not a metafile", fonts()).is_err());
}

#[test]
fn adversarial_volume_stays_linear() {
    // 100k object creations: the WMF table fills up and every later
    // creation must not rescan all 65,536 slots.
    let mut w = Wmf::placeable([0, 0, 100, 100], 72);
    let mut pen = le16(&[0, 1, 0]);
    pen.extend_from_slice(&0u32.to_le_bytes());
    for _ in 0..100_000 {
        w.raw(0x02FA, &pen);
    }
    w.rec(0x041B, &[50, 50, 0, 0]);
    exercise(&w.finish(), false);
    // Region differences of many rectangles fall back to path clips.
    let mut e = Emf::new(100, 100);
    let rects: Vec<i32> = (0..2000)
        .flat_map(|i| [i % 100, i / 20, i % 100 + 1, i / 20 + 1])
        .collect();
    let mut body = le(&[32 + 16 * 2000, 4, 32, 1, 2000, 16 * 2000, 0, 0, 100, 100]);
    body.extend(le(&rects));
    for _ in 0..50 {
        e.rec(75, &body);
    }
    e.rect(0, 0, 100, 100);
    exercise(&e.finish(), true);
}
