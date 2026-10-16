use super::*;
use crate::file::{Header, ImageData, LayerInfo, LayerRecord, LayerSection};

fn record(rect: [i32; 4]) -> LayerRecord {
    LayerRecord {
        rect,
        channels: Vec::new(),
        blend: *b"norm",
        opacity: 255,
        clipping: 0,
        flags: 0,
        filler: 0,
        mask: None,
        blend_ranges: Vec::new(),
        name: b"Layer".to_vec(),
        tagged: Vec::new(),
        extra_tail: Vec::new(),
        name_padding: 0,
    }
}

fn file(records: Vec<LayerRecord>) -> PsdFile {
    PsdFile {
        header: Header {
            version: 1,
            channels: 3,
            height: 100,
            width: 200,
            depth: 8,
            mode: 3,
        },
        color_mode_data: Vec::new(),
        resources: Vec::new(),
        layers: LayerSection {
            info: LayerInfo {
                merged_alpha: false,
                records,
            },
            ..LayerSection::default()
        },
        image: ImageData::default(),
    }
}

#[test]
fn pixel_bytes_count_layers_and_the_merged_image() {
    let f = file(vec![record([0, 0, 10, 20]), record([5, 5, 5, 5])]);
    assert_eq!(pixel_bytes(&f), 200 * 100 * 4 + 10 * 20 * 4);
}

#[test]
fn files_beyond_the_budget_are_refused() {
    let f = file(vec![record([0, 0, 1000, 1000])]);
    let options = OpenOptions { pixel_budget: 1000 };
    assert!(matches!(from_file(f, options), Err(PsdError::TooLarge(_))));
}

#[test]
fn unknown_color_modes_are_refused() {
    let mut f = file(Vec::new());
    f.header.mode = 5;
    assert!(matches!(
        from_file(f, OpenOptions::default()),
        Err(PsdError::Unsupported(_))
    ));
}

#[test]
fn dividers_read_from_section_blocks() {
    let mut r = record([0; 4]);
    r.set_block(
        b"lsct",
        blocks::divider_data(Divider::Group { open: false }, BlendMode::Multiply),
    );
    assert_eq!(
        blocks::divider(&r),
        (Divider::Group { open: false }, Some(BlendMode::Multiply))
    );
    r.set_block(
        b"lsct",
        blocks::divider_data(Divider::End, BlendMode::Normal),
    );
    assert_eq!(blocks::divider(&r).0, Divider::End);
}

#[test]
fn small_blocks_round_trip() {
    let mut r = record([0; 4]);
    r.set_block(b"luni", blocks::unicode_name_data("Café ✓"));
    assert_eq!(blocks::name(&r), "Café ✓");
    r.set_block(
        b"lspf",
        blocks::locks_data(&crate::model::Locks {
            transparency: true,
            pixels: false,
            position: true,
            artboard: false,
        }),
    );
    let locks = blocks::locks(&r);
    assert!(locks.transparency && locks.position && !locks.pixels);
    r.set_block(b"lclr", blocks::color_tag_data(4));
    assert_eq!(blocks::color_tag(&r), 4);
    r.set_block(b"iOpa", blocks::byte_setting_data(128));
    assert_eq!(blocks::byte_setting(&r, b"iOpa"), Some(128));
    let ranges = crate::model::BlendRanges {
        channels: vec![([10, 20, 230, 240], [0, 0, 255, 255])],
    };
    r.blend_ranges = blocks::blend_ranges_data(&ranges, 3);
    assert_eq!(r.blend_ranges.len(), 32);
    assert_eq!(
        blocks::blend_ranges(&r).unwrap().channels[0],
        ranges.channels[0]
    );
}
