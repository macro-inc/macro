use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::StatusCode;
use wiremock::matchers::{body_json, header, method, path, query_param};
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

#[tokio::test]
async fn list_messages_uses_path_repeated_labels_and_limit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .and(query_param("maxResults", "500"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param("labelIds", "IMPORTANT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "messages": [{ "id": "message-1" }, { "id": "message-2" }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let ids = list_messages(&client(&server), "token", 900, &["INBOX", "IMPORTANT"])
        .await
        .expect("message list should decode");

    assert_eq!(ids, ["message-1", "message-2"]);
}

#[tokio::test]
async fn zero_message_limit_does_not_make_a_request() {
    let server = MockServer::start().await;
    let ids = list_messages(&client(&server), "token", 0, &[])
        .await
        .expect("zero limit should succeed");

    assert!(ids.is_empty());
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn get_message_maps_not_found_to_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/missing"))
        .respond_with(ResponseTemplate::new(StatusCode::NOT_FOUND.as_u16()))
        .mount(&server)
        .await;

    let message = get_message(&client(&server), "token", "missing")
        .await
        .expect("404 should not be an error");
    assert!(message.is_none());
}

#[tokio::test]
async fn get_message_label_ids_requests_minimal_format() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages/message-1"))
        .and(query_param("format", "minimal"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "message-1",
            "threadId": "thread-1",
            "labelIds": ["INBOX", "UNREAD"]
        })))
        .mount(&server)
        .await;

    let labels = get_message_label_ids(&client(&server), "token", "message-1")
        .await
        .expect("minimal message should decode");
    assert_eq!(labels.unwrap(), ["INBOX", "UNREAD"]);
}

#[tokio::test]
async fn message_errors_are_typed_and_sanitized() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .respond_with(
            ResponseTemplate::new(StatusCode::INTERNAL_SERVER_ERROR.as_u16())
                .set_body_string("failure for private@example.com"),
        )
        .mount(&server)
        .await;

    let error = list_messages(&client(&server), "token", 1, &[])
        .await
        .expect_err("error status should fail");
    assert_eq!(error.status(), Some(StatusCode::INTERNAL_SERVER_ERROR));
    assert_eq!(error.body(), Some("failure for [REDACTED_EMAIL]"));
}

#[tokio::test]
async fn send_message_posts_unpadded_base64url_mime_and_returns_provider_ids() {
    let server = MockServer::start().await;
    let mime = b"From: sender@example.com\r\n\r\nbody with ? and /";
    let encoded_mime = URL_SAFE_NO_PAD.encode(mime);
    assert!(!encoded_mime.contains('='));

    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .and(header("authorization", "Bearer token"))
        .and(body_json(serde_json::json!({
            "raw": encoded_mime,
            "threadId": "thread-existing"
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "message-sent",
            "threadId": "thread-sent"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let sent = send_message(&client(&server), "token", mime, Some("thread-existing"))
        .await
        .expect("message should send");

    assert_eq!(sent.id, "message-sent");
    assert_eq!(sent.thread_id, "thread-sent");
}

#[tokio::test]
async fn send_message_omits_absent_thread_id() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .and(body_json(serde_json::json!({
            "raw": URL_SAFE_NO_PAD.encode(b"mime")
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "message-sent",
            "threadId": "thread-new"
        })))
        .expect(1)
        .mount(&server)
        .await;

    send_message(&client(&server), "token", b"mime", None)
        .await
        .expect("message should send without a thread id");
}

#[tokio::test]
async fn send_message_classifies_http_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .respond_with(
            ResponseTemplate::new(StatusCode::TOO_MANY_REQUESTS.as_u16())
                .insert_header("Retry-After", "17")
                .set_body_string("quota exceeded for private@example.com"),
        )
        .mount(&server)
        .await;

    let error = send_message(&client(&server), "token", b"mime", None)
        .await
        .expect_err("error status should fail");

    assert_eq!(error.status(), Some(StatusCode::TOO_MANY_REQUESTS));
    assert_eq!(error.body(), Some("quota exceeded for [REDACTED_EMAIL]"));
    assert_eq!(
        error.retry_after(),
        Some(std::time::Duration::from_secs(17))
    );
}

#[tokio::test]
async fn malformed_send_response_is_a_decode_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/messages/send"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
        .mount(&server)
        .await;

    let error = send_message(&client(&server), "token", b"mime", None)
        .await
        .expect_err("malformed JSON should fail");
    assert!(matches!(error, GmailApiHttpError::Decode(_)));
}

#[tokio::test]
async fn malformed_message_json_is_a_decode_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/messages"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
        .mount(&server)
        .await;

    let error = list_messages(&client(&server), "token", 1, &[])
        .await
        .expect_err("malformed JSON should fail");
    assert!(matches!(error, GmailApiHttpError::Decode(_)));
}
