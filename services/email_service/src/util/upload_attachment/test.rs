use super::*;

fn metadata(filename: &str) -> AttachmentUploadMetadata {
    AttachmentUploadMetadata {
        attachment_db_id: Uuid::nil(),
        email_provider_id: String::new(),
        provider_attachment_id: String::new(),
        mime_type: "application/pdf".to_string(),
        filename: Some(filename.to_string()),
        internal_date_ts: Default::default(),
        message_db_id: Uuid::nil(),
        thread_db_id: Uuid::nil(),
        sender_email: String::new(),
        subject: None,
    }
}

fn check(filename: &str, expected_name: &str) {
    let (name, file_type) = determine_file_metadata(&metadata(filename)).unwrap();

    assert_eq!(name, expected_name, "name for {filename:?}");
    assert_eq!(file_type, "pdf", "file type for {filename:?}");
    assert!(name.graphemes(true).count() <= MAX_DOCUMENT_NAME_GRAPHEMES);
}

#[test]
fn short_names_are_unchanged() {
    check("report.pdf", "report");
    check(&format!("{}.pdf", "a".repeat(200)), &"a".repeat(200));
}

#[test]
fn long_names_keep_the_leading_graphemes_dss_accepts() {
    // Each unit is one grapheme: ASCII, a two-byte char, a combining mark, and a ZWJ sequence.
    for unit in ["a", "\u{e9}", "e\u{301}", "👨‍👩‍👧"] {
        check(&format!("{}.pdf", unit.repeat(250)), &unit.repeat(200));
    }
}
