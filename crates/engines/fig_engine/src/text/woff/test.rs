//! The decoders against containers built here from the bundled Inter: WOFF
//! with zlib tables, and WOFF2 with the `glyf`/`loca` and `hmtx`
//! transforms (Brotli stored blocks, since only decompression is needed).

use super::*;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::{FontRef, MetadataProvider};

const INTER: &[u8] = include_bytes!("../../../fonts/InterVariable.ttf");

fn tables(sfnt: &[u8]) -> Vec<(u32, Vec<u8>)> {
    let n = usize::from(be16(sfnt, 4).unwrap());
    (0..n)
        .map(|k| {
            let at = 12 + 16 * k;
            let tag = be32(sfnt, at).unwrap();
            let off = be32(sfnt, at + 8).unwrap() as usize;
            let len = be32(sfnt, at + 12).unwrap() as usize;
            (tag, sfnt[off..off + len].to_vec())
        })
        .collect()
}

fn woff1_of(sfnt: &[u8]) -> Vec<u8> {
    let tables = tables(sfnt);
    let mut dir = Vec::new();
    let mut data = Vec::new();
    let start = 44 + 20 * tables.len();
    for (tag, t) in &tables {
        let packed = miniz_oxide::deflate::compress_to_vec_zlib(t, 6);
        let stored: &[u8] = if packed.len() < t.len() { &packed } else { t };
        dir.extend_from_slice(&tag.to_be_bytes());
        dir.extend_from_slice(&((start + data.len()) as u32).to_be_bytes());
        dir.extend_from_slice(&(stored.len() as u32).to_be_bytes());
        dir.extend_from_slice(&(t.len() as u32).to_be_bytes());
        dir.extend_from_slice(&checksum(t).to_be_bytes());
        data.extend_from_slice(stored);
        data.resize(data.len().next_multiple_of(4), 0);
    }
    let mut out = b"wOFF".to_vec();
    out.extend_from_slice(&sfnt[0..4]);
    out.extend_from_slice(&((start + data.len()) as u32).to_be_bytes());
    out.extend_from_slice(&(tables.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0; 2]);
    out.extend_from_slice(&(sfnt.len() as u32).to_be_bytes());
    out.extend_from_slice(&[0; 24]);
    out.extend(dir);
    out.extend(data);
    out
}

fn base128(v: u32) -> Vec<u8> {
    let mut groups = vec![(v & 0x7F) as u8];
    let mut v = v >> 7;
    while v > 0 {
        groups.push((v & 0x7F) as u8 | 0x80);
        v >>= 7;
    }
    groups.reverse();
    groups
}

/// A Brotli stream of stored (uncompressed) meta-blocks.
fn brotli_stored(data: &[u8]) -> Vec<u8> {
    let mut bits: Vec<bool> = Vec::new();
    let push = |bits: &mut Vec<bool>, v: u32, n: u32| {
        for k in 0..n {
            bits.push(v >> k & 1 != 0);
        }
    };
    let mut out = Vec::new();
    let flush = |bits: &mut Vec<bool>, out: &mut Vec<u8>| {
        while !bits.len().is_multiple_of(8) {
            bits.push(false);
        }
        for byte in bits.chunks(8) {
            out.push(
                byte.iter()
                    .enumerate()
                    .fold(0u8, |b, (k, &on)| b | (u8::from(on) << k)),
            );
        }
        bits.clear();
    };
    push(&mut bits, 0, 1); // WBITS 16
    for chunk in data.chunks(1 << 16) {
        push(&mut bits, 0, 1); // not last
        push(&mut bits, 0, 2); // four nibbles
        push(&mut bits, chunk.len() as u32 - 1, 16);
        push(&mut bits, 1, 1); // uncompressed
        flush(&mut bits, &mut out);
        out.extend_from_slice(chunk);
    }
    push(&mut bits, 1, 1); // last
    push(&mut bits, 1, 1); // empty
    flush(&mut bits, &mut out);
    out
}

fn u16_255(v: u16) -> Vec<u8> {
    let mut out = vec![253];
    out.extend_from_slice(&v.to_be_bytes());
    out
}

