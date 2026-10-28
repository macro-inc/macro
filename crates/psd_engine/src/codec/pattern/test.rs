use super::*;
use crate::binary::Writer;
use crate::codec::corpus;

/// One channel's array: written, its length, depth, bounds, compression.
fn array(w: &mut Writer, depth: u16, rect: [u32; 4], compression: u8, data: &[u8]) {
    w.u32(1);
    w.u32(23 + data.len() as u32);
    w.u32(u32::from(depth));
    for v in rect {
        w.u32(v);
    }
    w.u16(depth);
    w.u8(compression);
    w.bytes(data);
}

/// A pattern: header, then the array list built by `arrays`.
fn pattern_bytes(
    mode: u32,
    size: (u32, u32),
    id: &str,
    palette: Option<&[u8]>,
    channels: u32,
    arrays: impl FnOnce(&mut Writer),
) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(1);
    w.u32(mode);
    w.i16(size.1 as i16);
    w.i16(size.0 as i16);
    w.unicode_nul("Dots");
    w.pascal(id.as_bytes(), 1);
    if let Some(p) = palette {
        w.bytes(p);
        w.zeros(4);
    }
    w.u32(3);
    let mut list = Writer::new();
    for v in [0, 0, size.1, size.0] {
        list.u32(v);
    }
    list.u32(channels);
    arrays(&mut list);
    let list = list.into_bytes();
    w.u32(list.len() as u32);
    w.bytes(&list);
    w.into_bytes()
}

/// Patterns as a block lists them: each length, then data padded to 4.
fn block(patterns: &[Vec<u8>]) -> Vec<u8> {
    let mut w = Writer::new();
    for p in patterns {
        w.u32(p.len() as u32);
        w.bytes(p);
        while !w.len().is_multiple_of(4) {
            w.u8(0);
        }
    }
    w.into_bytes()
}

fn rgb_with_alpha() -> Vec<u8> {
    let rect = [0, 0, 1, 2];
    pattern_bytes(3, (2, 1), "rgb-id", None, 3, |w| {
        array(w, 8, rect, 0, &[255, 0]);
        array(w, 8, rect, 0, &[0, 255]);
        array(w, 8, rect, 0, &[0, 0]);
        array(w, 8, rect, 0, &[128, 255]); // user mask: transparency
        w.u32(0); // no sheet mask
    })
}

#[test]
fn reads_rgb_with_transparency() {
    let patterns = decode(&block(&[rgb_with_alpha()]), false).expect("decodes");
    assert_eq!(patterns.len(), 1);
    let p = &patterns[0];
    assert_eq!((p.id.as_str(), p.name.as_str()), ("rgb-id", "Dots"));
    assert_eq!((p.width, p.height), (2, 1));
    assert_eq!(&p.rgba[..], [255, 0, 0, 128, 0, 255, 0, 255]);
}

#[test]
fn reads_packbits_gray_and_indexed() {
    // A 4×2 gray pattern: a run of 4 × 200, then a literal row.
    let mut rle = Writer::new();
    rle.u16(2);
    rle.u16(5);
    rle.bytes(&[0xFD, 200]);
    rle.bytes(&[3, 1, 2, 3, 4]);
    let gray = pattern_bytes(1, (4, 2), "gray", None, 1, |w| {
        array(w, 8, [0, 0, 2, 4], 1, rle.buf.as_slice());
        w.u32(0);
        w.u32(0);
    });
    let mut palette = vec![0u8; 768];
    palette[3..6].copy_from_slice(&[10, 20, 30]);
    let indexed = pattern_bytes(2, (1, 1), "indexed", Some(&palette), 1, |w| {
        array(w, 8, [0, 0, 1, 1], 0, &[1]);
        w.u32(0);
        w.u32(0);
    });
    let patterns = decode(&block(&[gray, indexed]), false).expect("decodes");
    assert_eq!(patterns.len(), 2);
    let gray: Vec<u8> = patterns[0].rgba.chunks(4).map(|p| p[0]).collect();
    assert_eq!(gray, [200, 200, 200, 200, 1, 2, 3, 4]);
    assert_eq!(&patterns[1].rgba[..], [10, 20, 30, 255]);
}

#[test]
fn reads_large_document_row_counts_and_zip() {
    let mut rle = Writer::new();
    rle.u32(2);
    rle.bytes(&[0xFF, 9]);
    let wide = pattern_bytes(1, (2, 1), "wide", None, 1, |w| {
        array(w, 8, [0, 0, 1, 2], 1, rle.buf.as_slice());
    });
    // 16-bit samples, zip with prediction: 0x1000, then +0x0100.
    let deltas = [0x10, 0x00, 0x01, 0x00];
    let zipped = miniz_oxide::deflate::compress_to_vec_zlib(&deltas, 6);
    let sixteen = pattern_bytes(1, (2, 1), "zip", None, 1, |w| {
        array(w, 16, [0, 0, 1, 2], 3, &zipped);
    });
    let patterns = decode(&block(&[wide, sixteen]), true).expect("decodes");
    assert_eq!(patterns[0].rgba[0], 9);
    assert_eq!(patterns[0].rgba[4], 9);
    assert_eq!((patterns[1].rgba[0], patterns[1].rgba[4]), (0x10, 0x11));
}

#[test]
fn skips_damaged_patterns_and_rejects_damaged_lists() {
    let good = rgb_with_alpha();
    let mut bad = good.clone();
    bad[3] = 9; // version
    let patterns = decode(&block(&[bad, good.clone()]), false).expect("decodes");
    assert_eq!(patterns.len(), 1);
    // A length running past the data.
    let mut w = Writer::new();
    w.u32(1000);
    w.bytes(&good);
    assert!(decode(&w.into_bytes(), false).is_err());
    // Bounds beyond the pixel limit are skipped, not allocated.
    let huge = pattern_bytes(1, (60000, 60000), "huge", None, 1, |w| w.u32(0));
    assert!(decode(&block(&[huge]), false).expect("decodes").is_empty());
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_patterns() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        for (key, data) in &file.globals {
            if !matches!(key, b"Patt" | b"Pat2" | b"Pat3") || data.is_empty() {
                continue;
            }
            let patterns = match decode(data, file.psb) {
                Ok(p) => p,
                Err(e) => {
                    failures.push(format!("{}: {e}", file.label()));
                    continue;
                }
            };
            for p in &patterns {
                count += 1;
                let png = file.path.with_file_name(format!("pattern-{}.png", p.id));
                let Ok(bytes) = std::fs::read(&png) else {
                    continue;
                };
                let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
                let Ok(mut reader) = decoder.read_info() else {
                    continue;
                };
                let mut buf = vec![0; reader.output_buffer_size().unwrap_or(0)];
                let Ok(info) = reader.next_frame(&mut buf) else {
                    continue;
                };
                compared += 1;
                let theirs = &buf[..info.buffer_size()];
                if (info.width, info.height) != (p.width, p.height) || theirs != &p.rgba[..] {
                    failures.push(format!(
                        "{}: pattern {} differs from ag-psd",
                        file.label(),
                        p.id
                    ));
                }
            }
        }
    }
    eprintln!(
        "{count} patterns, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
