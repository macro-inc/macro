//! Changed files come out as Photoshop would write them.

use super::*;

/// Reads `bytes` as a file and checks the parts a reader relies on line up
/// the way Photoshop lays them out: tagged blocks start on four-byte
/// boundaries of their record, names are padded to four, the layer info
/// length is a multiple of four.
fn check_photoshop_layout(bytes: &[u8]) -> PsdFile {
    let file = read(bytes).unwrap();
    for record in &file.layers.info.records {
        assert_eq!((1 + record.name.len() + record.name_padding) % 4, 0);
        for b in &record.tagged {
            assert_eq!(b.padding, None, "{}", String::from_utf8_lossy(&b.key));
        }
    }
    for b in &file.layers.tagged {
        assert_eq!(b.padding, None, "{}", String::from_utf8_lossy(&b.key));
    }
    if file.layers.info_key.is_none() && !file.layers.info.records.is_empty() {
        assert!(file.layers.info_padding < ESCAPED);
    }
    file
}

/// The layer info length a file stores.
fn layer_info_length(bytes: &[u8], psb: bool) -> u64 {
    let mut r = crate::binary::Reader::new(bytes);
    r.skip(26).unwrap();
    for _ in 0..2 {
        let n = r.u32().unwrap() as usize;
        r.skip(n).unwrap();
    }
    if psb {
        r.u64().unwrap();
        r.u64().unwrap()
    } else {
        r.u32().unwrap();
        u64::from(r.u32().unwrap())
    }
}

#[test]
fn replaced_blocks_get_photoshop_padding() {
    let mut layer = Layer::new(b"x");
    layer.rest = [
        block(b"8BIM", b"luni", false, &[0, 0, 0, 1, 0, 120], &[], 0),
        record_block(b"lyid", &[0, 0, 0, 1]),
    ]
    .concat();
    let doc = block(b"8BIM", b"Txt2", false, &[1], &[0; 9], 0);
    let mut file = read(&layered(&[layer], &doc).bytes()).unwrap();
    let record = &mut file.layers.info.records[0];
    assert!(record.block(b"luni").unwrap().padding.is_some());
    record.set_block(b"luni", luni("xyz")[..10].to_vec());
    record.set_block(b"lsct", vec![0, 0, 0, 1]);
    record.remove_block(b"lyid");
    file.layers.tagged[0].data = vec![1, 2, 3, 4, 5];
    file.layers.tagged[0].padding = None;
    file.layers
        .tagged
        .push(TaggedBlock::new(b"Patt", vec![9; 3]));
    let bytes = write(&file);
    let again = check_photoshop_layout(&bytes);
    let record = &again.layers.info.records[0];
    // Padded to four, the padding counted.
    assert_eq!(record.block(b"luni").unwrap().data, luni("xyz"));
    assert_eq!(record.block(b"lsct").unwrap().data, [0, 0, 0, 1]);
    assert!(record.block(b"lyid").is_none());
    // Padded to four, the padding not counted.
    assert_eq!(again.layers.block(b"Txt2").unwrap().data, [1, 2, 3, 4, 5]);
    assert_eq!(again.layers.block(b"Patt").unwrap().data, [9; 3]);
    let tail = &bytes[bytes.len() - 12 - 2 - 12 - 3 - 1..];
    assert_eq!(&tail[..12], b"8BIMPatt\0\0\0\x03");
}

#[test]
fn new_large_blocks_are_signed_8b64_in_large_documents() {
    let mut file = read(&high_bit(16, true)).unwrap();
    file.layers
        .tagged
        .push(TaggedBlock::new(b"FMsk", vec![0; 12]));
    file.layers
        .tagged
        .push(TaggedBlock::new(b"cinf", vec![1; 5]));
    file.layers.tagged.push(TaggedBlock::new(b"Patt", vec![]));
    file.layers.info.records[0].set_block(b"lnk2", vec![7; 4]);
    let bytes = write(&file);
    let again = check_photoshop_layout(&bytes);
    let signatures: Vec<(&[u8; 4], &[u8; 4])> = again
        .layers
        .tagged
        .iter()
        .map(|b| (&b.key, &b.signature))
        .collect();
    assert_eq!(
        signatures,
        [
            (b"Lr16", b"8B64"),
            (b"LMsk", b"8B64"),
            (b"FMsk", b"8B64"),
            (b"cinf", b"8B64"),
            (b"Patt", b"8BIM"),
        ]
    );
    assert_eq!(again.layers.block(b"cinf").unwrap().data, [1; 5]);
    let lnk2 = again.layers.info.records[0].block(b"lnk2").unwrap();
    assert_eq!((&lnk2.signature, &lnk2.data[..]), (b"8B64", &[7; 4][..]));
}

