use super::*;
use crate::MatchType;

#[test]
fn test_channel_search_request_json_serialization() {
    let request = ChannelSearchRequest {
        query: Some("test query".to_string()),
        terms: Some(vec!["term1".to_string(), "term2".to_string()]),
        match_type: MatchType::Exact,
        filters: Some(ChannelFilters {
            org_id: Some(12345),
            thread_ids: vec!["thread1".to_string(), "thread2".to_string()],
            mentions: vec!["@user1".to_string(), "@user2".to_string()],
            ..Default::default()
        }),
        search_on: SearchOn::Content,
        collapse: None,
    };

    let json = serde_json::to_string(&request).expect("Failed to serialize to JSON");
    let expected = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","thread_ids":["thread1","thread2"],"mentions":["@user1","@user2"],"org_id":12345,"search_on":"content"}"#;

    assert_eq!(json, expected);
}

#[test]
fn test_channel_search_request_json_deserialization() {
    let json = r#"{"query":"test query","terms":["term1","term2"],"match_type":"exact","org_id":12345,"thread_ids":["thread1","thread2"],"mentions":["@user1","@user2"]}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize from JSON");

    assert_eq!(request.query, Some("test query".to_string()));
    assert_eq!(
        request.terms,
        Some(vec!["term1".to_string(), "term2".to_string()])
    );
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(request.filters.as_ref().unwrap().org_id, Some(12345));
    assert_eq!(
        request.filters.as_ref().unwrap().thread_ids,
        vec!["thread1".to_string(), "thread2".to_string()]
    );
    assert_eq!(
        request.filters.as_ref().unwrap().mentions,
        vec!["@user1".to_string(), "@user2".to_string()]
    );
}

#[test]
fn test_channel_search_request_minimal_json() {
    let json = r#"{"match_type":"partial"}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize minimal JSON");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Partial);
    // With #[serde(flatten)], filters will be Some(ChannelFilters::default()) even when no filter fields are present
    assert_eq!(request.filters, Some(ChannelFilters::default()));
}

#[test]
fn test_channel_search_request_all_match_types() {
    let test_cases = vec![
        ("exact", MatchType::Exact),
        ("partial", MatchType::Partial),
        ("query", MatchType::Query),
    ];

    for (json_value, expected_match_type) in test_cases {
        let json = format!(r#"{{"match_type":"{}"}}"#, json_value);
        let request: ChannelSearchRequest = serde_json::from_str(&json)
            .unwrap_or_else(|_| panic!("Failed to deserialize match_type: {}", json_value));

        assert_eq!(request.match_type, expected_match_type);
    }
}

#[test]
fn test_channel_search_request_round_trip() {
    let original = ChannelSearchRequest {
        query: Some("search term".to_string()),
        terms: None,
        match_type: MatchType::Query,
        filters: Some(ChannelFilters {
            org_id: Some(99999),
            thread_ids: vec!["thread-abc".to_string()],
            mentions: vec!["@admin".to_string()],
            ..Default::default()
        }),
        search_on: SearchOn::Content,
        collapse: None,
    };

    let json = serde_json::to_string(&original).expect("Failed to serialize");
    let deserialized: ChannelSearchRequest =
        serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(original.query, deserialized.query);
    assert_eq!(original.terms, deserialized.terms);
    assert_eq!(original.match_type, deserialized.match_type);
    assert_eq!(original.filters, deserialized.filters);
}

#[test]
fn test_channel_search_request_empty_arrays() {
    let json = r#"{"query":"test","terms":[],"match_type":"exact","org_id":0,"thread_ids":[],"mentions":[]}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize empty arrays");

    assert_eq!(request.query, Some("test".to_string()));
    assert_eq!(request.terms, Some(vec![]));
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(request.filters.as_ref().unwrap().org_id, Some(0));
    assert!(request.filters.as_ref().unwrap().thread_ids.is_empty());
    assert!(request.filters.as_ref().unwrap().mentions.is_empty());
}

#[test]
fn test_channel_search_request_with_org_id_only() {
    let json = r#"{"match_type":"partial","org_id":42}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize with org_id only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Partial);
    assert_eq!(request.filters.as_ref().unwrap().org_id, Some(42));
    assert!(request.filters.as_ref().unwrap().thread_ids.is_empty());
    assert!(request.filters.as_ref().unwrap().mentions.is_empty());
}

#[test]
fn test_channel_search_request_with_thread_ids_only() {
    let json = r#"{"match_type":"exact","thread_ids":["thread-1","thread-2","thread-3"]}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize with thread_ids only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(request.filters.as_ref().unwrap().org_id, None);
    assert_eq!(
        request.filters.as_ref().unwrap().thread_ids,
        vec![
            "thread-1".to_string(),
            "thread-2".to_string(),
            "thread-3".to_string()
        ]
    );
    assert!(request.filters.as_ref().unwrap().mentions.is_empty());
}

#[test]
fn test_channel_search_request_with_mentions_only() {
    let json = r#"{"match_type":"query","mentions":["@alice","@bob","@charlie"]}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize with mentions only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Query);
    assert_eq!(request.filters.as_ref().unwrap().org_id, None);
    assert!(request.filters.as_ref().unwrap().thread_ids.is_empty());
    assert_eq!(
        request.filters.as_ref().unwrap().mentions,
        vec![
            "@alice".to_string(),
            "@bob".to_string(),
            "@charlie".to_string()
        ]
    );
}

#[test]
fn test_channel_search_request_with_query_and_terms() {
    let json = r#"{"query":"main query","terms":["term1","term2","term3"],"match_type":"query"}"#;

    let request: ChannelSearchRequest =
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
    assert_eq!(request.filters, Some(ChannelFilters::default()));
}

#[test]
fn test_channel_search_request_negative_org_id() {
    let json = r#"{"match_type":"exact","org_id":-1}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize negative org_id");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(request.filters.as_ref().unwrap().org_id, Some(-1));
    assert!(request.filters.as_ref().unwrap().thread_ids.is_empty());
    assert!(request.filters.as_ref().unwrap().mentions.is_empty());
}

#[test]
fn test_channel_search_request_invalid_match_type() {
    let json = r#"{"match_type":"invalid"}"#;

    let result = serde_json::from_str::<ChannelSearchRequest>(json);
    assert!(
        result.is_err(),
        "Should fail to deserialize invalid match_type"
    );
}

#[test]
fn test_channel_search_request_missing_required_field() {
    let json = r#"{"query":"test"}"#;

    let result = serde_json::from_str::<ChannelSearchRequest>(json);
    assert!(
        result.is_err(),
        "Should fail to deserialize without required match_type field"
    );
}

#[test]
fn test_channel_search_request_filters_only() {
    let json =
        r#"{"match_type":"exact","org_id":123,"thread_ids":["thread1"],"mentions":["@user1"]}"#;

    let request: ChannelSearchRequest =
        serde_json::from_str(json).expect("Failed to deserialize filters only");

    assert_eq!(request.query, None);
    assert_eq!(request.terms, None);
    assert_eq!(request.match_type, MatchType::Exact);
    assert_eq!(request.filters.as_ref().unwrap().org_id, Some(123));
    assert_eq!(
        request.filters.as_ref().unwrap().thread_ids,
        vec!["thread1".to_string()]
    );
    assert_eq!(
        request.filters.as_ref().unwrap().mentions,
        vec!["@user1".to_string()]
    );
}
