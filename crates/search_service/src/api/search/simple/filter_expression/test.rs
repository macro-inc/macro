use super::*;
use axum::{http::StatusCode, response::IntoResponse};
use serde_json::json;

#[test]
fn accepts_soup_boolean_document_and_property_expressions() {
    let expression = json!({
        "documentFilter": {"and": {
            "left": {"literal": {"subType": "TASK"}},
            "right": {"or": {
                "left": {"literal": {"owner": "macro|viewer@example.com"}},
                "right": {"literal": {"property": {
                    "propertyDefinitionId": "00000001-0000-0000-0000-000000000001",
                    "value": {"entityRef": "macro|viewer@example.com"}
                }}}
            }}
        }},
        "propertiesFilter": {"not": {"literal": {
            "propertyDefinitionId": "00000001-0000-0000-0000-000000000005",
            "entityType": "TASK",
            "value": {"dateRange": {}}
        }}}
    });
    assert!(compile(Some(expression)).unwrap().is_some());
    assert!(compile(None).unwrap().is_none());
}

#[test]
fn rejects_unsupported_scopes_and_unknown_nested_fields_with_bad_request() {
    for expression in [
        json!({"reminderFilter": null}),
        json!({"initiativeFilter": {"literal": {"include": true}}}),
        json!({"documentFilter": {"and": {"left": {"literal": {"subType": "TASK"}}, "right": {"literal": {"subType": "TASK"}}, "extra": true}}}),
        json!({"propertiesFilter": {"literal": {"propertyDefinitionId": "00000001-0000-0000-0000-000000000005", "value": {"dateRange": {"extra": true}}}}}),
        json!({"documentFilter": {"literal": {"createdAt": {"gte": "2026-01-01T00:00:00Z"}}}}),
    ] {
        let error = compile(Some(expression)).unwrap_err();
        assert_eq!(error.into_response().status(), StatusCode::BAD_REQUEST);
    }
}

#[test]
fn rejects_deep_expressions_before_recursive_compilation() {
    let mut expression = json!({"literal": {"subType": "TASK"}});
    for _ in 0..70 {
        expression = json!({"not": expression});
    }
    assert!(compile(Some(json!({"documentFilter": expression}))).is_err());
}

#[test]
fn expression_scope_excludes_unfiltered_sources_without_enabling_documents() {
    for excluded in [false, true] {
        let mut source = item_filters::EntityFilters::default();
        if excluded {
            source.document_filters.document_ids = vec![uuid::Uuid::nil().to_string()];
        }
        let mut filters = models_search::unified::SearchEntityFilters::from(source);
        restrict_sources(&mut filters);
        assert_eq!(filters.should_include_documents, !excluded);
        assert!(!filters.should_include_agent_sessions);
        assert!(!filters.should_include_chats);
        assert!(!filters.should_include_emails);
        assert!(!filters.should_include_channels);
        assert!(!filters.should_include_projects);
        assert!(!filters.should_include_call_records);
        assert!(!filters.should_include_calendar_events);
    }
}
