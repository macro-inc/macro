use super::*;
use base64::Engine;
use base64::engine::general_purpose;
use image::{GenericImageView, ImageFormat, RgbImage};

/// Encode an in-memory RGB image of the given size to bytes in `format`.
fn encode(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
    let img = RgbImage::from_pixel(width, height, image::Rgb([10, 120, 240]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut bytes, format)
        .expect("encode test image");
    bytes.into_inner()
}

/// Decode the WebP payload back into an image to inspect format and dimensions.
fn decode(image: &Base64Image) -> image::DynamicImage {
    let bytes = general_purpose::STANDARD
        .decode(image.base64_data())
        .expect("valid base64");
    assert_eq!(
        image::guess_format(&bytes).ok(),
        Some(ImageFormat::WebP),
        "output must always be WebP",
    );
    image::load_from_memory(&bytes).expect("decode webp")
}

#[test]
fn png_is_converted_to_webp() {
    let png = encode(64, 64, ImageFormat::Png);
    let result = Base64Image::downscale_and_reencode(png).expect("normalize");
    // `decode` asserts the payload is WebP.
    let img = decode(&result);
    assert_eq!(img.dimensions(), (64, 64), "small image keeps its size");
}

#[test]
fn oversized_image_is_downscaled_to_1080_longest_side() {
    let png = encode(3000, 1500, ImageFormat::Png);
    let result = Base64Image::downscale_and_reencode(png).expect("normalize");
    let (width, height) = decode(&result).dimensions();
    assert_eq!(width, MAX_DIMENSION, "longest side capped at 1080");
    assert!(height <= MAX_DIMENSION);
    // Aspect ratio (2:1) is preserved.
    assert_eq!(height, MAX_DIMENSION / 2);
}

#[test]
fn small_webp_is_kept_without_reencoding() {
    let webp = encode(32, 32, ImageFormat::WebP);
    let expected = general_purpose::STANDARD.encode(&webp);
    let result = Base64Image::downscale_and_reencode(webp).expect("normalize");
    assert_eq!(
        result.base64_data(),
        expected,
        "an already-correct WebP is passed through verbatim",
    );
}

#[test]
fn data_uri_string_is_normalized_to_webp() {
    let png = encode(48, 48, ImageFormat::Png);
    let data_uri = format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(&png)
    );
    let result = Base64Image::try_from_string(&data_uri).expect("normalize data uri");
    decode(&result); // asserts WebP output
}

#[test]
fn non_data_uri_string_is_rejected() {
    assert!(Base64Image::try_from_string("https://example.com/cat.png").is_err());
}
