use super::*;

#[test]
fn test_new() {
    let key = StaticFileKey::new("abc-123");
    assert_eq!(key.to_key(), "file/abc-123");
    assert_eq!(key.file_id, "abc-123");
}

#[test]
fn test_from_s3_key() {
    let key = StaticFileKey::from_s3_key("file/abc-123").unwrap();
    assert_eq!(key.file_id, "abc-123");
    assert_eq!(key.to_key(), "file/abc-123");
}

#[test]
fn test_display() {
    let key = StaticFileKey::new("abc-123");
    assert_eq!(format!("{key}"), "file/abc-123");
}

#[test]
fn test_invalid_prefix() {
    assert!(StaticFileKey::from_s3_key("other/abc-123").is_err());
}

#[test]
fn test_empty_file_id() {
    assert!(StaticFileKey::from_s3_key("file/").is_err());
}