#[test]
fn renamed_and_new_records_are_padded_to_four() {
    let mut unpadded = Layer::new(b"ab");
    unpadded.name_padding = 0;
    unpadded.rest = record_block(b"lyid", &[0, 0, 0, 1]);
    let mut file = read(&layered(&[unpadded], &[]).bytes()).unwrap();
    assert_eq!(file.layers.info.records[0].name_padding, ESCAPED);
    let mut renamed = file.layers.info.records[0].clone();
    renamed.name = b"renamed".to_vec();
    renamed.name_padding = 0;
    let mut created = renamed.clone();
    created.name = b"new layer".to_vec();
    created.tagged = vec![TaggedBlock::new(b"luni", luni("new layer"))];
    file.layers.info.records.extend([renamed, created]);
    let bytes = write(&file);
    let again = read(&bytes).unwrap();
    let names: Vec<(&[u8], usize)> = again
        .layers
        .info
        .records
        .iter()
        .map(|r| (r.name.as_slice(), r.name_padding))
        .collect();
    // The file's own record keeps its unpadded name; the others follow
    // Photoshop.
    assert_eq!(
        names,
        [(&b"ab"[..], ESCAPED), (b"renamed", 0), (b"new layer", 2)]
    );
    assert_eq!(
        again.layers.info.records[2].block(b"luni").unwrap().data,
        luni("new layer")
    );
}

#[test]
fn changed_layer_info_is_padded_to_four() {
    let info = layer_info(1, &[odd_layer()], false);
    // Written by a tool that pads to two.
    let padding = info.len() % 2;
    let spec = Spec {
        layers: section(&info, padding, false, Some(&[]), &[]),
        ..Spec::rgb()
    };
    let bytes = spec.bytes();
    let mut file = read(&bytes).unwrap();
    for grow in 1..=4 {
        file.layers.info.records[0].channels[1].bytes.push(grow);
        let out = write(&file);
        assert_eq!(layer_info_length(&out, false) % 2, 0);
        let again = read(&out).unwrap();
        assert_eq!(again.layers.info, file.layers.info);
    }
    // Photoshop's files stay on four.
    let mut file = read(&layered(&[Layer::new(b"ab")], &[]).bytes()).unwrap();
    for grow in 1..=4 {
        file.layers.info.records[0].channels[0].bytes.push(grow);
        let out = write(&file);
        assert_eq!(layer_info_length(&out, false) % 4, 0);
        check_photoshop_layout(&out);
    }
}

#[test]
fn new_masks_are_at_least_twenty_bytes() {
    let mut file = read(&layered(&[Layer::new(b"m")], &[]).bytes()).unwrap();
    let record = &mut file.layers.info.records[0];
    record.mask = Some(MaskData {
        rect: [0, 0, 1, 2],
        default_color: 0,
        flags: 0,
        params: None,
        real: None,
        tail: Vec::new(),
    });
    record.channels.push(Channel {
        id: -2,
        compression: Compression::Raw,
        bytes: vec![255, 0],
    });
    let again = check_photoshop_layout(&write(&file));
    // Read back with the two bytes of padding as its tail.
    if let Some(mask) = &mut file.layers.info.records[0].mask {
        mask.tail = vec![0, 0];
    }
    assert_eq!(again.layers.info, file.layers.info);
}

#[test]
fn bytes_after_mask_parameters_are_kept() {
    let mut file = read(&layered(&[Layer::new(b"m")], &[]).bytes()).unwrap();
    let record = &mut file.layers.info.records[0];
    // As ag-psd writes a mask with a density and a feather: two bytes past
    // the parameters.
    record.mask = Some(MaskData {
        rect: [0, 0, 1, 2],
        default_color: 255,
        flags: 0x10,
        params: Some(MaskParams {
            user_density: Some(0),
            user_feather: Some(2.8),
            vector_density: None,
            vector_feather: None,
        }),
        real: None,
        tail: vec![0, 0],
    });
    record.channels.push(Channel {
        id: -2,
        compression: Compression::Raw,
        bytes: vec![255, 0],
    });
    let bytes = write(&file);
    let again = check_photoshop_layout(&bytes);
    assert_eq!(again.layers.info, file.layers.info);
    assert_eq!(write(&again), bytes);
}

#[test]
fn new_files_write_and_read_back() {
    let record = LayerRecord {
        rect: [0, 0, 2, 2],
        channels: (-1..3)
            .map(|id| crate::channels::encode_channel(id, &[id as u8; 4], 2, 2, 8, false))
            .collect(),
        blend: *b"norm",
        opacity: 255,
        clipping: 0,
        flags: 8,
        filler: 0,
        mask: None,
        blend_ranges: Vec::new(),
        name: b"Layer 1".to_vec(),
        tagged: vec![TaggedBlock::new(b"luni", luni("Layer 1"))],
        extra_tail: Vec::new(),
        name_padding: 0,
    };
    let header = Header {
        version: 1,
        channels: 3,
        height: 2,
        width: 2,
        depth: 8,
        mode: 3,
    };
    let planes = vec![vec![1; 4], vec![2; 4], vec![3; 4]];
    let file = PsdFile {
        header,
        color_mode_data: Vec::new(),
        resources: vec![Resource::new(1005, vec![0; 16])],
        layers: LayerSection {
            info: LayerInfo {
                merged_alpha: false,
                records: vec![record],
            },
            global_mask: Some(Vec::new()),
            ..LayerSection::default()
        },
        image: crate::channels::encode_image(&planes, &header, Compression::Rle),
    };
    let bytes = write(&file);
    let again = check_photoshop_layout(&bytes);
    assert_eq!(again.layers.info, file.layers.info);
    assert_eq!(again.image, file.image);
    assert_eq!(write(&again), bytes);
}
