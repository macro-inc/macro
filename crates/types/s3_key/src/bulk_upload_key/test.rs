use super::*;

#[test]
fn test_new() {
    let key = BulkUploadStagingKey::new("request-123");
    assert_eq!(key.to_key(), "extract/request-123");
    assert_eq!(key.request_id, "request-123");
}

#[test]
fn test_from_s3_key() {
    let key = BulkUploadStagingKey::from_s3_key("extract/request-123").unwrap();
    assert_eq!(key.request_id, "request-123");
    assert_eq!(key.to_key(), "extract/request-123");
}

#[test]
fn test_display() {
    let key = BulkUploadStagingKey::new("request-123");
    assert_eq!(format!("{key}"), "extract/request-123");
}

#[test]
fn test_invalid_prefix() {
    assert!(BulkUploadStagingKey::from_s3_key("other/request-123").is_err());
}

#[test]
fn test_empty_request_id() {
    assert!(BulkUploadStagingKey::from_s3_key("extract/").is_err());
}
