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
            to: None,
            subject: None,
            query: None,
            negated_query: None,
            has_attachment: None,
            exclude_chats: None,
        },
        action: FilterAction {
            add_label_ids: Some(vec!["TRASH".to_string()]),
            remove_label_ids: None,
            forward: None,
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
