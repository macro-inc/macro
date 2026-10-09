use super::*;

const ALL: [Compression; 4] = [
    Compression::Raw,
    Compression::Rle,
    Compression::Zip,
    Compression::ZipPrediction,
];

/// Samples with runs, pairs, and noise.
fn samples(len: usize) -> Vec<u8> {
    let mut state = 0x2545_f491_u32;
    (0..len)
        .map(|i| {
            state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            match (i / 23) % 3 {
                0 => 7,
                1 => (i / 2) as u8,
                _ => (state >> 16) as u8,
            }
        })
        .collect()
}

/// Bytes without runs.
fn noise(len: usize) -> Vec<u8> {
    let mut state = 0x9e37_79b9_u32;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        })
        .collect()
}

fn header(width: u32, height: u32, depth: u16, channels: u16, psb: bool) -> Header {
    Header {
        version: if psb { 2 } else { 1 },
        channels,
        height,
        width,
        depth,
        mode: 3,
    }
}

#[test]
fn rle_packs_rows_as_photoshop_does() {
    let cases: [(&[u8], &[u8]); 7] = [
        (&[5, 5, 5], &[0xfe, 5]),
        (&[1, 2, 3], &[2, 1, 2, 3]),
        // A pair repeats where no literal is pending...
        (&[7, 7, 1, 2], &[0xff, 7, 1, 1, 2]),
        // ...and joins the literal otherwise, at the end of a row too.
        (&[1, 7, 7, 2], &[3, 1, 7, 7, 2]),
        (&[1, 2, 0, 0], &[3, 1, 2, 0, 0]),
        // Rows are packed 128 bytes at a time.
        (&[9; 130], &[0x81, 9, 0xff, 9]),
        (&[1, 2, 3, 3, 3, 3], &[1, 1, 2, 0xfd, 3]),
    ];
    for (row, packed) in cases {
        let width = row.len() as u32;
        let channel = encode_channel(0, row, width, 1, 8, false);
        assert_eq!(channel.compression, Compression::Rle);
        assert_eq!(channel.bytes[..2], (packed.len() as u16).to_be_bytes());
        assert_eq!(&channel.bytes[2..], packed);
        assert_eq!(decode_channel(&channel, width, 1, 8, false).unwrap(), row);
    }
    // Large documents count rows in 32 bits.
    let channel = encode_channel(0, &[5, 5, 5], 3, 1, 8, true);
    assert_eq!(channel.bytes, [0, 0, 0, 2, 0xfe, 5]);
}

#[test]
fn every_compression_round_trips_at_every_depth() {
    for depth in [1, 8, 16, 32] {
        for compression in ALL {
            for psb in [false, true] {
                let (width, height) = (37, 5);
                let data = samples(row_bytes(width, depth) * height as usize);
                let (used, bytes) = encode(&[&data], compression, width, height, depth, psb);
                assert_eq!(used, compression);
                let channel = Channel {
                    id: 0,
                    compression,
                    bytes,
                };
                assert_eq!(
                    decode_channel(&channel, width, height, depth, psb).unwrap(),
                    data,
                    "{compression:?} at {depth} bits"
                );
            }
        }
    }
}

#[test]
fn prediction_differences_neighbors_and_splits_floats_into_byte_planes() {
    let mut eight = vec![10, 12, 11];
    zip::predict(&mut eight, 3, 8);
    assert_eq!(eight, [10, 2, 255]);
    let mut sixteen = vec![1, 0, 1, 2];
    zip::predict(&mut sixteen, 2, 16);
    assert_eq!(sixteen, [1, 0, 0, 2]);
    let floats = [1.0f32.to_be_bytes(), 2.0f32.to_be_bytes()].concat();
    let mut predicted = floats.clone();
    zip::predict(&mut predicted, 2, 32);
    // The first bytes of both samples, then the second bytes, and so on.
    assert_eq!(predicted, [0x3f, 0x01, 0x40, 0x80, 0, 0, 0, 0]);
    zip::unpredict(&mut predicted, 2, 32);
    assert_eq!(predicted, floats);
}

#[test]
fn channels_encode_as_photoshop_does_for_their_depth() {
    let compression = |depth: u16| encode_channel(0, &[1; 16], 2, 2, depth, false).compression;
    assert_eq!(compression(1), Compression::Rle);
    assert_eq!(compression(8), Compression::Rle);
    assert_eq!(compression(16), Compression::ZipPrediction);
    assert_eq!(compression(32), Compression::ZipPrediction);
    let empty = encode_channel(-1, &[], 0, 5, 8, false);
    assert_eq!(empty.id, -1);
    assert_eq!(
        (empty.compression, empty.bytes.len()),
        (Compression::Raw, 0)
    );
    assert!(decode_channel(&empty, 0, 5, 8, false).unwrap().is_empty());
    // Missing samples are zeros.
    let short = encode_channel(0, &[1], 2, 1, 8, false);
    assert_eq!(decode_channel(&short, 2, 1, 8, false).unwrap(), [1, 0]);
}

