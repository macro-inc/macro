use super::*;

fn bytes(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

/// 1005 data: resolution in fixed 16.16 with display units, twice.
fn resolution_data(ppi: u32, unit: u16, size_unit: u16) -> Vec<u8> {
    let half = bytes(&[
        &(ppi << 16).to_be_bytes(),
        &unit.to_be_bytes(),
        &size_unit.to_be_bytes(),
    ]);
    bytes(&[&half, &half])
}

#[test]
fn resolution_keeps_its_display_units() {
    let mut resources = vec![
        Resource::new(1000, vec![1]),
        Resource::new(RESOLUTION, resolution_data(300, 2, 2)),
    ];
    assert_eq!(resolution(&resources), Some(300.0));
    set_resolution(&mut resources, 150.0);
    assert_eq!(resources[1].data, resolution_data(150, 2, 2));
    assert_eq!(resolution(&resources), Some(150.0));
    let mut none = Vec::new();
    assert_eq!(resolution(&none), None);
    set_resolution(&mut none, 72.0);
    assert_eq!(none, [Resource::new(RESOLUTION, resolution_data(72, 1, 1))]);
    assert_eq!(resolution(&[Resource::new(RESOLUTION, vec![0; 3])]), None);
}

#[test]
fn guides_keep_the_grid() {
    let grid = bytes(&[&400u32.to_be_bytes(), &500u32.to_be_bytes()]);
    let data = bytes(&[
        &1u32.to_be_bytes(),
        &grid,
        &2u32.to_be_bytes(),
        &17_006i32.to_be_bytes(),
        &[0],
        &3_200i32.to_be_bytes(),
        &[1],
    ]);
    let mut resources = vec![Resource::new(GUIDES, data.clone())];
    assert_eq!(
        guides(&resources),
        [
            Guide {
                vertical: true,
                position: 531.4375,
            },
            Guide {
                vertical: false,
                position: 100.0,
            },
        ]
    );
    let moved = [Guide {
        vertical: false,
        position: -2.5,
    }];
    set_guides(&mut resources, &moved);
    assert_eq!(&resources[0].data[4..12], grid);
    assert_eq!(guides(&resources), moved);
    // Removing every guide keeps the resource and its grid.
    set_guides(&mut resources, &[]);
    assert!(guides(&resources).is_empty());
    assert_eq!(&resources[0].data[4..12], grid);
    let mut none = Vec::new();
    set_guides(&mut none, &[]);
    assert!(none.is_empty());
    set_guides(&mut none, &moved);
    assert_eq!(&none[0].data[4..12], &[0, 0, 2, 64, 0, 0, 2, 64]);
    // Damaged guide lists stop where they end.
    let cut = Resource::new(GUIDES, data[..23].to_vec());
    assert_eq!(guides(&[cut]).len(), 1);
}

#[test]
fn global_light_version_info_profile_and_transparency() {
    let resources = vec![
        Resource::new(GLOBAL_ANGLE, 120i32.to_be_bytes().to_vec()),
        Resource::new(GLOBAL_ALTITUDE, 30i32.to_be_bytes().to_vec()),
        Resource::new(VERSION_INFO, vec![0, 0, 0, 1, 0, 0, 0, 0, 0]),
        Resource::new(ICC_PROFILE, vec![1, 2, 3]),
        Resource::new(TRANSPARENCY_INDEX, vec![0, 5]),
    ];
    assert_eq!(global_light(&resources), (Some(120), Some(30)));
    assert_eq!(global_light(&[]), (None, None));
    assert_eq!(has_real_merged_data(&resources), Some(false));
    assert_eq!(
        has_real_merged_data(&[Resource::new(VERSION_INFO, vec![0, 0, 0, 1, 1])]),
        Some(true)
    );
    assert_eq!(has_real_merged_data(&[]), None);
    assert_eq!(icc_profile(&resources), Some(&[1, 2, 3][..]));
    assert_eq!(transparency_index(&resources), Some(5));
    assert_eq!(transparency_index(&[]), None);
}

/// A solid JPEG.
fn jpeg(rgb: [u8; 3]) -> Vec<u8> {
    let rgba: Vec<u8> = std::iter::repeat_n([rgb[0], rgb[1], rgb[2], 255], 64)
        .flatten()
        .collect();
    fig_engine::export::jpeg::encode(&rgba, 8, 8, 95)
}

fn center(jpeg: &[u8]) -> [u8; 3] {
    let image = fig_engine::images::decode(jpeg).unwrap();
    let px = &image.data()[(4 * 8 + 4) * 4..];
    [px[0], px[1], px[2]]
}

#[test]
fn thumbnails_read_and_write() {
    let red = jpeg([255, 0, 0]);
    let small = Thumbnail {
        width: 8,
        height: 8,
        jpeg: red.clone(),
    };
    let mut resources = vec![
        Resource::new(OLD_THUMBNAIL, vec![1]),
        Resource::new(1000, vec![]),
    ];
    set_thumbnail(&mut resources, &small);
    // The old form is replaced in place.
    assert_eq!(resources.len(), 2);
    assert_eq!(resources[0].id, THUMBNAIL);
    let header = &resources[0].data[..THUMBNAIL_HEADER];
    let expected = bytes(&[
        &1u32.to_be_bytes(),
        &8u32.to_be_bytes(),
        &8u32.to_be_bytes(),
        &24u32.to_be_bytes(),
        &192u32.to_be_bytes(),
        &(red.len() as u32).to_be_bytes(),
        &24u16.to_be_bytes(),
        &1u16.to_be_bytes(),
    ]);
    assert_eq!(header, expected);
    assert_eq!(thumbnail(&resources), Some(small));
    // Photoshop 4 thumbnails are stored blue-green-red.
    let mut old = resources[0].clone();
    old.id = OLD_THUMBNAIL;
    old.data = bytes(&[header, &jpeg([0, 0, 255])]);
    let converted = thumbnail(&[old]).unwrap();
    assert_eq!((converted.width, converted.height), (8, 8));
    let [r, g, b] = center(&converted.jpeg);
    assert!(r > 240 && g < 16 && b < 16, "{r} {g} {b}");
    // Raw thumbnails (format 0) are not read.
    let mut raw = resources[0].clone();
    raw.data[3] = 0;
    assert_eq!(thumbnail(&[raw]), None);
    assert_eq!(thumbnail(&[Resource::new(THUMBNAIL, vec![0; 10])]), None);
}
