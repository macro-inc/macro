use super::*;
use crate::render::scene::Raster;

#[test]
fn sniffs_formats() {
    assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0, 0]), Format::Png);
    assert_eq!(sniff(&[0xFF, 0xD8, 0xFF]), Format::Jpeg);
    assert_eq!(sniff(b"GIF89a"), Format::Gif);
    assert_eq!(sniff(&[0xD7, 0xCD, 0xC6, 0x9A, 0, 0]), Format::Wmf);
    assert_eq!(sniff(b"hello"), Format::Unknown);
}

#[test]
fn png_round_trip() {
    let mut r = Raster::new(3, 2);
    r.pixels[0..4].copy_from_slice(&[255, 0, 0, 255]);
    r.pixels[4..8].copy_from_slice(&[0, 64, 0, 128]);
    let png = r.to_png();
    let back = decode_raster(&png).unwrap();
    assert_eq!((back.width, back.height), (3, 2));
    assert_eq!(&back.pixels[0..4], &[255, 0, 0, 255]);
    assert!(
        (i32::from(back.pixels[5]) - 64).abs() <= 1 && back.pixels[7] == 128,
        "premultiplied round trip"
    );
}

#[test]
fn decodes_24bit_bmp() {
    // 2x1 bottom-up BMP: blue, red.
    let mut b = Vec::new();
    b.extend_from_slice(b"BM");
    b.extend_from_slice(&(62u32).to_le_bytes());
    b.extend_from_slice(&[0, 0, 0, 0]);
    b.extend_from_slice(&(54u32).to_le_bytes());
    b.extend_from_slice(&(40u32).to_le_bytes());
    b.extend_from_slice(&(2i32).to_le_bytes());
    b.extend_from_slice(&(1i32).to_le_bytes());
    b.extend_from_slice(&(1u16).to_le_bytes());
    b.extend_from_slice(&(24u16).to_le_bytes());
    b.extend_from_slice(&[0; 24]);
    b.extend_from_slice(&[255, 0, 0, 0, 0, 255, 0, 0]);
    let r = decode_raster(&b).unwrap();
    assert_eq!(&r.pixels[0..4], &[0, 0, 255, 255]);
    assert_eq!(&r.pixels[4..8], &[255, 0, 0, 255]);
}

#[test]
fn effects_and_border() {
    let mut r = Raster {
        width: 1,
        height: 1,
        pixels: vec![255, 255, 255, 255],
    };
    apply_effects(
        &mut r,
        &[BlipEffect::ClrChange {
            from: Rgba::WHITE,
            to: Rgba::TRANSPARENT,
        }],
    );
    assert_eq!(r.pixels[3], 0, "white made transparent");
    let mut g = Raster {
        width: 1,
        height: 1,
        pixels: vec![255, 0, 0, 255],
    };
    apply_effects(
        &mut g,
        &[BlipEffect::Grayscale, BlipEffect::AlphaModFix(0.5)],
    );
    assert_eq!(g.pixels[0], g.pixels[1]);
    assert!((i32::from(g.pixels[3]) - 128).abs() <= 1);
    let b = with_border(&Raster {
        width: 1,
        height: 1,
        pixels: vec![1, 2, 3, 4],
    });
    assert_eq!((b.width, b.height), (3, 3));
    assert_eq!(&b.pixels[16..20], &[1, 2, 3, 4]);
    assert_eq!(&b.pixels[0..4], &[0, 0, 0, 0]);
}

#[test]
fn wide_and_split_bit_masks_do_not_overflow() {
    assert_eq!(mask_channel(0xFFFF_FFFF, 0xFFFF_FFFF), 255);
    assert_eq!(mask_channel(0, 0xFFFF_FFFF), 0);
    // A non-contiguous mask decodes approximately instead of panicking.
    let v = mask_channel(0x0000_F00F, 0x0000_F00F);
    assert!(v > 200, "{v}");
    assert_eq!(mask_channel(0x00FF_0000, 0x00FF_0000), 255);
    assert_eq!(mask_channel(0x0080_0000, 0x00FF_0000), 128);
}

#[test]
fn huge_color_counts_read_only_indexable_entries() {
    // A 1 × 1, 8-bit DIB claiming 0xFFFF_FFFF palette entries, with palette
    // entry 0 red and the pixel data given by offset.
    let mut dib = Vec::new();
    dib.extend(40u32.to_le_bytes());
    dib.extend(1i32.to_le_bytes());
    dib.extend(1i32.to_le_bytes());
    dib.extend(1u16.to_le_bytes());
    dib.extend(8u16.to_le_bytes());
    dib.extend(0u32.to_le_bytes()); // BI_RGB
    dib.extend(4u32.to_le_bytes());
    dib.extend([0; 8]);
    dib.extend(u32::MAX.to_le_bytes()); // biClrUsed
    dib.extend(0u32.to_le_bytes());
    dib.extend([0, 0, 255, 0]); // entry 0: red (BGRA)
    let bits_at = dib.len();
    dib.extend([0, 0, 0, 0]); // one index-0 pixel, padded to 4 bytes
    let raster = decode_dib(&dib, Some(bits_at)).unwrap();
    assert_eq!((raster.width, raster.height), (1, 1));
    assert_eq!(&raster.to_straight_rgba()[..3], &[255, 0, 0]);
    // Without a pixel offset, the stored count only pushes the data out of range.
    assert!(decode_dib(&dib, None).is_ok());
}
