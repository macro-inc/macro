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

fn upload_args(sender: &str, recipients: &[&str]) -> AttachmentUploadArgs {
    AttachmentUploadArgs {
        attachment_metadata: AttachmentUploadMetadata {
            sender_email: sender.to_string(),
            subject: Some("Quarterly report".to_string()),
            thread_db_id: Uuid::from_u128(1),
            message_db_id: Uuid::from_u128(2),
            ..metadata("report.pdf")
        },
        recipient_emails: recipients.iter().map(|r| r.to_string()).collect(),
        backfill: false,
        upload_destination: models_email::service::attachment::AttachmentUploadDestination::Dss,
    }
}

fn recipients(property: &EmailAttachmentProperty) -> Vec<String> {
    property
        .recipients
        .iter()
        .flatten()
        .map(|id| id.as_ref().to_string())
        .collect()
}

#[test]
fn invalid_recipients_are_left_out_of_attachment_properties() {
    let property = email_attachment_property(&upload_args(
        "Sender@Example.com",
        &[
            "'quoted@example.com'",
            "Ann@Example.com",
            ",lead@example.com",
        ],
    ));

    assert_eq!(
        property.sender.as_ref().map(|id| id.as_ref()),
        Some("macro|sender@example.com")
    );
    assert_eq!(recipients(&property), ["macro|ann@example.com"]);
    assert_eq!(property.subject.as_deref(), Some("Quarterly report"));
    let source = property.source.expect("source is set");
    assert_eq!(source.entity_id, Uuid::from_u128(1).to_string());
    assert_eq!(source.specific_message_id, Some(Uuid::from_u128(2)));
}

#[test]
fn invalid_sender_keeps_the_other_attachment_properties() {
    let property =
        email_attachment_property(&upload_args("'sender@example.com'", &["ann@example.com"]));

    assert!(property.sender.is_none());
    assert_eq!(recipients(&property), ["macro|ann@example.com"]);
    assert_eq!(property.subject.as_deref(), Some("Quarterly report"));
    assert!(property.source.is_some());
}
