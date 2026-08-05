use super::*;

const LEGACY_DOCUMENT_FILTER: &str = r#"
    AND (
        a.mime_type IN (
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/html',
            'text/plain',
            'pdf'
        )
        OR (
            a.mime_type = 'application/octet-stream' 
            AND UPPER(SUBSTRING(a.filename FROM '\.([^.]+)$')) IN ('PDF', 'DOC', 'DOCX', 'TXT', 'HTML')
        )
    )
"#;

const LEGACY_MEDIA_FILTER: &str = r#"
    (a.mime_type LIKE 'image/%' OR a.mime_type LIKE 'video/%')
"#;

#[test]
fn generated_sql_matches_legacy_filters() {
    assert_eq!(ATTACHMENT_MIME_TYPE_FILTERS, LEGACY_DOCUMENT_FILTER);
    assert_eq!(ATTACHMENT_MIME_TYPE_FILTERS_WITH_MEDIA, LEGACY_MEDIA_FILTER);
}

#[test]
fn every_document_mime_type_is_allowed() {
    for mime_type in DOCUMENT_MIME_TYPES {
        assert!(attachment_is_document(mime_type, Some("attachment")));
    }
}

#[test]
fn every_octet_stream_document_extension_is_allowed_case_insensitively() {
    for extension in OCTET_STREAM_DOCUMENT_EXTENSIONS {
        let lowercase_filename = format!("attachment.{}", extension.to_ascii_lowercase());
        let mixed_case_extension = extension
            .chars()
            .enumerate()
            .map(|(index, character)| {
                if index % 2 == 0 {
                    character.to_ascii_lowercase()
                } else {
                    character
                }
            })
            .collect::<String>();
        let mixed_case_filename = format!("attachment.{mixed_case_extension}");

        assert!(attachment_is_document(
            "application/octet-stream",
            Some(&lowercase_filename)
        ));
        assert!(attachment_is_document(
            "application/octet-stream",
            Some(&mixed_case_filename)
        ));
    }
}

#[test]
fn octet_stream_uses_the_final_filename_extension() {
    assert!(attachment_is_document(
        "application/octet-stream",
        Some("quarterly.report.final.DoCx")
    ));
    assert!(!attachment_is_document(
        "application/octet-stream",
        Some("report.pdf.exe")
    ));
}

#[test]
fn document_filter_rejects_missing_or_unsupported_metadata() {
    assert!(!attachment_is_document("application/pdf", None));
    assert!(!attachment_is_document("application/octet-stream", None));
    assert!(!attachment_is_document(
        "application/octet-stream",
        Some("attachment")
    ));
    assert!(!attachment_is_document(
        "application/octet-stream",
        Some("attachment.")
    ));
    assert!(!attachment_is_document(
        "application/octet-stream",
        Some("attachment.csv")
    ));
    assert!(!attachment_is_document("application/zip", Some("file.pdf")));
    assert!(!attachment_is_document("text/css", Some("styles.css")));
}

#[test]
fn document_mime_type_matching_is_case_sensitive() {
    assert!(!attachment_is_document(
        "Application/Pdf",
        Some("attachment.pdf")
    ));
    assert!(!attachment_is_document("PDF", Some("attachment.pdf")));
    assert!(!attachment_is_document(
        "Application/Octet-Stream",
        Some("attachment.pdf")
    ));
}

#[test]
fn every_media_mime_prefix_is_allowed() {
    for prefix in MEDIA_MIME_PREFIXES {
        assert!(attachment_is_media(&format!("{prefix}example")));
    }
}

#[test]
fn media_filter_is_case_sensitive_and_rejects_other_types() {
    assert!(!attachment_is_media("Image/png"));
    assert!(!attachment_is_media("VIDEO/mp4"));
    assert!(!attachment_is_media("application/pdf"));
    assert!(!attachment_is_media("text/plain"));
}
