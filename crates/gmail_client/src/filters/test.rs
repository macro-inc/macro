use reqwest::StatusCode;
use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use models_email::gmail::filters::{FilterAction, FilterCriteria};

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

fn filter() -> Filter {
    Filter {
        id: None,
        criteria: FilterCriteria {
            from: Some("sender@example.com".to_string()),
            ..FilterCriteria::default()
        },
        action: FilterAction {
            add_label_ids: Some(vec!["TRASH".to_string()]),
            ..FilterAction::default()
        },
    }
}

#[tokio::test]
async fn creates_a_generic_filter() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/settings/filters"))
        .and(body_json(json!({
            "criteria": {"from": "sender@example.com"},
            "action": {"addLabelIds": ["TRASH"]}
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "filter-1",
            "criteria": {"from": "sender@example.com"},
            "action": {"addLabelIds": ["TRASH"]}
        })))
        .mount(&server)
        .await;

    let created = create_filter(&client(&server), "token", filter())
        .await
        .unwrap();
    assert_eq!(created.id.as_deref(), Some("filter-1"));
}

#[tokio::test]
async fn lists_generic_filters() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/filters"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "filter": [{
                "id": "filter-1", "criteria": {}, "action": {}
            }]
        })))
        .mount(&server)
        .await;

    let filters = list_filters(&client(&server), "token").await.unwrap();
    assert_eq!(filters[0].id.as_deref(), Some("filter-1"));
}

#[tokio::test]
async fn lists_filters_without_criteria_or_action() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/filters"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "filter": [
                {"id": "template-reply", "criteria": {"from": "newsletter@example.com"}},
                {"id": "action-only", "action": {"removeLabelIds": ["SPAM"]}},
                {
                    "id": "large-mail",
                    "criteria": {"size": 10485760, "sizeComparison": "larger", "hasAttachment": true},
                    "action": {"forward": "archive@example.com"}
                }
            ]
        })))
        .mount(&server)
        .await;

    let filters = list_filters(&client(&server), "token").await.unwrap();

    assert_eq!(filters.len(), 3);
    assert_eq!(
        filters[0].criteria.from.as_deref(),
        Some("newsletter@example.com")
    );
    assert_eq!(filters[0].action.add_label_ids, None);
    assert_eq!(filters[1].criteria.from, None);
    assert_eq!(
        filters[1].action.remove_label_ids,
        Some(vec!["SPAM".to_string()])
    );
    assert_eq!(filters[2].criteria.has_attachment, Some(true));
}

#[tokio::test]
async fn list_decode_error_names_the_field_path_without_its_value() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/settings/filters"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "filter": [
                {"id": "ok", "criteria": {"from": "first@example.com"}, "action": {}},
                {"id": "odd", "criteria": {"hasAttachment": "second@example.com"}}
            ]
        })))
        .mount(&server)
        .await;

    let error = list_filters(&client(&server), "token").await.unwrap_err();

    assert_eq!(
        error.to_string(),
        "Gmail API response decode error: unexpected value at filter[1].criteria.hasAttachment"
    );
}

#[tokio::test]
async fn delete_preserves_http_errors() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/settings/filters/missing"))
        .respond_with(ResponseTemplate::new(404).set_body_string("missing"))
        .mount(&server)
        .await;

    let error = delete_filter(&client(&server), "token", "missing")
        .await
        .unwrap_err();
    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(error.body(), Some("missing"));
}
