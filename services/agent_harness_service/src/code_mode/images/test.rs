use super::*;

/// A 1x1 RGBA PNG.
fn pixel() -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
    encoder.set_color(png::ColorType::Rgba);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(&[0, 0, 0, 255]).unwrap();
    writer.finish().unwrap();
    bytes
}

#[test]
fn a_png_becomes_base64_model_media() {
    let bytes = pixel();
    let image = png_image(&bytes).unwrap();
    assert_eq!(
        serde_json::to_value(&image).unwrap(),
        serde_json::json!({
            "type": "image",
            "mediaType": "image/png",
            "data": base64::engine::general_purpose::STANDARD.encode(&bytes),
        })
    );
}

#[test]
fn other_files_truncated_pngs_and_oversized_pngs_are_refused() {
    assert!(png_image(b"GIF89a").is_err());
    assert!(png_image(b"\x89PNG\r\n\x1a\nrest").is_err());
    let mut huge = pixel();
    huge.resize(MAX_PNG_BYTES + 1, 0);
    assert!(png_image(&huge).is_err());
}