#[test]
fn merged_images_compress_all_channels_together() {
    let h = header(3, 2, 8, 3, false);
    let planes = vec![vec![1; 6], vec![2; 6], vec![3, 4, 5, 6, 7, 8]];
    let rle = encode_image(&planes, &h, Compression::Rle);
    // Every row's count first, then the rows.
    assert_eq!(&rle.bytes[..12], &[0, 2, 0, 2, 0, 2, 0, 2, 0, 4, 0, 4]);
    assert_eq!(&rle.bytes[12..16], &[0xfe, 1, 0xfe, 1]);
    for psb in [false, true] {
        for depth in [8, 16, 32] {
            let h = header(5, 3, depth, 4, psb);
            let planes: Vec<Vec<u8>> = (0..4)
                .map(|c| samples(row_bytes(5, depth) * 3 + c)[c..].to_vec())
                .collect();
            for compression in ALL {
                let image = encode_image(&planes, &h, compression);
                assert_eq!(image.compression, compression);
                assert_eq!(decode_image(&image, &h).unwrap(), planes);
            }
        }
    }
    // A missing plane is zeros.
    let image = encode_image(&planes[..1], &h, Compression::Raw);
    assert_eq!(decode_image(&image, &h).unwrap()[2], [0; 6]);
}

#[test]
fn rows_too_wide_for_16_bit_counts_are_stored_raw() {
    let h = header(20_000, 1, 32, 1, false);
    let noise = noise(80_000);
    let image = encode_image(std::slice::from_ref(&noise), &h, Compression::Rle);
    assert_eq!(image.compression, Compression::Raw);
    assert_eq!(
        decode_image(&image, &h).unwrap(),
        std::slice::from_ref(&noise)
    );
    let image = encode_image(&[noise], &header(20_000, 1, 32, 1, true), Compression::Rle);
    assert_eq!(image.compression, Compression::Rle);
}

#[test]
fn damaged_rle_rows_decode_as_far_as_they_go() {
    // Counts 2 and 9 (only two bytes left): a run, then a literal of three
    // with one byte.
    let channel = Channel {
        id: 0,
        compression: Compression::Rle,
        bytes: vec![0, 2, 0, 9, 0xfe, 4, 2, 7],
    };
    assert_eq!(
        decode_channel(&channel, 3, 2, 8, false).unwrap(),
        [4, 4, 4, 7, 0, 0]
    );
    // A no-op header, then a run longer than the row.
    let channel = Channel {
        id: 0,
        compression: Compression::Rle,
        bytes: vec![0, 3, 0x80, 0x81, 6],
    };
    assert_eq!(decode_channel(&channel, 3, 1, 8, false).unwrap(), [6, 6, 6]);
}

#[test]
fn damaged_channel_data_is_an_error() {
    let channel = |compression, bytes: &[u8]| Channel {
        id: 0,
        compression,
        bytes: bytes.to_vec(),
    };
    let short_raw = channel(Compression::Raw, &[1, 2, 3]);
    assert!(decode_channel(&short_raw, 2, 2, 8, false).is_err());
    let short_counts = channel(Compression::Rle, &[0, 2]);
    assert!(decode_channel(&short_counts, 2, 2, 8, false).is_err());
    let not_deflate = channel(Compression::Zip, &[1, 2, 3]);
    assert!(decode_channel(&not_deflate, 2, 2, 8, false).is_err());
    let short_deflate = channel(Compression::ZipPrediction, &zip::deflate(&[1, 2, 3]));
    assert!(decode_channel(&short_deflate, 2, 2, 8, false).is_err());
    // Far more pixels than the data could hold.
    let tiny = channel(Compression::Rle, &[0; 64]);
    assert!(decode_channel(&tiny, 30_000, 16, 8, false).is_err());
    assert!(decode_channel(&tiny, 100_000, 100_000, 8, true).is_err());
    assert!(matches!(
        decode_channel(&short_raw, u32::MAX, u32::MAX, 32, true),
        Err(PsdError::TooLarge(_))
    ));
    assert!(matches!(
        decode_channel(&short_raw, 1, 1, 7, false),
        Err(PsdError::Unsupported(_))
    ));
    let h = header(u32::MAX, u32::MAX, 32, 56, true);
    assert!(decode_image(&ImageData::default(), &h).is_err());
}
