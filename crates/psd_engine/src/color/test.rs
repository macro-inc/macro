use super::*;

fn u16s(values: &[u16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_be_bytes()).collect()
}

fn f32s(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_be_bytes()).collect()
}

/// One pixel of a mode at a depth, opaque.
fn pixel(mode: ColorMode, depth: u16, color: &[&[u8]]) -> [u8; 3] {
    let rgba = to_rgba(mode, depth, 1, 1, color, None, &[]);
    assert_eq!(rgba[3], 255);
    [rgba[0], rgba[1], rgba[2]]
}

#[test]
fn rgb_converts_at_every_depth() {
    let rgba = to_rgba(
        ColorMode::Rgb,
        8,
        2,
        1,
        &[&[1, 2], &[3, 4], &[5, 6]],
        Some(&[7, 8]),
        &[],
    );
    assert_eq!(rgba, [1, 3, 5, 7, 2, 4, 6, 8]);
    let wide = [u16s(&[0, 0x8080]), u16s(&[257, 65535]), u16s(&[0x7f7f, 1])];
    let wide: Vec<&[u8]> = wide.iter().map(Vec::as_slice).collect();
    let rgba = to_rgba(
        ColorMode::Rgb,
        16,
        2,
        1,
        &wide,
        Some(&u16s(&[65535, 32768])),
        &[],
    );
    assert_eq!(rgba, [0, 1, 127, 255, 128, 255, 0, 128]);
    let floats = [f32s(&[0.0, 0.5]), f32s(&[1.0, 0.18]), f32s(&[2.0, -1.0])];
    let floats: Vec<&[u8]> = floats.iter().map(Vec::as_slice).collect();
    let rgba = to_rgba(
        ColorMode::Rgb,
        32,
        2,
        1,
        &floats,
        Some(&f32s(&[0.5, 1.5])),
        &[],
    );
    // Linear light through the sRGB curve; alpha is coverage.
    assert_eq!(rgba, [0, 255, 255, 128, 188, 118, 0, 255]);
}

#[test]
fn short_or_missing_planes_read_as_zero() {
    let rgba = to_rgba(ColorMode::Rgb, 8, 2, 1, &[&[9], &[], &[]], Some(&[]), &[]);
    assert_eq!(rgba, [9, 0, 0, 0, 0, 0, 0, 0]);
    let rgba = to_rgba(ColorMode::Cmyk, 16, 1, 1, &[], None, &[]);
    assert_eq!(rgba, [0, 0, 0, 255]);
    assert!(to_rgba(ColorMode::Rgb, 8, 0, 3, &[], None, &[]).is_empty());
}

#[test]
fn cmyk_is_stored_inverted() {
    assert_eq!(
        pixel(ColorMode::Cmyk, 8, &[&[255], &[255], &[255], &[255]]),
        [255; 3]
    );
    assert_eq!(
        pixel(ColorMode::Cmyk, 8, &[&[0], &[255], &[255], &[255]]),
        [0, 255, 255]
    );
    assert_eq!(
        pixel(ColorMode::Cmyk, 8, &[&[255], &[255], &[255], &[0]]),
        [0; 3]
    );
    let half = u16s(&[32896]);
    assert_eq!(
        pixel(
            ColorMode::Cmyk,
            16,
            &[&half, &u16s(&[65535]), &half, &u16s(&[65535])]
        ),
        [128, 255, 128]
    );
}

#[test]
fn lab_converts_through_d50() {
    assert_eq!(
        pixel(ColorMode::Lab, 8, &[&[255], &[128], &[128]]),
        [255; 3]
    );
    assert_eq!(pixel(ColorMode::Lab, 8, &[&[0], &[128], &[128]]), [0; 3]);
    let [r, g, b] = pixel(ColorMode::Lab, 8, &[&[128], &[128], &[128]]);
    assert!(r == g && g == b && (118..=120).contains(&r), "{r} {g} {b}");
    // sRGB red: L* 53.2, a* 80.1, b* 67.2.
    let [r, g, b] = pixel(ColorMode::Lab, 8, &[&[136], &[208], &[195]]);
    assert!(r >= 250 && g <= 12 && b <= 12, "{r} {g} {b}");
    // At 16 bits a* and b* are centered on 32768.
    let neutral = u16s(&[32768]);
    assert_eq!(
        pixel(ColorMode::Lab, 16, &[&u16s(&[65535]), &neutral, &neutral]),
        [255; 3]
    );
}

