use super::*;
use image::{ImageBuffer, Rgb, RgbImage};

fn encode_rgb_jpeg(w: u32, h: u32) -> Vec<u8> {
    let img: RgbImage = ImageBuffer::from_pixel(w, h, Rgb([128, 64, 200]));
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 95);
    encoder
        .encode(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    bytes
}

fn encode_rgb_png(w: u32, h: u32) -> Vec<u8> {
    let img: RgbImage = ImageBuffer::from_pixel(w, h, Rgb([128, 64, 200]));
    let mut bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .unwrap();
    bytes
}

#[test]
fn downscales_large_jpeg() {
    let bytes = encode_rgb_jpeg(4000, 3000);
    let result = try_downscale(&bytes, ImageFormat::Jpeg).unwrap();
    let DownscaleOutcome::Replaced { bytes: out } = result else {
        panic!("expected replacement");
    };

    let decoded = image::load_from_memory_with_format(&out, ImageFormat::Jpeg).unwrap();
    assert!(decoded.width().max(decoded.height()) <= MAX_DIMENSION);
    assert!(out.len() < bytes.len());
}

#[test]
fn downscales_large_png() {
    let bytes = encode_rgb_png(2000, 500);
    let result = try_downscale(&bytes, ImageFormat::Png).unwrap();
    let DownscaleOutcome::Replaced { bytes: out } = result else {
        panic!("expected replacement");
    };

    let decoded = image::load_from_memory_with_format(&out, ImageFormat::Png).unwrap();
    assert_eq!(decoded.width().max(decoded.height()), MAX_DIMENSION);
}

#[test]
fn skips_small_image() {
    let bytes = encode_rgb_jpeg(800, 600);
    let result = try_downscale(&bytes, ImageFormat::Jpeg).unwrap();
    assert!(matches!(result, DownscaleOutcome::Skipped));
}

#[test]
fn skips_image_at_boundary() {
    let bytes = encode_rgb_jpeg(MAX_DIMENSION, 500);
    let result = try_downscale(&bytes, ImageFormat::Jpeg).unwrap();
    assert!(matches!(result, DownscaleOutcome::Skipped));
}

#[test]
fn skips_oversized_input_bytes() {
    let bytes = vec![0u8; MAX_INPUT_BYTES + 1];
    let result = try_downscale(&bytes, ImageFormat::Jpeg).unwrap();
    assert!(matches!(result, DownscaleOutcome::Skipped));
}

#[test]
fn preserves_aspect_ratio() {
    let bytes = encode_rgb_jpeg(4000, 2000);
    let DownscaleOutcome::Replaced { bytes: out } =
        try_downscale(&bytes, ImageFormat::Jpeg).unwrap()
    else {
        panic!("expected replacement");
    };
    let decoded = image::load_from_memory_with_format(&out, ImageFormat::Jpeg).unwrap();
    assert_eq!(decoded.width(), MAX_DIMENSION);
    assert_eq!(decoded.height(), MAX_DIMENSION / 2);
}

#[test]
fn content_type_mapping() {
    assert_eq!(
        format_from_content_type("image/jpeg"),
        Some(ImageFormat::Jpeg)
    );
    assert_eq!(
        format_from_content_type("image/png"),
        Some(ImageFormat::Png)
    );
    assert_eq!(
        format_from_content_type("image/gif"),
        Some(ImageFormat::Gif)
    );
    assert_eq!(
        format_from_content_type("image/webp"),
        Some(ImageFormat::WebP)
    );
    assert_eq!(format_from_content_type("application/pdf"), None);
}
