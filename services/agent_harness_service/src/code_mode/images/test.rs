use super::*;

#[test]
fn a_png_becomes_base64_model_media() {
    let image = png_image(b"\x89PNG\r\n\x1a\nrest").unwrap();
    assert_eq!(image.data, "iVBORw0KGgpyZXN0");
    assert_eq!(
        serde_json::to_value(&image).unwrap(),
        serde_json::json!({"type": "image", "mediaType": "image/png", "data": "iVBORw0KGgpyZXN0"})
    );
}

#[test]
fn other_files_and_oversized_pngs_are_refused() {
    assert!(png_image(b"GIF89a").is_err());
    let mut huge = PNG_SIGNATURE.to_vec();
    huge.resize(3_000_001, 0);
    assert!(png_image(&huge).is_err());
}
