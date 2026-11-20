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
        sender_email: None,
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

fn name_and_type(filename: &str, mime_type: &str) -> (String, String) {
    let mut attachment = metadata(filename);
    attachment.mime_type = mime_type.to_string();
    determine_file_metadata(&attachment).unwrap()
}

#[test]
fn a_known_extension_decides_unless_the_mime_type_names_another_macro_type() {
    let wrong: Vec<_> = [
        ("notes.txt", "text/plain", ("notes", "txt")),
        ("notes.md", "text/plain", ("notes", "md")),
        ("data.csv", "application/vnd.ms-excel", ("data", "csv")),
        ("Contract.docx", "application/zip", ("Contract", "docx")),
        ("report.pdf ", "application/octet-stream", ("report", "pdf")),
        (
            "Contract.docx",
            "application/octet-stream",
            ("Contract", "docx"),
        ),
        ("scan.pdf", "application/octet-stream", ("scan", "pdf")),
        ("photos.zip", "application/octet-stream", ("photos", "zip")),
        ("REPORT.PDF", "application/octet-stream", ("REPORT", "pdf")),
        ("IMG_0001.HEIC", "image/heif", ("IMG_0001", "heic")),
        ("minutes.doc", "application/msword", ("minutes", "doc")),
        ("page.html", "text/html", ("page", "html")),
    ]
    .into_iter()
    .filter_map(|(filename, mime_type, (name, file_type))| {
        let got = name_and_type(filename, mime_type);
        (got != (name.to_string(), file_type.to_string()))
            .then(|| format!("{filename} sent as {mime_type} gave {got:?}"))
    })
    .collect();

    assert!(wrong.is_empty(), "{wrong:#?}");
}

#[test]
fn a_specific_mime_type_naming_another_format_decides_the_file_type() {
    assert_eq!(
        name_and_type("report.xlsx", "application/pdf"),
        ("report".to_string(), "pdf".to_string())
    );
}

#[test]
fn a_dotted_name_keeps_everything_before_its_extension() {
    assert_eq!(
        name_and_type("Q3.final.pdf", "application/pdf"),
        ("Q3.final".to_string(), "pdf".to_string())
    );
}

#[test]
fn without_a_known_extension_the_mime_type_decides_and_the_name_is_whole() {
    assert_eq!(
        name_and_type("statement", "application/pdf"),
        ("statement".to_string(), "pdf".to_string())
    );
    assert_eq!(
        name_and_type("statement.final", "application/pdf"),
        ("statement.final".to_string(), "pdf".to_string())
    );
}

#[test]
fn a_name_with_neither_a_known_extension_nor_a_known_mime_type_uses_its_last_extension() {
    assert_eq!(
        name_and_type("archive.qqq", "application/x-unknown-to-mime-guess"),
        ("archive.qqq".to_string(), "qqq".to_string())
    );
}

fn upload_args(sender: &str, recipients: &[&str]) -> AttachmentUploadArgs {
    AttachmentUploadArgs {
        attachment_metadata: AttachmentUploadMetadata {
            sender_email: Some(sender.to_string()),
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

#[tokio::test]
async fn an_empty_document_is_uploaded_with_its_length() {
    use wiremock::matchers::{header, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // S3 answers a PUT without a Content-Length with 411 Length Required.
    let storage = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(header("content-length", "0"))
        .respond_with(ResponseTemplate::new(200))
        .with_priority(1)
        .mount(&storage)
        .await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(411))
        .with_priority(2)
        .mount(&storage)
        .await;
    let (_, base64_hash) = calculate_hashes(&[]);

    let uploaded = upload_data_to_presigned_url(
        &format!("{}/document", storage.uri()),
        "application/pdf",
        Vec::new(),
        &base64_hash,
    )
    .await;

    assert!(uploaded.is_ok(), "{uploaded:?}");
}

/// A presigned upload URL as DSS signs it, with its credentials in the query.
const SIGNED_QUERY: &str = "X-Amz-Credential=access-key-id&X-Amz-Security-Token=session-token-value&X-Amz-Signature=signature-value";

fn assert_no_url_secrets(error: &UploadAttachmentError) {
    let logged = format!("{error} {error:?}");
    for secret in [
        "X-Amz",
        "access-key-id",
        "session-token-value",
        "signature-value",
    ] {
        assert!(!logged.contains(secret), "{secret} in {logged}");
    }
}

#[tokio::test]
async fn a_refused_upload_keeps_only_the_status_and_s3_error_code() {
    use wiremock::matchers::method;
    use wiremock::{Mock, MockServer, ResponseTemplate};

    // S3 echoes the canonical request, signed query included, on a bad signature.
    let storage = MockServer::start().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(403).set_body_string(format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message><CanonicalRequest>PUT
/document
{SIGNED_QUERY}</CanonicalRequest></Error>"#
        )))
        .mount(&storage)
        .await;
    let (_, base64_hash) = calculate_hashes(b"document");

    let error = upload_data_to_presigned_url(
        &format!("{}/document?{SIGNED_QUERY}", storage.uri()),
        "application/pdf",
        b"document".to_vec(),
        &base64_hash,
    )
    .await
    .unwrap_err();

    assert_no_url_secrets(&error);
    assert!(
        matches!(
            &error,
            UploadAttachmentError::PresignedUrlRefused { status, code }
                if *status == reqwest::StatusCode::FORBIDDEN
                    && code.as_deref() == Some("SignatureDoesNotMatch")
        ),
        "{error:?}"
    );
}

#[tokio::test]
async fn an_unreachable_upload_url_is_not_logged() {
    let (_, base64_hash) = calculate_hashes(b"document");

    // Nothing listens on this port, so the upload never gets an answer.
    let error = upload_data_to_presigned_url(
        &format!("http://127.0.0.1:9/document?{SIGNED_QUERY}"),
        "application/pdf",
        b"document".to_vec(),
        &base64_hash,
    )
    .await
    .unwrap_err();

    assert_no_url_secrets(&error);
    assert!(
        matches!(error, UploadAttachmentError::PresignedUrlUnreachable(_)),
        "{error:?}"
    );
}
