use super::*;

#[test]
fn stored_names_drop_signed_query_strings() {
    assert_eq!(
        file_name(
            "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/diagram.png?X-Amz-Signature=x"
        ),
        "diagram.png"
    );
    assert_eq!(file_name("https://example.com/"), FALLBACK_FILE_NAME);
    assert_eq!(
        file_name("https://example.com/download"),
        FALLBACK_FILE_NAME
    );
}

#[test]
fn dimensions_come_from_the_image_header() {
    // A 3×2 PNG.
    let mut png = Vec::new();
    image::RgbaImage::new(3, 2)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    assert_eq!(dimensions(&png), (3, 2));
    assert_eq!(dimensions(b"not an image"), (0, 0));
}
