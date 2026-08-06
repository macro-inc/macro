use std::time::Duration;

use reqwest::StatusCode;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

#[tokio::test]
async fn preserves_status_sanitized_body_and_retry_after() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/failure"))
        .respond_with(
            ResponseTemplate::new(StatusCode::TOO_MANY_REQUESTS.as_u16())
                .insert_header("Retry-After", "37")
                .set_body_string("  contact user@example.com for details  "),
        )
        .mount(&server)
        .await;

    let response = reqwest::Client::new()
        .get(format!("{}/failure", server.uri()))
        .send()
        .await
        .expect("request should complete");
    let error = unsuccessful_response(response).await;

    assert_eq!(error.status(), Some(StatusCode::TOO_MANY_REQUESTS));
    assert_eq!(error.body(), Some("contact [REDACTED_EMAIL] for details"));
    assert_eq!(error.retry_after(), Some(Duration::from_secs(37)));
}

#[tokio::test]
async fn distinguishes_transport_decode_and_invalid_response_errors() {
    let transport_error = reqwest::Client::new()
        .get("://invalid-url")
        .send()
        .await
        .expect_err("invalid URL should fail before transport");
    assert!(matches!(
        GmailApiHttpError::Transport(transport_error),
        GmailApiHttpError::Transport(_)
    ));

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/malformed"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;
    let response = reqwest::Client::new()
        .get(format!("{}/malformed", server.uri()))
        .send()
        .await
        .expect("request should complete");
    let decode_error = decode_json_response::<serde_json::Value>(response)
        .await
        .expect_err("malformed JSON should fail decoding");
    assert!(matches!(decode_error, GmailApiHttpError::Decode(_)));

    let invalid_error = GmailApiHttpError::InvalidResponse("missing history id".to_string());
    assert!(matches!(
        invalid_error,
        GmailApiHttpError::InvalidResponse(_)
    ));
}

#[test]
fn sanitization_truncates_unicode_only_at_character_boundaries() {
    let body = format!("{} user@example.com", "界".repeat(400));
    let sanitized = sanitize_error_body(&body);

    assert!(sanitized.ends_with("… (truncated)"));
    assert!(!sanitized.contains("user@example.com"));
    assert!(sanitized.is_char_boundary(sanitized.len()));
}
