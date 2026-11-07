use super::*;
use build::{GLOBAL_MASK, Layer, Out, Spec, block, layer_info, resource, section};

mod build;
mod corpus;
mod damaged;
mod edits;

/// `luni` data as Photoshop writes it: the name's UTF-16 units after their
/// count, zero-padded to four bytes.
fn luni(name: &str) -> Vec<u8> {
    let mut out = Out::default();
    out.u32(name.encode_utf16().count() as u32);
    for unit in name.encode_utf16() {
        out.u16(unit);
    }
    let pad = pad4(out.0.len());
    out.bytes(&vec![0; pad]);
    out.0
}

/// A Photoshop record-level block (length counts the padding to four).
fn record_block(key: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let padded = [data, &vec![0; pad4(data.len())]].concat();
    block(b"8BIM", key, false, &padded, &[], 0)
}

/// A Photoshop document-level block (padded to four after the length).
fn doc_block(key: &[u8; 4], data: &[u8], large: bool) -> Vec<u8> {
    let signature = if large { b"8B64" } else { b"8BIM" };
    block(signature, key, large, data, &vec![0; pad4(data.len())], 0)
}

/// An RGB file with `layers` (bottom first) and Photoshop's layout.
fn layered(layers: &[Layer], doc_blocks: &[u8]) -> Spec {
    let info = layer_info(layers.len() as i16, layers, false);
    Spec {
        layers: section(&info, pad4(info.len()), false, Some(&[]), doc_blocks),
        ..Spec::rgb()
    }
}

/// A layer whose layer info, alone, is one byte past a multiple of four.
fn odd_layer() -> Layer {
    let mut layer = Layer::new(b"ab");
    layer.channels[1].1.push(9);
    assert_eq!(layer_info(1, &[layer.clone()], false).len() % 4, 1);
    layer
}

fn round_trip(bytes: &[u8]) -> PsdFile {
    let file = read(bytes).unwrap();
    assert_eq!(write(&file), bytes, "written back differently");
    file
}

