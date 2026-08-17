use reqwest::StatusCode;
use serde_json::json;
use wiremock::matchers::{body_json, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        String::new(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

fn label(name: &str) -> GmailLabel {
    GmailLabel {
        id: None,
        name: name.to_string(),
        message_list_visibility: None,
        label_list_visibility: None,
        type_: None,
        color: None,
    }
}

#[tokio::test]
async fn lists_raw_gmail_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/labels"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "labels": [{"id": "label-1", "name": "Projects"}]
        })))
        .mount(&server)
        .await;

    let labels = fetch_user_labels(&client(&server), "token").await.unwrap();
    assert_eq!(labels[0].id.as_deref(), Some("label-1"));
    assert_eq!(labels[0].name, "Projects");
}

#[tokio::test]
async fn creates_the_supplied_raw_label_without_adding_defaults() {
    let server = MockServer::start().await;
    let request = label("Projects");
    Mock::given(method("POST"))
        .and(path("/users/me/labels"))
        .and(body_json(json!({
            "id": null,
            "name": "Projects",
            "messageListVisibility": null,
            "labelListVisibility": null,
            "type": null,
            "color": null
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "label-1", "name": "Projects"
        })))
        .mount(&server)
        .await;

    let created = create_label(&client(&server), "token", &request)
        .await
        .unwrap();
    assert_eq!(created.id.as_deref(), Some("label-1"));
}

#[tokio::test]
async fn delete_preserves_not_found_body() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/users/me/labels/missing"))
        .respond_with(ResponseTemplate::new(404).set_body_string("missing private@example.com"))
        .mount(&server)
        .await;

    let error = delete_gmail_label(&client(&server), "token", "missing")
        .await
        .unwrap_err();
    assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
    assert_eq!(error.body(), Some("missing [REDACTED_EMAIL]"));
}

#[tokio::test]
async fn modifies_message_labels_with_the_wire_request() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/message-1/modify"))
        .and(body_json(json!({
            "addLabelIds": ["STARRED"],
            "removeLabelIds": ["UNREAD"]
        })))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    modify_message_labels(
        &client(&server),
        "token",
        "message-1",
        &["STARRED".to_string()],
        &["UNREAD".to_string()],
    )
    .await
    .unwrap();
}