#[test]
fn indexed_bitmap_and_gray_modes() {
    let mut palette = vec![0; 768];
    palette[1] = 10;
    palette[257] = 20;
    palette[513] = 30;
    let indexed = |index: u8, palette: &[u8]| {
        to_rgba(ColorMode::Indexed, 8, 1, 1, &[&[index]], None, palette)
    };
    assert_eq!(indexed(1, &palette), [10, 20, 30, 255]);
    assert_eq!(indexed(2, &palette), [0, 0, 0, 255]);
    // Missing palette entries are black.
    assert_eq!(indexed(1, &[]), [0, 0, 0, 255]);
    let bits = to_rgba(
        ColorMode::Bitmap,
        1,
        3,
        2,
        &[&[0b1010_0000, 0b0100_0000]],
        None,
        &[],
    );
    let gray: Vec<u8> = bits.chunks_exact(4).map(|p| p[0]).collect();
    assert_eq!(gray, [0, 255, 0, 255, 0, 255]);
    for mode in [
        ColorMode::Grayscale,
        ColorMode::Duotone,
        ColorMode::Multichannel,
    ] {
        assert_eq!(pixel(mode, 8, &[&[77]]), [77; 3]);
        assert_eq!(pixel(mode, 16, &[&u16s(&[65535])]), [255; 3]);
    }
}

#[test]
fn gray_samples_of_masks_and_alpha() {
    assert_eq!(to_gray(8, 2, 1, &[3, 4]), [3, 4]);
    assert_eq!(to_gray(8, 3, 1, &[3]), [3, 0, 0]);
    assert_eq!(to_gray(16, 2, 1, &u16s(&[257, 65535])), [1, 255]);
    // Coverage, without a curve.
    assert_eq!(to_gray(32, 3, 1, &f32s(&[0.5, 1.0, -2.0])), [128, 255, 0]);
    assert_eq!(to_gray(1, 2, 1, &[0b1000_0000]), [0, 255]);
}

#[test]
fn rgba_round_trips_through_file_samples() {
    let rgba: Vec<u8> = (0..=255u8).flat_map(|v| [v, 255 - v, v / 2, v]).collect();
    for depth in [8, 16, 32] {
        let planes = from_rgba(ColorMode::Rgb, depth, 16, 16, &rgba);
        assert_eq!(planes.len(), 4);
        let color: Vec<&[u8]> = planes[..3].iter().map(Vec::as_slice).collect();
        let back = to_rgba(ColorMode::Rgb, depth, 16, 16, &color, Some(&planes[3]), &[]);
        assert_eq!(back, rgba, "{depth} bits");
    }
    assert_eq!(
        from_rgba(ColorMode::Rgb, 16, 1, 1, &[1, 2, 3, 4]),
        [u16s(&[257]), u16s(&[514]), u16s(&[771]), u16s(&[1028])]
    );
    assert_eq!(
        from_rgba(ColorMode::Rgb, 32, 1, 1, &[255, 0, 0, 51])[3],
        f32s(&[0.2])
    );
}

#[test]
fn grayscale_files_get_luma() {
    let planes = from_rgba(
        ColorMode::Grayscale,
        8,
        3,
        1,
        &[255, 0, 0, 255, 0, 255, 0, 128, 9, 9, 9, 0],
    );
    assert_eq!(planes, [vec![76, 150, 9], vec![255, 128, 0]]);
    let bitmap = from_rgba(
        ColorMode::Bitmap,
        1,
        3,
        1,
        &[0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255],
    );
    assert_eq!(bitmap[0], [0b1010_0000]);
}

#[test]
fn gray_round_trips_through_file_samples() {
    let gray: Vec<u8> = (0..=255).collect();
    for depth in [8, 16, 32] {
        let samples = from_gray(depth, 16, 16, &gray);
        assert_eq!(samples.len(), 256 * usize::from(depth / 8));
        assert_eq!(to_gray(depth, 16, 16, &samples), gray, "{depth} bits");
    }
    assert_eq!(from_gray(32, 1, 1, &[51]), f32s(&[0.2]));
    let bits = from_gray(1, 9, 1, &[0, 255, 0, 255, 0, 255, 0, 255, 0]);
    assert_eq!(bits, [0b1010_1010, 0b1000_0000]);
    assert_eq!(to_gray(1, 9, 1, &bits), [0, 255, 0, 255, 0, 255, 0, 255, 0]);
}
