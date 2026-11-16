use super::*;
fn attachment(mime_type: Option<&str>, filename: Option<&str>) -> Attachment {
    Attachment {
        db_id: Uuid::new_v4(),
        provider_id: None,
        data_url: None,
        reference_url: None,
        filename: filename.map(str::to_string),
        mime_type: mime_type.map(str::to_string),
        size_bytes: None,
        sfs_id: None,
        content_id: None,
    }
}
fn assert_attachment_eligibility(attachments: &[Attachment], documents: bool, media: bool) {
    assert_eq!(
        attachment_upload_eligibility(attachments),
        AttachmentUploadEligibility { documents, media }
    );
}
#[test]
fn no_attachments_are_ineligible_for_upload() {
    assert_attachment_eligibility(&[], false, false);
}

#[test]
fn inline_image_only_is_media_eligible() {
    let mut inline_image = attachment(Some("image/png"), Some("signature.png"));
    inline_image.content_id = Some("signature-image".to_string());

    assert_attachment_eligibility(&[inline_image], false, true);
}

#[test]
fn unsupported_and_text_only_parts_are_ineligible_for_upload() {
    let attachments = [
        attachment(Some("application/json"), Some("metadata.json")),
        attachment(Some("text/css"), Some("styles.css")),
    ];

    assert_attachment_eligibility(&attachments, false, false);
}

#[test]
fn document_only_is_document_eligible() {
    let attachments = [attachment(Some("application/pdf"), Some("report.pdf"))];

    assert_attachment_eligibility(&attachments, true, false);
}

#[test]
fn media_only_is_media_eligible() {
    let attachments = [attachment(Some("video/mp4"), Some("recording.mp4"))];

    assert_attachment_eligibility(&attachments, false, true);
}

#[test]
fn mixed_document_and_media_are_both_eligible() {
    let attachments = [
        attachment(Some("application/msword"), Some("report.doc")),
        attachment(Some("image/jpeg"), Some("photo.jpg")),
    ];

    assert_attachment_eligibility(&attachments, true, true);
}

#[test]
fn octet_stream_requires_a_valid_document_extension() {
    let valid = [attachment(
        Some("application/octet-stream"),
        Some("report.final.DoCx"),
    )];
    let invalid = [attachment(
        Some("application/octet-stream"),
        Some("report.pdf.exe"),
    )];

    assert_attachment_eligibility(&valid, true, false);
    assert_attachment_eligibility(&invalid, false, false);
}

#[test]
fn missing_mime_type_matches_neither_category() {
    let attachments = [attachment(None, Some("report.pdf"))];

    assert_attachment_eligibility(&attachments, false, false);
}

#[test]
fn missing_filename_excludes_documents_but_not_media() {
    let document = [attachment(Some("application/pdf"), None)];
    let media = [attachment(Some("image/png"), None)];

    assert_attachment_eligibility(&document, false, false);
    assert_attachment_eligibility(&media, false, true);
}
