use reqwest::StatusCode;
use wiremock::matchers::{method, path, query_param};
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
async fn list_threads_preserves_wire_response_and_query_parameters() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads"))
        .and(query_param("maxResults", "500"))
        .and(query_param("pageToken", "next page"))
        .and(query_param("labelIds", "INBOX"))
        .and(query_param("labelIds", "IMPORTANT"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "threads": [{ "id": "thread-1" }],
            "nextPageToken": "following-page"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let response = list_threads(
        &client(&server),
        "token",
        700,
        Some("next page"),
        &["INBOX", "IMPORTANT"],
    )
    .await
    .expect("thread list should decode");

    assert_eq!(response.threads.unwrap()[0].id, "thread-1");
    assert_eq!(response.next_page_token.as_deref(), Some("following-page"));
}

#[tokio::test]
async fn zero_thread_limit_does_not_make_a_request() {
    let server = MockServer::start().await;
    let response = list_threads(&client(&server), "token", 0, Some("unused"), &[])
        .await
        .expect("zero limit should succeed");

    assert!(response.threads.unwrap().is_empty());
    assert!(response.next_page_token.is_none());
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn get_message_ids_requests_minimal_thread() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads/thread-1"))
        .and(query_param("format", "minimal"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "thread-1",
            "messages": [
                { "id": "message-1", "threadId": "thread-1" },
                { "id": "message-2", "threadId": "thread-1" }
            ]
        })))
        .mount(&server)
        .await;

    let ids = get_message_ids_for_thread(&client(&server), "token", "thread-1")
        .await
        .expect("minimal thread should decode");
    assert_eq!(ids, ["message-1", "message-2"]);
}

#[tokio::test]
async fn get_thread_requests_full_format_and_sanitizes_errors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads/thread-1"))
        .and(query_param("format", "full"))
        .respond_with(
            ResponseTemplate::new(StatusCode::FORBIDDEN.as_u16())
                .set_body_string("denied for private@example.com"),
        )
        .mount(&server)
        .await;

    let error = get_thread(&client(&server), "token", "thread-1")
        .await
        .expect_err("error status should fail");
    assert_eq!(error.status(), Some(StatusCode::FORBIDDEN));
    assert_eq!(error.body(), Some("denied for [REDACTED_EMAIL]"));
}

#[tokio::test]
async fn malformed_thread_json_is_a_decode_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/me/threads"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
        .mount(&server)
        .await;

    let error = list_threads(&client(&server), "token", 1, None, &[])
        .await
        .expect_err("malformed JSON should fail");
    assert!(matches!(error, GmailApiHttpError::Decode(_)));
}
