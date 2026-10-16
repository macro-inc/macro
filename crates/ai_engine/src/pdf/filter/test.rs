use super::*;
use crate::pdf::Name;
use std::collections::HashMap;

fn params(pairs: &[(&str, i64)]) -> Dict {
    Dict(
        pairs
            .iter()
            .map(|&(k, v)| (Name::new(k), Object::Int(v)))
            .collect(),
    )
}

/// Data that compresses somewhat: repeats with variation.
fn sample(len: usize) -> Vec<u8> {
    let mut x: u32 = 12345;
    (0..len)
        .map(|i| {
            x = x.wrapping_mul(1_103_515_245).wrapping_add(12345);
            if i % 7 < 4 {
                (i % 251) as u8
            } else {
                (x >> 24) as u8
            }
        })
        .collect()
}

#[test]
fn flate_round_trip() {
    for len in [0, 1, 100, 70_000] {
        let data = sample(len);
        assert_eq!(decode("FlateDecode", &deflate(&data), None).unwrap(), data);
        assert_eq!(decode("Fl", &deflate(&data), None).unwrap(), data);
    }
}

#[test]
fn flate_keeps_what_inflated_before_damage() {
    let data = sample(200_000);
    let packed = deflate(&data);
    let truncated = decode("FlateDecode", &packed[..packed.len() / 2], None).unwrap();
    assert!(!truncated.is_empty() && truncated.len() < data.len());
    assert_eq!(truncated, data[..truncated.len()]);
    let mut corrupt = packed.clone();
    let mid = corrupt.len() / 2;
    corrupt[mid..mid + 64].fill(0xff);
    let out = decode("FlateDecode", &corrupt, None).unwrap();
    assert!(out.len() >= 1000);
    assert_eq!(out[..1000], data[..1000]);
    // A bad checksum, raw deflate without the zlib header, and junk.
    let mut bad_sum = packed.clone();
    let n = bad_sum.len();
    bad_sum[n - 1] ^= 0xff;
    assert_eq!(decode("FlateDecode", &bad_sum, None).unwrap(), data);
    let raw = miniz_oxide::deflate::compress_to_vec(&data, 6);
    assert_eq!(decode("FlateDecode", &raw, None).unwrap(), data);
    assert_eq!(
        decode("FlateDecode", b"not deflate at all", None).unwrap(),
        b""
    );
    assert_eq!(decode("FlateDecode", b"", None).unwrap(), b"");
}

/// LZW with 9- to 12-bit codes, a clear code first and whenever the table
/// fills, and the end-of-data code last.
fn lzw_encode(data: &[u8], early: bool) -> Vec<u8> {
    let mut codes: Vec<(u32, u32)> = Vec::new();
    let mut table: HashMap<Vec<u8>, u32> = HashMap::new();
    let reset = |table: &mut HashMap<Vec<u8>, u32>| {
        table.clear();
        for b in 0..=255u8 {
            table.insert(vec![b], u32::from(b));
        }
    };
    reset(&mut table);
    let mut next = 258u32;
    let mut width = 9u32;
    codes.push((256, width));
    let mut w: Vec<u8> = Vec::new();
    for &c in data {
        let mut wc = w.clone();
        wc.push(c);
        if table.contains_key(&wc) {
            w = wc;
            continue;
        }
        codes.push((table[&w], width));
        table.insert(wc, next);
        next += 1;
        // The decoder adds each entry a code later, so it widens at
        // `next - 1 + early`.
        if next - 1 + u32::from(early) >= 1 << width && width < 12 {
            width += 1;
        }
        if next == 4096 {
            codes.push((256, width));
            reset(&mut table);
            next = 258;
            width = 9;
        }
        w = vec![c];
    }
    if !w.is_empty() {
        codes.push((table[&w], width));
    }
    codes.push((257, width));
    let mut out = Vec::new();
    let (mut acc, mut n) = (0u64, 0u32);
    for (code, width) in codes {
        acc = (acc << width) | u64::from(code);
        n += width;
        while n >= 8 {
            n -= 8;
            out.push((acc >> n) as u8);
        }
    }
    if n > 0 {
        out.push((acc << (8 - n)) as u8);
    }
    out
}

