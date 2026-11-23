use super::convert_message;
use crate::models::DocumentKeyParts;

#[test]
fn a_tracked_upload_reports_to_its_job() {
    let parts = DocumentKeyParts::from_s3_key("macro%7Cuser%40example.com/doc-1/42.docx").unwrap();

    let message = convert_message(
        Some("upload-job".to_string()),
        "docx-upload",
        &parts,
        "doc-storage",
    );

    assert_eq!(message.job_id, "upload-job");
    assert!(message.notify_job);
    assert_eq!(message.from_bucket, "docx-upload");
    assert_eq!(message.from_key, "macro|user@example.com/doc-1/42.docx");
    assert_eq!(message.to_bucket, "doc-storage");
    assert_eq!(message.to_key, "macro|user@example.com/doc-1/converted.pdf");
}

#[test]
fn an_upload_without_a_job_converts_without_job_updates() {
    let parts = DocumentKeyParts::from_s3_key("macro%7Cuser%40example.com/doc-1/42.docx").unwrap();

    let first = convert_message(None, "docx-upload", &parts, "doc-storage");
    let second = convert_message(None, "docx-upload", &parts, "doc-storage");

    assert!(!first.notify_job);
    assert_ne!(first.job_id, second.job_id);
    assert_eq!(first.to_key, "macro|user@example.com/doc-1/converted.pdf");
}
