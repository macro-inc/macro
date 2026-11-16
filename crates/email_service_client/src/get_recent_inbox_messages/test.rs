use crate::EmailServiceClient;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

#[tokio::test]
async fn asks_for_one_users_messages_with_internal_auth() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .and(query_param("limit", "20"))
        .and(header("x-internal-auth-key", "internal-key"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"messages": [{
                "inbox": "owner@example.com",
                "from": {"email": "billing@example.com", "name": "Billing"},
                "to": ["owner@example.com"],
                "cc": [],
                "subject": "Invoice 42",
                "snippet": "Your invoice is attached",
                "received_at": "2026-10-27T09:00:00Z"
            }]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let response = client
        .get_recent_inbox_messages("macro|owner@example.com", 20)
        .await
        .unwrap();

    assert_eq!(response.messages.len(), 1);
    assert_eq!(response.messages[0].subject.as_deref(), Some("Invoice 42"));
}

#[tokio::test]
async fn an_error_status_fails_the_call() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let result = client
        .get_recent_inbox_messages("macro|owner@example.com", 20)
        .await;

    assert!(result.is_err());
}

#[tokio::test]
async fn asks_for_longer_snippets_and_reads_labels() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/internal/recent_messages/macro|owner@example.com"))
        .and(query_param("limit", "100"))
        .and(query_param("snippet_chars", "500"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"messages": [{
                "inbox": "owner@example.com",
                "from": null,
                "to": [],
                "cc": [],
                "subject": "Invoice 42",
                "snippet": "Your invoice is attached",
                "received_at": null,
                "labels": ["INBOX", "Billing"]
            }]})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let client = EmailServiceClient::new("internal-key".to_owned(), server.uri());

    let response = client
        .get_recent_inbox_messages_with_snippets("macro|owner@example.com", 100, Some(500))
        .await
        .unwrap();

    assert_eq!(response.messages[0].labels, ["INBOX", "Billing"]);
}