#[test]
fn lzw() {
    // ISO 32000-1 §7.4.4.2's example.
    let encoded = [0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01];
    assert_eq!(decode("LZWDecode", &encoded, None).unwrap(), b"-----A---B");
    assert_eq!(lzw_encode(b"-----A---B", true), encoded);
    // Through every code width and past a full table, both ways of widening.
    let data = sample(100_000);
    let early = lzw_encode(&data, true);
    assert_eq!(decode("LZWDecode", &early, None).unwrap(), data);
    let late = lzw_encode(&data, false);
    let p = params(&[("EarlyChange", 0)]);
    assert_eq!(decode("LZW", &late, Some(&p)).unwrap(), data);
    // Truncated and invalid input stop without failing.
    let partial = decode("LZWDecode", &early[..early.len() / 2], None).unwrap();
    assert_eq!(partial, data[..partial.len()]);
    assert_eq!(decode("LZWDecode", &[0xff, 0xff, 0xff], None).unwrap(), b"");
}

/// PNG filter `kind` applied to rows of `row` bytes.
fn png_encode(data: &[u8], row: usize, bpp: usize, kind: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let zero = vec![0u8; row];
    for (r, cur) in data.chunks(row).enumerate() {
        let prev = if r == 0 {
            &zero[..]
        } else {
            &data[(r - 1) * row..r * row]
        };
        out.push(kind);
        for i in 0..cur.len() {
            let a = if i >= bpp { cur[i - bpp] } else { 0 };
            let c = if i >= bpp { prev[i - bpp] } else { 0 };
            let b = prev[i];
            let predicted = match kind {
                1 => a,
                2 => b,
                3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                4 => predictor_paeth(a, b, c),
                _ => 0,
            };
            out.push(cur[i].wrapping_sub(predicted));
        }
    }
    out
}

fn predictor_paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let (pa, pb, pc) = (
        (p - i16::from(a)).abs(),
        (p - i16::from(b)).abs(),
        (p - i16::from(c)).abs(),
    );
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

#[test]
fn png_predictors() {
    // RGB, 10 columns: 30-byte rows of 3-byte pixels.
    let data = sample(30 * 9);
    let p = params(&[("Predictor", 12), ("Colors", 3), ("Columns", 10)]);
    for kind in 0..=4 {
        let encoded = deflate(&png_encode(&data, 30, 3, kind));
        assert_eq!(
            decode("FlateDecode", &encoded, Some(&p)).unwrap(),
            data,
            "type {kind}"
        );
    }
    // Filter types can change from row to row.
    let mixed: Vec<u8> = (0..9)
        .flat_map(|r| {
            let rows = png_encode(&data[..(r + 1) * 30], 30, 3, (r % 5) as u8);
            rows[r * 31..].to_vec()
        })
        .collect();
    assert_eq!(
        decode("FlateDecode", &deflate(&mixed), Some(&p)).unwrap(),
        data
    );
    // A truncated last row decodes as far as it goes.
    let encoded = png_encode(&data, 30, 3, 2);
    let cut = deflate(&encoded[..encoded.len() - 10]);
    assert_eq!(
        decode("FlateDecode", &cut, Some(&p)).unwrap(),
        data[..data.len() - 10]
    );
    // 16 bits per component (two-byte pixels), and LZW with a predictor.
    let p = params(&[("Predictor", 15), ("BitsPerComponent", 16), ("Columns", 15)]);
    let encoded = deflate(&png_encode(&data, 30, 2, 4));
    assert_eq!(decode("FlateDecode", &encoded, Some(&p)).unwrap(), data);
    let p = params(&[("Predictor", 10), ("Columns", 30)]);
    let encoded = lzw_encode(&png_encode(&data, 30, 1, 1), true);
    assert_eq!(decode("LZWDecode", &encoded, Some(&p)).unwrap(), data);
}

