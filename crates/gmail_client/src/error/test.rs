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
async fn transport_and_decode_errors_do_not_leak_request_urls() {
    // Transport failure against a URL carrying a sensitive query parameter.
    let transport_error = reqwest::Client::new()
        .get("http://127.0.0.1:1/people?syncToken=SECRET-TOKEN")
        .send()
        .await
        .expect_err("connection to a closed port should fail");
    let error = GmailApiHttpError::transport(transport_error);
    let rendered = error.to_string();
    assert!(matches!(error, GmailApiHttpError::Transport(_)));
    assert!(
        !rendered.contains("SECRET-TOKEN") && !rendered.contains("127.0.0.1"),
        "transport errors must not render the request URL: {rendered}"
    );

    // Decode failure through the shared decoder, same URL-hygiene requirement.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/malformed"))
        .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
        .mount(&server)
        .await;
    let response = reqwest::Client::new()
        .get(format!("{}/malformed?syncToken=SECRET-TOKEN", server.uri()))
        .send()
        .await
        .expect("request should complete");
    let decode_error = decode_json_response::<serde_json::Value>(response)
        .await
        .expect_err("malformed JSON should fail decoding");
    let rendered = decode_error.to_string();
    assert!(matches!(decode_error, GmailApiHttpError::Decode(_)));
    assert!(
        !rendered.contains("SECRET-TOKEN") && !rendered.contains(&server.uri()),
        "decode errors must not render the request URL: {rendered}"
    );
}

#[test]
fn retry_after_parses_delta_seconds_and_http_dates() {
    assert_eq!(parse_retry_after("37"), Some(Duration::from_secs(37)));
    assert_eq!(parse_retry_after("  37  "), Some(Duration::from_secs(37)));

    let future = std::time::SystemTime::now() + Duration::from_secs(120);
    let parsed =
        parse_retry_after(&httpdate::fmt_http_date(future)).expect("http-date form should parse");
    assert!(
        parsed <= Duration::from_secs(120) && parsed >= Duration::from_secs(110),
        "expected roughly two minutes, got {parsed:?}"
    );

    // A date in the past clamps to zero instead of failing or underflowing.
    assert_eq!(
        parse_retry_after("Sun, 06 Nov 1994 08:49:37 GMT"),
        Some(Duration::ZERO)
    );

    assert_eq!(parse_retry_after("not-a-date"), None);
}

#[test]
fn sanitization_truncates_unicode_only_at_character_boundaries() {
    let body = format!("{} user@example.com", "界".repeat(400));
    let sanitized = sanitize_error_body(&body);

    assert!(sanitized.ends_with("… (truncated)"));
    assert!(!sanitized.contains("user@example.com"));
    assert!(sanitized.is_char_boundary(sanitized.len()));
}
