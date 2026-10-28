//! Damaged files give errors, never panics.

use super::*;
use crate::channels::{decode_channel, decode_image};

/// A file with a bit of everything: resources, layers with a mask, a
/// group marker and blocks, a global mask, document blocks, and an RLE
/// merged image.
fn rich() -> Vec<u8> {
    let mut masked = Layer::new(b"masked");
    masked.mask = mask_bytes(0x10, &[1, 200]);
    masked
        .channels
        .push((-2, vec![0, 1, 0, 2, 0, 2, 0xff, 7, 0xff, 8]));
    masked.rest = [
        record_block(b"luni", &luni("masked")),
        record_block(b"lsct", &[0, 0, 0, 1]),
    ]
    .concat();
    let info = layer_info(-2, &[Layer::new(b"plain"), masked], false);
    let doc = [
        doc_block(b"Patt", &[], false),
        doc_block(b"Txt2", &[1, 2, 3], false),
    ]
    .concat();
    let counts = [0, 2].repeat(8);
    let rows = [0xff, 50].repeat(8);
    Spec {
        channels: 4,
        resources: [
            resource(
                1005,
                b"",
                &[0, 72, 0, 0, 0, 1, 0, 1, 0, 72, 0, 0, 0, 1, 0, 1],
            ),
            resource(
                1032,
                b"",
                &[0, 0, 0, 1, 0, 0, 2, 64, 0, 0, 2, 64, 0, 0, 0, 0],
            ),
        ]
        .concat(),
        layers: section(&info, pad4(info.len()), false, Some(&GLOBAL_MASK), &doc),
        image: [&[0, 1][..], &counts, &rows].concat(),
        ..Spec::rgb()
    }
    .bytes()
}

/// A deterministic stream of numbers.
fn xorshift(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

/// Reads, writes back, reads that, and decodes every channel and the
/// merged image, whatever the outcome.
fn exercise(bytes: &[u8]) {
    let Ok(file) = read(bytes) else {
        return;
    };
    let out = write(&file);
    let again = read(&out).expect("what was written reads");
    assert_eq!(
        again.layers.info.records.len(),
        file.layers.info.records.len()
    );
    let (depth, psb) = (file.header.depth, file.header.is_psb());
    for record in &file.layers.info.records {
        let rect = record.rect();
        for channel in &record.channels {
            let _ = decode_channel(channel, rect.w as u32, rect.h as u32, depth, psb);
        }
    }
    let _ = decode_image(&file.image, &file.header);
}

#[test]
fn truncated_files_do_not_panic() {
    for bytes in [rich(), high_bit(16, false), high_bit(32, true)] {
        for len in 0..bytes.len() {
            exercise(&bytes[..len]);
        }
    }
}

#[test]
fn corrupted_files_do_not_panic() {
    let mut state = 0x9e37_79b9_7f4a_7c15;
    for bytes in [rich(), high_bit(16, true)] {
        for _ in 0..4000 {
            let mut damaged = bytes.clone();
            for _ in 0..=xorshift(&mut state) % 3 {
                let at = (xorshift(&mut state) % damaged.len() as u64) as usize;
                damaged[at] = match xorshift(&mut state) % 4 {
                    0 => 0,
                    1 => 0xff,
                    2 => damaged[at] ^ 0x80,
                    _ => xorshift(&mut state) as u8,
                };
            }
            exercise(&damaged);
        }
    }
}

/// `rich()` with the bytes at `at` replaced.
fn patched(at: usize, with: &[u8]) -> Vec<u8> {
    let mut bytes = rich();
    bytes[at..at + with.len()].copy_from_slice(with);
    bytes
}

/// Where the first layer record starts in `rich()`.
fn first_record() -> usize {
    let bytes = rich();
    let resources = 30 + 4 + u32::from_be_bytes(bytes[30..34].try_into().unwrap()) as usize;
    // Section length, layer info length, layer count.
    resources + 4 + 4 + 2
}

fn corrupt_message(bytes: &[u8]) -> String {
    match read(bytes) {
        Err(PsdError::Corrupt(why)) => why,
        other => panic!("expected a damaged file error, got {other:?}"),
    }
}

#[test]
fn damage_is_reported() {
    assert!(matches!(read(b""), Err(PsdError::NotPsd)));
    assert!(matches!(read(b"GIF89a\x01\x00"), Err(PsdError::NotPsd)));
    assert!(matches!(
        read(&patched(4, &[0, 3])),
        Err(PsdError::Unsupported(_))
    ));
    assert!(matches!(
        read(&patched(22, &[0, 7])),
        Err(PsdError::Unsupported(_))
    ));
    assert!(matches!(
        read(&patched(24, &[0, 5])),
        Err(PsdError::Unsupported(_))
    ));
    assert!(matches!(
        read(&patched(18, &[0, 0, 0, 0])),
        Err(PsdError::Corrupt(_))
    ));
    // A section longer than the file.
    assert!(corrupt_message(&patched(26, &[0x7f, 0, 0, 0])).contains("color mode data"));
    let record = first_record();
    // More layers than the layer info could hold.
    assert!(corrupt_message(&patched(record - 2, &[0x7f, 0])).contains("layer count"));
    // A channel's data one byte long.
    assert!(corrupt_message(&patched(record + 18 + 2, &[0, 0, 0, 1])).contains("one byte"));
    // No blend mode signature.
    assert!(corrupt_message(&patched(record + 18 + 24, b"8BIX")).contains("blend mode"));
    // Unknown compression codes.
    let mut layer = Layer::new(b"x");
    layer.channels[0].1 = vec![0, 9, 1, 2];
    assert!(corrupt_message(&layered(&[layer], &[]).bytes()).contains("compression 9"));
    let mut spec = Spec::rgb();
    spec.image[1] = 4;
    assert!(corrupt_message(&spec.bytes()).contains("compression 4"));
    // Mask data too short for its rectangle.
    let mut layer = Layer::new(b"x");
    layer.mask = vec![0; 10];
    assert!(corrupt_message(&layered(&[layer], &[]).bytes()).contains("mask"));
}

#[test]
fn damaged_resources_end_the_list() {
    let bytes = patched(30 + 4 + 8, &[0x7f, 0, 0, 0]);
    let file = read(&bytes).unwrap();
    assert!(file.resources.is_empty());
    assert_eq!(file.layers.info.records.len(), 2);
}

#[test]
fn a_missing_merged_image_reads_as_none() {
    let mut spec = Spec::rgb();
    spec.image = Vec::new();
    let file = round_trip(&spec.bytes());
    assert!(file.image.bytes.is_empty());
    assert!(decode_image(&file.image, &file.header).is_err());
}