#[test]
fn tiff_predictor() {
    // 8 bits, 3 colors, 4 columns.
    let raw = [
        10u8, 20, 30, 11, 22, 33, 9, 18, 27, 255, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4,
    ];
    let mut diff = raw;
    for r in diff.chunks_mut(12) {
        for i in (3..12).rev() {
            r[i] = r[i].wrapping_sub(r[i - 3]);
        }
    }
    let p = params(&[("Predictor", 2), ("Colors", 3), ("Columns", 4)]);
    assert_eq!(
        decode("FlateDecode", &deflate(&diff), Some(&p)).unwrap(),
        raw
    );
    // 16 bits, 1 color, 3 columns.
    let raw16: [u16; 6] = [1000, 2000, 65535, 7, 7, 8];
    let mut diff16 = raw16;
    for r in diff16.chunks_mut(3) {
        for i in (1..3).rev() {
            r[i] = r[i].wrapping_sub(r[i - 1]);
        }
    }
    let bytes = |v: &[u16]| v.iter().flat_map(|x| x.to_be_bytes()).collect::<Vec<u8>>();
    let p = params(&[("Predictor", 2), ("BitsPerComponent", 16), ("Columns", 3)]);
    assert_eq!(
        decode("FlateDecode", &deflate(&bytes(&diff16)), Some(&p)).unwrap(),
        bytes(&raw16)
    );
    // 1 bit, 1 color, 10 columns (two bytes a row, six bits of padding):
    // samples 1 1 0 0 1 0 1 1 1 0 differ as 1 0 1 0 1 1 1 0 0 1.
    let p = params(&[("Predictor", 2), ("BitsPerComponent", 1), ("Columns", 10)]);
    let diff = [0b1010_1110, 0b0100_0000];
    assert_eq!(
        decode("FlateDecode", &deflate(&diff), Some(&p)).unwrap(),
        [0b1100_1011, 0b1000_0000]
    );
}

#[test]
fn ascii_hex() {
    assert_eq!(
        decode("ASCIIHexDecode", b"48656C6C6F>", None).unwrap(),
        b"Hello"
    );
    assert_eq!(decode("AHx", b"48 65 6c\n6c 6F", None).unwrap(), b"Hello");
    assert_eq!(decode("ASCIIHexDecode", b"7>", None).unwrap(), [0x70]);
    assert_eq!(decode("ASCIIHexDecode", b"41>42", None).unwrap(), b"A");
    assert_eq!(decode("ASCIIHexDecode", b"4x1", None).unwrap(), b"A");
}

#[test]
fn ascii85() {
    assert_eq!(decode("ASCII85Decode", b"9jqo^", None).unwrap(), b"Man ");
    assert_eq!(
        decode("ASCII85Decode", b"F*2M7/c~>", None).unwrap(),
        b"sure."
    );
    assert_eq!(
        decode("A85", b"9jqo^BlbD-BleB1DJ+*+F(f,q~>", None).unwrap(),
        b"Man is distinguished"
    );
    assert_eq!(
        decode("ASCII85Decode", b"z@:E^~>", None).unwrap(),
        b"\0\0\0\0abc"
    );
    assert_eq!(
        decode("ASCII85Decode", b"<~87cUR\nD_*#4 DfTZ)\r\n+US~>", None).unwrap(),
        b"Hello, World!\n"
    );
    assert_eq!(decode("ASCII85Decode", b"~>", None).unwrap(), b"");
    // A lone final character makes no byte.
    assert_eq!(decode("ASCII85Decode", b"9jqo^9~>", None).unwrap(), b"Man ");
}

