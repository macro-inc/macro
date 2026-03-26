use super::*;

#[test]
fn test_versioned_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("user123/doc456/789").unwrap();
    assert_eq!(
        key,
        DocumentKey::Versioned {
            user_id: "user123".to_string(),
            document_id: "doc456".to_string(),
            version_id: 789,
        }
    );
    assert_eq!(key.to_key(), "user123/doc456/789");
}

#[test]
fn test_converted_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("user123/doc456/converted.pdf").unwrap();
    assert_eq!(
        key,
        DocumentKey::Converted {
            user_id: "user123".to_string(),
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "user123/doc456/converted.pdf");
}

#[test]
fn test_url_encoded_user_id() {
    let key = DocumentKey::from_s3_key("user%20123/doc456/789").unwrap();
    assert_eq!(
        key,
        DocumentKey::Versioned {
            user_id: "user 123".to_string(),
            document_id: "doc456".to_string(),
            version_id: 789,
        }
    );
}

#[test]
fn test_invalid_key_format() {
    assert!(DocumentKey::from_s3_key("only/two").is_err());
    assert!(DocumentKey::from_s3_key("too/many/segments/here").is_err());
}

#[test]
fn test_invalid_version_id() {
    assert!(DocumentKey::from_s3_key("user123/doc456/not_a_number").is_err());
    assert!(DocumentKey::from_s3_key("user123/doc456/abc.pdf").is_err());
}
