use super::basic::DocumentBasic;
use macro_user_id::user_id::MacroUserIdStr;

#[test]
fn test_document_basic_serde_roundtrip() {
    let original = DocumentBasic {
        document_id: "doc-123".to_string(),
        document_name: "Test Document".to_string(),
        owner: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        file_type: Some("pdf".to_string()),
        branched_from_id: Some("parent-doc-456".to_string()),
        branched_from_version_id: Some(42),
        document_family_id: Some(100),
        project_id: Some("project-789".to_string()),
        deleted_at: None,
    };

    let serialized = serde_json::to_string(&original).expect("Failed to serialize DocumentBasic");
    let deserialized: DocumentBasic =
        serde_json::from_str(&serialized).expect("Failed to deserialize DocumentBasic");

    assert_eq!(original, deserialized);
}

#[test]
fn test_document_basic_serde_minimal() {
    let original = DocumentBasic {
        document_id: "doc-minimal".to_string(),
        document_name: "Minimal Doc".to_string(),
        owner: MacroUserIdStr::parse_from_str("macro|user@test.com").unwrap(),
        file_type: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    };

    let serialized = serde_json::to_string(&original).expect("Failed to serialize DocumentBasic");
    let deserialized: DocumentBasic =
        serde_json::from_str(&serialized).expect("Failed to deserialize DocumentBasic");

    assert_eq!(original, deserialized);
}

#[test]
fn test_document_basic_serde_with_deleted_at() {
    let deleted_time = chrono::Utc::now();
    let original = DocumentBasic {
        document_id: "doc-deleted".to_string(),
        document_name: "Deleted Doc".to_string(),
        owner: MacroUserIdStr::parse_from_str("macro|deleted@test.com").unwrap(),
        file_type: Some("docx".to_string()),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: Some(deleted_time),
    };

    let serialized = serde_json::to_string(&original).expect("Failed to serialize DocumentBasic");
    let deserialized: DocumentBasic =
        serde_json::from_str(&serialized).expect("Failed to deserialize DocumentBasic");

    assert_eq!(original.document_id, deserialized.document_id);
    assert_eq!(original.document_name, deserialized.document_name);
    assert_eq!(original.owner, deserialized.owner);
    assert_eq!(original.file_type, deserialized.file_type);
    // DateTime serializes to ISO 8601 string, preserving microsecond precision
    assert_eq!(original.deleted_at, deserialized.deleted_at);
}