#[test]
fn run_length() {
    let data = [2, b'a', b'b', b'c', 254, b'x', 0, b'y', 128, 5, b'z'];
    assert_eq!(decode("RunLengthDecode", &data, None).unwrap(), b"abcxxxy");
    assert_eq!(decode("RL", &[129, 7], None).unwrap(), [7; 128]);
    // Runs cut short by the end.
    assert_eq!(
        decode("RunLengthDecode", &[5, b'a', b'b'], None).unwrap(),
        b"ab"
    );
    assert_eq!(decode("RunLengthDecode", &[200], None).unwrap(), b"");
}

#[test]
fn unknown_filters_fail() {
    assert!(decode("NoSuchDecode", b"", None).is_err());
    assert!(decode("DCTDecode", b"", None).is_err());
}

#[test]
fn filter_chains() {
    let data = sample(300);
    let hex: Vec<u8> = deflate(&data)
        .iter()
        .flat_map(|b| format!("{b:02x}").into_bytes())
        .collect();
    let mut dict = Dict::new();
    dict.set(
        "Filter",
        vec![Object::name("ASCIIHexDecode"), Object::name("FlateDecode")],
    );
    let (out, codec) = decode_chain(&dict, &hex, &|o| o.clone()).unwrap();
    assert_eq!((out, codec), (data.clone(), None));
    // Parameters by position, `null` for none, with references resolved.
    let png = deflate(&png_encode(&data, 10, 1, 2));
    let hex: Vec<u8> = png
        .iter()
        .flat_map(|b| format!("{b:02x}").into_bytes())
        .collect();
    dict.set(
        "DecodeParms",
        vec![Object::Null, Object::Ref(crate::pdf::ObjRef::new(9, 0))],
    );
    let resolve = |o: &Object| match o {
        Object::Ref(_) => Object::Dict(params(&[("Predictor", 12), ("Columns", 10)])),
        o => o.clone(),
    };
    assert_eq!(decode_chain(&dict, &hex, &resolve).unwrap().0, data);
    // A single filter and parameters as a name and a dictionary.
    let mut dict = Dict::new();
    dict.set("Filter", Object::name("FlateDecode"));
    dict.set("DecodeParms", params(&[("Predictor", 12), ("Columns", 10)]));
    assert_eq!(decode_chain(&dict, &png, &|o| o.clone()).unwrap().0, data);
    // No filter.
    assert_eq!(
        decode_chain(&Dict::new(), b"abc", &|o| o.clone())
            .unwrap()
            .0,
        b"abc"
    );
}

#[test]
fn image_codecs_stop_the_chain() {
    let jpeg = b"\xff\xd8 not really a jpeg";
    let mut dict = Dict::new();
    dict.set(
        "Filter",
        vec![Object::name("FlateDecode"), Object::name("DCTDecode")],
    );
    dict.set(
        "DecodeParms",
        vec![Object::Null, Object::Dict(params(&[("ColorTransform", 0)]))],
    );
    let (out, codec) = decode_chain(&dict, &deflate(jpeg), &|o| o.clone()).unwrap();
    assert_eq!(out, jpeg);
    assert_eq!(
        codec,
        Some(ImageCodec::Dct(params(&[("ColorTransform", 0)])))
    );
    for (name, codec) in [
        ("JPXDecode", ImageCodec::Jpx),
        ("JBIG2Decode", ImageCodec::Jbig2(Dict::new())),
        ("CCITTFaxDecode", ImageCodec::Ccitt(Dict::new())),
        ("DCTDecode", ImageCodec::Dct(Dict::new())),
    ] {
        let mut dict = Dict::new();
        dict.set("Filter", Object::name(name));
        let (out, got) = decode_chain(&dict, b"data", &|o| o.clone()).unwrap();
        assert_eq!((out.as_slice(), got), (&b"data"[..], Some(codec)));
    }
    let mut dict = Dict::new();
    dict.set("Filter", Object::name("BogusDecode"));
    assert!(decode_chain(&dict, b"x", &|o| o.clone()).is_err());
}
