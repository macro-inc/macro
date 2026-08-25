use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query_owner_or_delegated_link() -> anyhow::Result<()> {
    let builder = CalendarEventQueryBuilder::new(vec!["standup".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .link_ids(vec!["link1".to_string(), "link2".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();

    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"term": {"_index": "calendar_events"}})),
        "filter must constrain to the calendar_events index: {filter:?}"
    );
    // Access is owner OR delegated link — two disjoint fields OR'd, mirroring
    // the soup predicate.
    assert!(
        filter.contains(&serde_json::json!({
            "bool": {
                "minimum_should_match": 1,
                "should": [
                    {"term": {"owner_id": "user123"}},
                    {"terms": {"source_link_id": ["link1", "link2"]}}
                ]
            }
        })),
        "filter must admit owned or delegated events: {filter:?}"
    );

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 1, "one title clause per query: {must:?}");

    Ok(())
}

#[test]
fn test_owner_only_when_no_delegated_links() -> anyhow::Result<()> {
    let builder = CalendarEventQueryBuilder::new(vec!["standup".to_string()]).user_id("user123");
    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({
            "bool": {
                "minimum_should_match": 1,
                "should": [{"term": {"owner_id": "user123"}}]
            }
        })),
        "a caller with no delegated inboxes sees only their own events: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_filters_are_applied() -> anyhow::Result<()> {
    let builder = CalendarEventQueryBuilder::new(vec!["review".to_string()])
        .user_id("user123")
        .statuses(vec!["confirmed".to_string()])
        .organizer_emails(vec!["boss@macro.com".to_string()])
        .attendee_emails(vec!["gab@macro.com".to_string()])
        .ids(vec!["event1".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");

    for expected in [
        serde_json::json!({"terms": {"status": ["confirmed"]}}),
        serde_json::json!({"terms": {"organizer_email": ["boss@macro.com"]}}),
        serde_json::json!({"terms": {"attendee_emails": ["gab@macro.com"]}}),
        serde_json::json!({"terms": {"entity_id": ["event1"]}}),
    ] {
        assert!(
            filter.contains(&expected),
            "missing filter {expected:?} in {filter:?}"
        );
    }
    Ok(())
}

#[test]
fn test_ids_only_without_ids_errors() {
    let builder = CalendarEventQueryBuilder::new(vec!["standup".to_string()])
        .user_id("user123")
        .ids_only(true);
    assert!(
        builder.build_bool_query().is_err(),
        "ids_only with an empty id set must not fall back to an unscoped query"
    );
}

#[test]
fn test_no_terms_errors() {
    let builder = CalendarEventQueryBuilder::new(vec![]).user_id("user123");
    assert!(builder.build_bool_query().is_err(), "terms are required");
}
