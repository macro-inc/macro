use reqwest::StatusCode;
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn client(server: &MockServer) -> GmailClient {
    GmailClient::new_with_urls(
        "projects/project/topics/gmail".to_string(),
        server.uri(),
        server.uri(),
        server.uri(),
        String::new(),
    )
}

#[tokio::test]
async fn registers_watch_with_the_configured_topic() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .and(body_json(
            json!({"topicName": "projects/project/topics/gmail"}),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "historyId": "123", "expiration": "456"
        })))
        .mount(&server)
        .await;

    let response = register_watch(&client(&server), "token").await.unwrap();
    assert_eq!(response.history_id, "123");
}

#[tokio::test]
async fn watch_preserves_conflict_status_and_body_without_classifying_it() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(ResponseTemplate::new(400).set_body_string(
            "Only one user push notification client allowed for private@example.com",
        ))
        .mount(&server)
        .await;

    let error = register_watch(&client(&server), "token").await.unwrap_err();
    assert_eq!(error.status(), Some(StatusCode::BAD_REQUEST));
    assert_eq!(
        error.body(),
        Some("Only one user push notification client allowed for [REDACTED_EMAIL]")
    );
}

#[tokio::test]
async fn stops_watch_with_an_empty_body() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/stop"))
        .and(header("content-length", "0"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    stop_watch(&client(&server), "token").await.unwrap();
}