/// `glyf` in WOFF2's transformed form (every point as a four-byte triplet,
/// every bounding box explicit).
fn transform_glyf(glyf: &[u8], loca: &[u8], long: bool, num_glyphs: usize) -> Vec<u8> {
    let offset = |i: usize| {
        if long {
            be32(loca, i * 4).unwrap() as usize
        } else {
            usize::from(be16(loca, i * 2).unwrap()) * 2
        }
    };
    let (mut contours, mut points, mut flags, mut glyphs, mut composites, mut bboxes, mut ins) =
        (vec![], vec![], vec![], vec![], vec![], vec![], vec![]);
    let mut bitmap = vec![0u8; num_glyphs.div_ceil(32) * 4];
    for i in 0..num_glyphs {
        let g = &glyf[offset(i)..offset(i + 1)];
        if g.is_empty() {
            contours.extend_from_slice(&0i16.to_be_bytes());
            continue;
        }
        let n = be16(g, 0).unwrap() as i16;
        contours.extend_from_slice(&n.to_be_bytes());
        bitmap[i >> 3] |= 0x80 >> (i & 7);
        bboxes.extend_from_slice(&g[2..10]);
        if n < 0 {
            // Copy the components; instructions follow them when flagged.
            let mut at = 10;
            let mut has_ins = false;
            loop {
                let f = be16(g, at).unwrap();
                let mut len = 4 + if f & 1 != 0 { 4 } else { 2 };
                len += if f & 8 != 0 {
                    2
                } else if f & 0x40 != 0 {
                    4
                } else if f & 0x80 != 0 {
                    8
                } else {
                    0
                };
                composites.extend_from_slice(&g[at..at + len]);
                at += len;
                has_ins |= f & 0x100 != 0;
                if f & 0x20 == 0 {
                    break;
                }
            }
            if has_ins {
                let len = be16(g, at).unwrap();
                glyphs.extend(u16_255(len));
                ins.extend_from_slice(&g[at + 2..at + 2 + usize::from(len)]);
            }
            continue;
        }
        let n = n as usize;
        let ends: Vec<usize> = (0..n)
            .map(|k| usize::from(be16(g, 10 + 2 * k).unwrap()))
            .collect();
        let mut prev = 0;
        for &e in &ends {
            points.extend(u16_255((e + 1 - prev) as u16));
            prev = e + 1;
        }
        let total = prev;
        let ins_len = usize::from(be16(g, 10 + 2 * n).unwrap());
        let mut at = 12 + 2 * n;
        let instructions = &g[at..at + ins_len];
        at += ins_len;
        let mut fl = Vec::with_capacity(total);
        while fl.len() < total {
            let f = g[at];
            at += 1;
            fl.push(f);
            if f & 8 != 0 {
                let r = g[at];
                at += 1;
                fl.extend(std::iter::repeat_n(f, usize::from(r)));
            }
        }
        let mut read = |short: u8, same: u8| -> Vec<i32> {
            fl.iter()
                .map(|&f| {
                    if f & short != 0 {
                        let v = i32::from(g[at]);
                        at += 1;
                        if f & same != 0 { v } else { -v }
                    } else if f & same != 0 {
                        0
                    } else {
                        let v = i32::from(be16(g, at).unwrap() as i16);
                        at += 2;
                        v
                    }
                })
                .collect()
        };
        let xs = read(2, 16);
        let ys = read(4, 32);
        for k in 0..total {
            let (dx, dy) = (xs[k], ys[k]);
            let f = 124 | u8::from(dx >= 0) | (u8::from(dy >= 0) << 1);
            flags.push(f | if fl[k] & 1 == 0 { 0x80 } else { 0 });
            glyphs.extend_from_slice(&(dx.unsigned_abs() as u16).to_be_bytes());
            glyphs.extend_from_slice(&(dy.unsigned_abs() as u16).to_be_bytes());
        }
        glyphs.extend(u16_255(ins_len as u16));
        ins.extend_from_slice(instructions);
    }
    let mut out = Vec::new();
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(num_glyphs as u16).to_be_bytes());
    out.extend_from_slice(&u16::from(long).to_be_bytes());
    let mut bbox = bitmap;
    bbox.extend(bboxes);
    let streams = [contours, points, flags, glyphs, composites, bbox, ins];
    for s in &streams {
        out.extend_from_slice(&(s.len() as u32).to_be_bytes());
    }
    for s in streams {
        out.extend(s);
    }
    out
}