#[test]
fn reads_a_file_without_layers() {
    let resolution = [0, 72, 0, 0, 0, 1, 0, 1, 0, 72, 0, 0, 0, 1, 0, 1];
    let spec = Spec {
        resources: [
            resource(1005, b"", &resolution),
            resource(1039, b"icc", &[1, 2, 3]),
        ]
        .concat(),
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert_eq!(
        file.header,
        Header {
            version: 1,
            channels: 3,
            height: 2,
            width: 2,
            depth: 8,
            mode: 3,
        }
    );
    assert!(!file.header.is_psb());
    assert!(file.layers.is_empty());
    assert_eq!(file.resources.len(), 2);
    assert_eq!(file.resource(1005).unwrap().data, resolution);
    assert_eq!(file.resource(1039).unwrap().name, b"icc");
    assert_eq!(file.resource(1039).unwrap().data, [1, 2, 3]);
    assert_eq!(
        file.image,
        ImageData {
            compression: Compression::Raw,
            bytes: vec![10; 12],
        }
    );
}

#[test]
fn reads_layer_records_channels_and_blocks() {
    let mut top = Layer::new(b"Top");
    top.blend = *b"mul ";
    top.opacity = 128;
    top.clipping = 1;
    top.flags = 0x0a;
    top.filler = 7;
    top.rect = [-1, -2, 0, 0];
    top.rest = [
        record_block(b"luni", &luni("Top")),
        record_block(b"lyid", &[0, 0, 0, 2]),
    ]
    .concat();
    top.channels[1].1 = vec![0, 1, 0, 2, 1, 7];
    let bottom = Layer::new(b"Background");
    let spec = layered(&[bottom, top], &doc_block(b"Patt", &[], false));
    let file = round_trip(&spec.bytes());
    let records = &file.layers.info.records;
    assert_eq!(records.len(), 2);
    assert!(!file.layers.info.merged_alpha);
    assert_eq!(file.layers.global_mask, Some(Vec::new()));
    assert_eq!(file.layers.tagged.len(), 1);
    assert_eq!(&file.layers.tagged[0].key, b"Patt");
    assert_eq!(file.layers.tagged[0].padding, None);
    let top = &records[1];
    assert_eq!(top.name, b"Top");
    assert_eq!(top.name_padding, 0);
    assert_eq!(&top.blend, b"mul ");
    assert_eq!(
        (top.opacity, top.clipping, top.flags, top.filler),
        (128, 1, 0x0a, 7)
    );
    assert_eq!(top.rect(), IRect::new(-2, -1, 2, 1));
    assert_eq!(top.blend_ranges, [0, 0, 255, 255, 0, 0, 255, 255]);
    assert_eq!(top.mask, None);
    assert_eq!(top.block(b"luni").unwrap().data, luni("Top"));
    assert_eq!(top.block(b"lyid").unwrap().data, [0, 0, 0, 2]);
    assert!(top.tagged.iter().all(|b| b.padding.is_none()));
    assert!(top.extra_tail.is_empty());
    let ids: Vec<i16> = top.channels.iter().map(|c| c.id).collect();
    assert_eq!(ids, [-1, 0, 1, 2]);
    assert_eq!(top.channel(0).unwrap().compression, Compression::Rle);
    assert_eq!(top.channel(0).unwrap().bytes, [0, 2, 1, 7]);
    assert_eq!(top.channel(1).unwrap().compression, Compression::Raw);
    assert_eq!(top.channel(1).unwrap().bytes, [3, 4]);
    assert_eq!(records[0].name, b"Background");
    assert_eq!(records[0].name_padding, 1);
}

#[test]
fn large_documents_widen_lengths() {
    let mut layer = Layer::new(b"Layer 1");
    layer.rest = record_block(b"luni", &luni("Layer 1"));
    let info = layer_info(1, &[layer], true);
    let blocks = [
        doc_block(b"Patt", &[], false),
        // Photoshop CS6 signs some 64-bit blocks `8BIM`.
        block(b"8BIM", b"lnk2", true, &[1, 2, 3, 4], &[], 0),
        doc_block(b"FMsk", &[0; 12], true),
        doc_block(b"cinf", &[9; 6], true),
    ]
    .concat();
    let spec = Spec {
        psb: true,
        layers: section(&info, pad4(info.len()), true, Some(&[]), &blocks),
        // RLE with 32-bit row counts: two rows of each of three channels.
        image: [&[0, 1][..], &[0, 0, 0, 2].repeat(6), &[0xff, 9].repeat(6)].concat(),
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert!(file.header.is_psb());
    let keys: Vec<&[u8; 4]> = file.layers.tagged.iter().map(|b| &b.key).collect();
    assert_eq!(keys, [b"Patt", b"lnk2", b"FMsk", b"cinf"]);
    let lnk2 = file.layers.block(b"lnk2").unwrap();
    assert_eq!(lnk2.data, [1, 2, 3, 4]);
    // Kept as it was, rather than re-signed `8B64` as a new block would be.
    assert_eq!(lnk2.padding, Some(Vec::new()));
    assert_eq!(file.layers.block(b"FMsk").unwrap().padding, None);
    assert_eq!(file.layers.block(b"cinf").unwrap().data, [9; 6]);
    let record = &file.layers.info.records[0];
    assert_eq!(record.block(b"luni").unwrap().data, luni("Layer 1"));
    assert_eq!(record.channel(2).unwrap().bytes, [5, 6]);
    assert_eq!(file.image.compression, Compression::Rle);
}

/// A 16-bit file as Photoshop writes it: no layers in the section, all of
/// them in an `Lr16` block (unpadded inside, padded to four outside).
fn high_bit(depth: u16, psb: bool) -> Vec<u8> {
    let key = if depth == 16 { b"Lr16" } else { b"Lr32" };
    let samples = 2 * usize::from(depth / 8);
    let mut layer = Layer::new(b"L");
    layer.channels = vec![
        (-1, [&[0, 0][..], &vec![255; samples]].concat()),
        (0, vec![0, 1, 0, 3, 1, 1, 2]),
    ];
    layer.rest = record_block(b"luni", &luni("L"));
    let info = layer_info(1, &[layer], psb);
    assert_eq!(info.len() % 2, 1);
    let layers = if psb {
        doc_block(key, &info, true)
    } else {
        block(b"8BIM", key, false, &info, &vec![0; pad4(info.len())], 0)
    };
    let blocks = [layers, doc_block(b"LMsk", &[0; 14], psb)].concat();
    Spec {
        psb,
        depth,
        channels: 1,
        mode: 1,
        layers: section(&[], 0, psb, Some(&[]), &blocks),
        image: [&[0, 0][..], &vec![9; 4 * usize::from(depth / 8)]].concat(),
        ..Spec::rgb()
    }
    .bytes()
}

#[test]
fn high_bit_layers_come_from_their_block() {
    for (depth, psb) in [(16, false), (16, true), (32, false), (32, true)] {
        let key = if depth == 16 { *b"Lr16" } else { *b"Lr32" };
        let bytes = high_bit(depth, psb);
        let mut file = round_trip(&bytes);
        assert_eq!(file.layers.info_key, Some(key));
        assert_eq!(file.layers.info_padding, 0);
        assert_eq!(file.layers.info.records.len(), 1);
        assert_eq!(file.layers.info.records[0].name, b"L");
        let marker = file.layers.block(&key).unwrap();
        assert!(marker.data.is_empty());
        assert_eq!(marker.padding, None);
        // A changed layer list goes back into the block.
        let copy = file.layers.info.records[0].clone();
        file.layers.info.records.push(copy);
        let again = read(&write(&file)).unwrap();
        assert_eq!(again.layers.info_key, Some(key));
        assert_eq!(again.layers.info.records.len(), 2);
        assert_eq!(again.layers.tagged.len(), 2);
        assert_eq!(again.layers.info, file.layers.info);
    }
}

#[test]
fn layer_info_blocks_that_do_not_parse_stay_blocks() {
    let blocks = doc_block(b"Lr32", &[0, 5, 1], false);
    let spec = Spec {
        depth: 32,
        layers: section(&[], 0, false, Some(&[]), &blocks),
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert_eq!(file.layers.info_key, None);
    assert_eq!(file.layers.block(b"Lr32").unwrap().data, [0, 5, 1]);
}

#[test]
fn groups_are_records_with_section_blocks() {
    let mut end = Layer::new(b"</Layer group>");
    end.rect = [0; 4];
    end.channels = vec![
        (-1, vec![0, 0]),
        (0, vec![0, 0]),
        (1, vec![0, 0]),
        (2, vec![0, 0]),
    ];
    end.flags = 0x18;
    end.rest = record_block(b"lsct", &[0, 0, 0, 3]);
    let mut group = Layer::new(b"Group 1");
    group.rect = [0; 4];
    group.channels = end.channels.clone();
    group.blend = *b"pass";
    group.flags = 0x18;
    group.rest = [
        record_block(b"luni", &luni("Group 1")),
        record_block(b"lsct", &[&[0, 0, 0, 1][..], b"8BIM", b"pass"].concat()),
    ]
    .concat();
    let file = round_trip(&layered(&[end, Layer::new(b"inside"), group], &[]).bytes());
    let records = &file.layers.info.records;
    let kinds: Vec<&[u8]> = records
        .iter()
        .map(|r| r.block(b"lsct").map_or(&[][..], |b| &b.data[..4]))
        .collect();
    assert_eq!(kinds, [&[0, 0, 0, 3][..], &[], &[0, 0, 0, 1]]);
    assert!(records[0].rect().is_empty() && records[2].rect().is_empty());
    assert!(
        records[2]
            .channels
            .iter()
            .all(|c| c.bytes.is_empty() && c.compression == Compression::Raw)
    );
    assert_eq!(&records[2].blend, b"pass");
}

#[test]
fn a_negative_layer_count_marks_merged_transparency() {
    let info = layer_info(-1, &[Layer::new(b"a")], false);
    let spec = Spec {
        channels: 4,
        layers: section(&info, pad4(info.len()), false, Some(&GLOBAL_MASK), &[]),
        image: [&[0, 0][..], &[10; 16]].concat(),
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert!(file.layers.info.merged_alpha);
    assert_eq!(file.layers.global_mask.as_deref(), Some(&GLOBAL_MASK[..]));
}

/// Mask data: the rectangle, default color, and flags, then `rest`.
fn mask_bytes(flags: u8, rest: &[u8]) -> Vec<u8> {
    let mut out = Out::default();
    out.i32(1)
        .i32(2)
        .i32(3)
        .i32(4)
        .u8(255)
        .u8(flags)
        .bytes(rest);
    out.0
}

#[test]
fn mask_data_comes_in_three_shapes() {
    let real = [3u8, 0, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8];
    let params_bytes = [
        15u8, 200, 64, 4, 0, 0, 0, 0, 0, 0, 100, 63, 240, 0, 0, 0, 0, 0, 0,
    ];
    let params = MaskParams {
        user_density: Some(200),
        user_feather: Some(2.5),
        vector_density: Some(100),
        vector_feather: Some(1.0),
    };
    let real_mask = RealMask {
        flags: 3,
        default_color: 0,
        rect: [5, 6, 7, 8],
    };
    let cases = [
        // A lone mask: 18 bytes and two of padding.
        (mask_bytes(2, &[0, 0]), false, None, None),
        // With the real user mask (and its channel): 36 bytes.
        (mask_bytes(0, &real), true, Some(real_mask), None),
        // Parameters as long as a real mask, but no real-mask channel.
        (mask_bytes(0x10, &params_bytes), false, None, Some(params)),
        // Both: the real mask first.
        (
            mask_bytes(0x10, &[&real[..], &params_bytes].concat()),
            true,
            Some(real_mask),
            Some(params),
        ),
        // A single parameter: no padding past 20 bytes.
        (
            mask_bytes(0x10, &[1, 9]),
            false,
            None,
            Some(MaskParams {
                user_density: Some(9),
                ..MaskParams::default()
            }),
        ),
    ];
    for (bytes, real_channel, real, params) in cases {
        let mut layer = Layer::new(b"m");
        layer.mask = bytes;
        layer.channels.push((-2, vec![0, 0, 1]));
        if real_channel {
            layer.channels.push((-3, vec![0, 0, 2]));
        }
        let file = round_trip(&layered(&[layer], &[]).bytes());
        let mask = file.layers.info.records[0].mask.clone().unwrap();
        assert_eq!(mask.rect, [1, 2, 3, 4]);
        assert_eq!(mask.default_color, 255);
        assert_eq!(mask.real, real);
        assert_eq!(mask.params, params);
    }
}

#[test]
fn names_padded_otherwise_write_back_as_they_were() {
    // (name, padding in the file, what `name_padding` holds)
    for (name, padding, kept) in [
        (&b"ab"[..], 1, 1),
        (b"ab", 0, 4),
        (b"abcd", 1, 5),
        (b"abc", 4, 8),
        (b"", 3, 3),
    ] {
        let mut layer = Layer::new(name);
        layer.name_padding = padding;
        layer.rest = record_block(b"lyid", &[0, 0, 0, 1]);
        let file = round_trip(&layered(&[layer], &[]).bytes());
        let record = &file.layers.info.records[0];
        assert_eq!(record.name, name);
        assert_eq!(record.name_padding, kept);
        assert_eq!(record.tagged.len(), 1);
    }
}

#[test]
fn block_padding_other_writers_used_is_kept() {
    let mut layer = Layer::new(b"x");
    layer.rest = [
        // An odd length, unpadded (the next signature follows at once).
        block(b"8BIM", b"lnsr", false, &[1, 2, 3], &[], 0),
        // Padding to two after the length, as some writers do.
        block(b"8BIM", b"lyid", false, &[1, 2], &[0, 0], 0),
        // Padding counted to two only.
        block(b"8BIM", b"clbl", false, &[1, 0], &[], 0),
        // Stray bytes before the next block.
        block(b"8BIM", b"infx", false, &[1, 2, 3, 4], &[0, 7], 0),
        record_block(b"knko", &[0]),
    ]
    .concat();
    let doc = [
        doc_block(b"Patt", &[1, 2, 3, 4, 5], false),
        // Zeros between blocks.
        block(b"8BIM", b"Txt2", false, &[1], &[0; 9], 0),
        // Padding counted in the length, as ag-psd writes.
        block(b"8BIM", b"FMsk", false, &[1, 2], &[0, 0], 2),
    ]
    .concat();
    let file = round_trip(&layered(&[layer], &doc).bytes());
    let record = &file.layers.info.records[0];
    let paddings: Vec<Option<Vec<u8>>> = record.tagged.iter().map(|b| b.padding.clone()).collect();
    assert_eq!(
        paddings,
        [
            Some(vec![]),
            Some(vec![0, 0]),
            Some(vec![]),
            Some(vec![0, 7]),
            None
        ]
    );
    assert_eq!(record.block(b"lnsr").unwrap().data, [1, 2, 3]);
    let doc_paddings: Vec<Option<Vec<u8>>> = file
        .layers
        .tagged
        .iter()
        .map(|b| b.padding.clone())
        .collect();
    assert_eq!(doc_paddings, [None, Some(vec![0; 9]), None]);
    assert_eq!(file.layers.block(b"FMsk").unwrap().data, [1, 2, 0, 0]);
}

#[test]
fn lengths_that_run_into_the_next_block_are_realigned() {
    let mut layer = Layer::new(b"x");
    layer.rest = [
        // Counts two bytes of padding it never wrote.
        block(b"8BIM", b"lnsr", false, &[1, 2], &[], 2),
        record_block(b"lyid", &[0, 0, 0, 9]),
    ]
    .concat();
    let file = read(&layered(&[layer], &[]).bytes()).unwrap();
    let record = &file.layers.info.records[0];
    assert_eq!(record.block(b"lnsr").unwrap().data, [1, 2]);
    assert_eq!(record.block(b"lyid").unwrap().data, [0, 0, 0, 9]);
}

#[test]
fn bytes_that_are_not_blocks_are_kept() {
    let mut layer = Layer::new(b"x");
    layer.rest = [record_block(b"lyid", &[0, 0, 0, 1]), vec![1, 2, 3]].concat();
    let doc = [doc_block(b"Patt", &[], false), b"junk".to_vec()].concat();
    let file = round_trip(&layered(&[layer], &doc).bytes());
    assert_eq!(file.layers.info.records[0].extra_tail, [1, 2, 3]);
    assert_eq!(file.layers.tail, b"junk");
}

#[test]
fn layer_info_padded_otherwise_writes_back_as_it_was() {
    let info = layer_info(1, &[odd_layer()], false);
    let to_two = info.len() % 2;
    let cases = [
        // Photoshop: to four.
        (pad4(info.len()), Some(&[][..]), pad4(info.len())),
        // To two only.
        (to_two, Some(&[]), to_two + 4),
        // None at all, nothing after it (SAI).
        (0, None, 4),
        // More than needed.
        (pad4(info.len()) + 4, Some(&[]), pad4(info.len()) + 8),
    ];
    for (padding, global_mask, kept) in cases {
        let spec = Spec {
            layers: section(&info, padding, false, global_mask, &[]),
            ..Spec::rgb()
        };
        let file = round_trip(&spec.bytes());
        assert_eq!(file.layers.info_padding, kept);
        assert_eq!(file.layers.global_mask.is_some(), global_mask.is_some());
    }
}

#[test]
fn empty_layer_info_with_a_count_writes_back() {
    let spec = Spec {
        layers: section(&[0, 0], 2, false, Some(&[]), &[]),
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert!(file.layers.info.records.is_empty());
}

#[test]
fn resources_keep_names_signatures_and_odd_lengths() {
    let mut odd = resource(1033, b"", &[1, 2, 3]);
    odd[..4].copy_from_slice(b"MeSa");
    let resources = [
        odd,
        resource(1039, b"x", &[]),
        resource(4000, b"name", &[7; 5]),
    ]
    .concat();
    let spec = Spec {
        resources,
        ..Spec::rgb()
    };
    let file = round_trip(&spec.bytes());
    assert_eq!(&file.resources[0].signature, b"MeSa");
    assert_eq!(file.resources[0].data, [1, 2, 3]);
    assert_eq!(file.resources[1].name, b"x");
    assert_eq!(file.resources[2].data, [7; 5]);
}

#[test]
fn channels_without_data_read_as_empty() {
    let mut layer = Layer::new(b"group end");
    layer.rect = [0; 4];
    layer.channels = vec![(-1, vec![0, 0]), (0, vec![0, 1])];
    let file = round_trip(&layered(&[layer], &[]).bytes());
    let record = &file.layers.info.records[0];
    assert!(record.rect().is_empty());
    assert_eq!(record.channels[0].compression, Compression::Raw);
    assert!(record.channels[0].bytes.is_empty());
    assert_eq!(record.channels[1].compression, Compression::Rle);
}

#[test]
fn reversed_or_huge_rectangles_stay_in_range() {
    let mut record = read(&layered(&[Layer::new(b"a")], &[]).bytes())
        .unwrap()
        .layers
        .info
        .records
        .remove(0);
    record.rect = [10, 10, 0, 0];
    assert!(record.rect().is_empty());
    record.rect = [i32::MIN, i32::MIN, i32::MAX, i32::MAX];
    let rect = record.rect();
    assert_eq!((rect.x, rect.y), (i32::MIN, i32::MIN));
    assert!(rect.w > 0 && rect.h > 0);
}
