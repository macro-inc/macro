use super::*;
use crate::MatchType;

#[test]
fn test_document_search_request_json_serialization() {
    let request = DocumentSearchRequest {
        query: Some("test query".to_string()),
        terms: Some(vec!["term1".to_string(), "term2".to_string()]),
        match_type: MatchType::Exact,
        filters: Some(DocumentFilters {
            file_types: vec!["pdf".to_string(), "docx".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
        }),
        search_on: SearchOn::Content,
        collapse: None,
    };

    let json = serde_json::to_string(&request).expect("Failed to serialize to JSON");
    let expected = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","file_types":["pdf","docx"],"search_on":"content"}"#;

    assert_eq!(json, expected);
}

#[test]
fn test_document_search_request_json_deserialization() {
    let json = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","file_types":["pdf","docx"]}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize from JSON");

    assert_eq!(request.query, Some("test query".to_string()));
    assert_eq!(
        request.terms,
        Some(vec!["term1".to_string(), "term2".to_string()])
    );
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(
        request.filters.as_ref().unwrap().file_types,
        vec!["pdf".to_string(), "docx".to_string()]
    );
}

#[test]
fn test_document_search_request_minimal_json() {
    let json = r#"{"match_type":"partial"}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize minimal JSON");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Partial);
    // With #[serde(flatten)], filters will be Some(DocumentFilters::default()) even when no filter fields are present
    assert_eq!(request.filters, Some(DocumentFilters::default()));
}

#[test]
fn test_document_search_request_all_match_types() {
    let test_cases = vec![
        ("exact", MatchType::Exact),
        ("partial", MatchType::Partial),
        ("query", MatchType::Query),
    ];

    for (json_value, expected_match_type) in test_cases {
        let json = format!(r#"{{"match_type":"{}"}}"#, json_value);
        let request: DocumentSearchRequest = serde_json::from_str(&json)
            .unwrap_or_else(|_| panic!("Failed to deserialize match_type: {}", json_value));

        assert_eq!(request.match_type, expected_match_type);
    }
}

#[test]
fn test_document_search_request_round_trip() {
    let original = DocumentSearchRequest {
        query: Some("search term".to_string()),
        terms: None,
        match_type: MatchType::Query,
        filters: Some(DocumentFilters {
            file_types: vec!["txt".to_string(), "md".to_string()],
            document_ids: vec![],
            project_ids: vec![],
            owners: vec![],
        }),
        search_on: SearchOn::Content,
        collapse: None,
    };

    let json = serde_json::to_string(&original).expect("Failed to serialize");
    let deserialized: DocumentSearchRequest =
        serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(original.query, deserialized.query);
    assert_eq!(original.terms, deserialized.terms);
    assert_eq!(original.match_type, deserialized.match_type);
    assert_eq!(original.filters, deserialized.filters);
}

#[test]
fn test_document_search_request_empty_arrays() {
    let json = r#"{"query":"test","terms":[],"match_type":"exact","file_types":[]}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize empty arrays");

    assert_eq!(request.query, Some("test".to_string()));
    assert_eq!(request.terms, Some(vec![]));
    assert_eq!(request.match_type, MatchType::Exact);
    assert!(request.filters.as_ref().unwrap().file_types.is_empty());
}

#[test]
fn test_document_search_request_with_file_types_only() {
    let json = r#"{"match_type":"partial","file_types":["pdf","docx","txt"]}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize with file_types only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Partial);
    assert_eq!(
        request.filters.as_ref().unwrap().file_types,
        vec!["pdf".to_string(), "docx".to_string(), "txt".to_string()]
    );
}

#[test]
fn test_document_search_request_with_query_and_terms() {
    let json = r#"{"query":"main query","terms":["term1","term2","term3"],"match_type":"query"}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize with query and terms");

    assert_eq!(request.query, Some("main query".to_string()));
    assert_eq!(
        request.terms,
        Some(vec![
            "term1".to_string(),
            "term2".to_string(),
            "term3".to_string()
        ])
    );
    assert_eq!(request.match_type, MatchType::Query);
    assert_eq!(request.filters, Some(DocumentFilters::default()));
}

#[test]
fn test_document_search_request_invalid_match_type() {
    let json = r#"{"match_type":"invalid"}"#;

    let result = serde_json::from_str::<DocumentSearchRequest>(json);
    assert!(
        result.is_err(),
        "Should fail to deserialize invalid match_type"
    );
}

#[test]
fn test_document_search_request_missing_required_field() {
    let json = r#"{"query":"test"}"#;

    let result = serde_json::from_str::<DocumentSearchRequest>(json);
    assert!(
        result.is_err(),
        "Should fail to deserialize without required match_type field"
    );
}

#[test]
fn test_document_search_request_filters_only() {
    let json = r#"{"match_type":"exact","file_types":["pdf"]}"#;

    let request: DocumentSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize filters only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(
        request.filters.as_ref().unwrap().file_types,
        vec!["pdf".to_string()]
    );
}