fn woff2_of(sfnt: &[u8]) -> Vec<u8> {
    let tables = tables(sfnt);
    let get = |tag: &[u8; 4]| {
        &tables
            .iter()
            .find(|t| t.0 == u32::from_be_bytes(*tag))
            .unwrap()
            .1
    };
    let long = be16(get(b"head"), 50).unwrap() == 1;
    let num_glyphs = usize::from(be16(get(b"maxp"), 4).unwrap());
    let mut dir = Vec::new();
    let mut stream = Vec::new();
    for (tag, t) in &tables {
        let known = KNOWN_TAGS
            .iter()
            .position(|k| u32::from_be_bytes(**k) == *tag);
        let is = |name: &[u8; 4]| *tag == u32::from_be_bytes(*name);
        let flags = known.map_or(63, |k| k as u8);
        dir.push(flags);
        if known.is_none() {
            dir.extend_from_slice(&tag.to_be_bytes());
        }
        dir.extend(base128(t.len() as u32));
        if is(b"glyf") {
            let g = transform_glyf(t, get(b"loca"), long, num_glyphs);
            dir.extend(base128(g.len() as u32));
            stream.extend(g);
        } else if is(b"loca") {
            dir.extend(base128(0));
        } else {
            stream.extend_from_slice(t);
        }
    }
    let compressed = brotli_stored(&stream);
    let mut out = b"wOF2".to_vec();
    out.extend_from_slice(&sfnt[0..4]);
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(tables.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0; 2]);
    out.extend_from_slice(&(sfnt.len() as u32).to_be_bytes());
    out.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
    out.extend_from_slice(&[0; 24]);
    out.extend(dir);
    out.extend(compressed);
    out
}

#[derive(Default)]
struct Record(Vec<String>);

impl OutlinePen for Record {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.push(format!("M{x},{y}"));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.push(format!("L{x},{y}"));
    }
    fn quad_to(&mut self, a: f32, b: f32, x: f32, y: f32) {
        self.0.push(format!("Q{a},{b},{x},{y}"));
    }
    fn curve_to(&mut self, a: f32, b: f32, c: f32, d: f32, x: f32, y: f32) {
        self.0.push(format!("C{a},{b},{c},{d},{x},{y}"));
    }
    fn close(&mut self) {
        self.0.push("Z".into());
    }
}

/// Every glyph's outline and advance, at the default and a bold instance.
fn drawing(sfnt: &[u8]) -> Vec<(Vec<String>, Option<f32>)> {
    let font = FontRef::new(sfnt).unwrap();
    let bold = font.axes().location([("wght", 800.0)]);
    let mut out = Vec::new();
    for loc in [LocationRef::default(), LocationRef::from(&bold)] {
        let metrics = font.glyph_metrics(Size::unscaled(), loc);
        for (id, glyph) in font.outline_glyphs().iter() {
            let mut pen = Record::default();
            glyph
                .draw(DrawSettings::unhinted(Size::unscaled(), loc), &mut pen)
                .unwrap();
            out.push((pen.0, metrics.advance_width(id)));
        }
    }
    out
}

#[test]
fn unpacks_woff() {
    let woff = woff1_of(INTER);
    let sfnt = to_sfnt(&woff).unwrap();
    assert!(matches!(sfnt, Cow::Owned(_)));
    assert_eq!(drawing(&sfnt), drawing(INTER));
}

#[test]
fn unpacks_woff2_with_transformed_glyphs() {
    let woff2 = woff2_of(INTER);
    let sfnt = to_sfnt(&woff2).unwrap();
    assert_eq!(drawing(&sfnt), drawing(INTER));
}

#[test]
fn passes_plain_fonts_through_and_rejects_damage() {
    assert!(matches!(to_sfnt(INTER), Some(Cow::Borrowed(_))));
    let mut woff2 = woff2_of(INTER);
    woff2.truncate(woff2.len() / 2);
    assert!(to_sfnt(&woff2).is_none());
}

#[test]
fn decodes_triplets() {
    let mut c = Cursor::new(&[0x12, 0x34, 0x56, 0x78]);
    assert_eq!(triplet(124 | 1, &mut c), Some((0x1234, -0x5678)));
    let mut c = Cursor::new(&[5]);
    assert_eq!(triplet(1, &mut c), Some((0, 5)));
    let mut c = Cursor::new(&[0x2F]);
    assert_eq!(triplet(20 + 3, &mut c), Some((3, 16)));
}
