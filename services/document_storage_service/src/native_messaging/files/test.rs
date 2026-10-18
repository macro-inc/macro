use super::*;

#[test]
fn declared_images_cannot_smuggle_html_or_arbitrary_bytes() {
    let file = MediaBytes {
        filename: "photo.jpg".into(),
        mime_type: "image/jpeg".into(),
        bytes: b"<html><script>alert(1)</script>".to_vec(),
    };
    assert!(received_type(&file).is_err());
    let file = MediaBytes {
        filename: "real.png".into(),
        mime_type: "image/png".into(),
        bytes: b"\x89PNG\r\n\x1a\nrest".to_vec(),
    };
    assert_eq!(received_type(&file).unwrap(), FileType::Png);
}

#[test]
fn unsupported_active_formats_and_empty_files_are_explicit_errors() {
    for (mime, bytes) in [
        ("image/svg+xml", b"<svg/>".as_slice()),
        ("application/pdf", b"".as_slice()),
        ("text/plain", b"embedded\0nul".as_slice()),
    ] {
        assert!(
            received_type(&MediaBytes {
                filename: "untrusted".into(),
                mime_type: mime.into(),
                bytes: bytes.to_vec()
            })
            .is_err()
        );
    }
}

#[test]
fn customer_file_names_always_fit_a_document_name() {
    assert_eq!(document_name("   .pdf"), "attachment");
    assert_eq!(document_name("invoice.final.pdf"), "invoice.final");
    let long = format!("{}.pdf", "é".repeat(MAX_DOCUMENT_NAME_GRAPHEMES + 10));
    assert_eq!(
        document_name(&long).graphemes(true).count(),
        MAX_DOCUMENT_NAME_GRAPHEMES
    );
}
