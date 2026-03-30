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
        DocumentKey::ConvertedPdf {
            user_id: "user123".to_string(),
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "user123/doc456/converted.pdf");
    assert!(key.is_converted_pdf());
    assert!(!key.is_temp());
}

#[test]
fn test_temp_docx_key_from_s3_key() {
    let key = DocumentKey::from_s3_key("temp_files/doc456.docx").unwrap();
    assert_eq!(
        key,
        DocumentKey::TempDocx {
            document_id: "doc456".to_string(),
        }
    );
    assert_eq!(key.to_key(), "temp_files/doc456.docx");
    assert!(key.is_temp());
    assert!(!key.is_converted_pdf());
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
    assert!(DocumentKey::from_s3_key("only-one").is_err());
    assert!(DocumentKey::from_s3_key("too/many/segments/here").is_err());
}

#[test]
fn test_bom_part_key() {
    let key = DocumentKey::from_s3_key(
        "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678",
    )
    .unwrap();
    assert_eq!(
        key,
        DocumentKey::BomPart {
            sha: "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678".to_string(),
        }
    );
    assert!(key.is_bom_part());
    assert_eq!(key.document_id(), None);
    assert_eq!(key.version_id_string(), None);
    assert_eq!(
        key.to_key(),
        "7b5ce90c96ec3c24d8764ba75076bc0c2c5256b2d44e71cf9a8f001ea21ed678"
    );
}

#[test]
fn test_invalid_version_id() {
    assert!(DocumentKey::from_s3_key("user123/doc456/not_a_number").is_err());
    assert!(DocumentKey::from_s3_key("user123/doc456/abc.pdf").is_err());
}

#[test]
fn test_invalid_temp_file_extension() {
    assert!(DocumentKey::from_s3_key("temp_files/doc456.pdf").is_err());
}

#[test]
fn test_document_id_accessor() {
    let versioned = DocumentKey::from_s3_key("user/doc1/1").unwrap();
    assert_eq!(versioned.document_id(), Some("doc1"));

    let converted = DocumentKey::from_s3_key("user/doc2/converted.pdf").unwrap();
    assert_eq!(converted.document_id(), Some("doc2"));

    let temp = DocumentKey::from_s3_key("temp_files/doc3.docx").unwrap();
    assert_eq!(temp.document_id(), Some("doc3"));
}

#[test]
fn test_version_id_string() {
    let versioned = DocumentKey::from_s3_key("user/doc/42").unwrap();
    assert_eq!(versioned.version_id_string(), Some("42".to_string()));

    let converted = DocumentKey::from_s3_key("user/doc/converted.pdf").unwrap();
    assert_eq!(converted.version_id_string(), Some("converted".to_string()));

    let temp = DocumentKey::from_s3_key("temp_files/doc.docx").unwrap();
    assert_eq!(temp.version_id_string(), None);
}

#[test]
fn test_build_cloud_storage_bucket_document_key() {
    let key = build_cloud_storage_bucket_document_key("owner", "document-id", 1);
    assert_eq!(key, "owner/document-id/1");
}

#[test]
fn test_build_docx_to_pdf_converted_document_key() {
    let key = build_docx_to_pdf_converted_document_key("owner", "document-id");
    assert_eq!(key, "owner/document-id/converted.pdf");
}

#[test]
fn test_build_docx_staging_bucket_document_key() {
    let key = build_docx_staging_bucket_document_key("owner", "document-id", 1);
    assert_eq!(key, "owner/document-id/1.docx");
}

#[test]
fn test_build_temp_docx_key() {
    let key = build_temp_docx_key("document-id");
    assert_eq!(key, "temp_files/document-id.docx");
}
