use std::time::Duration;

use http::{HeaderMap, HeaderValue, StatusCode};
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::method};

use super::*;

#[test]
fn server_errors_are_unavailable() {
    for status in [
        StatusCode::INTERNAL_SERVER_ERROR,
        StatusCode::BAD_GATEWAY,
        StatusCode::SERVICE_UNAVAILABLE,
        StatusCode::GATEWAY_TIMEOUT,
    ] {
        assert_eq!(
            UpstreamFailure::from_status(status, &HeaderMap::new()),
            Some(UpstreamFailure::Unavailable),
            "{status}"
        );
    }
}

#[test]
fn too_many_requests_is_rate_limited_with_the_advertised_delay() {
    let mut headers = HeaderMap::new();
    headers.insert(http::header::RETRY_AFTER, HeaderValue::from_static("30"));

    assert_eq!(
        UpstreamFailure::from_status(StatusCode::TOO_MANY_REQUESTS, &headers),
        Some(UpstreamFailure::RateLimited {
            retry_after: Some(Duration::from_secs(30))
        })
    );
}

#[test]
fn too_many_requests_without_a_delay_is_still_rate_limited() {
    assert_eq!(
        UpstreamFailure::from_status(StatusCode::TOO_MANY_REQUESTS, &HeaderMap::new()),
        Some(UpstreamFailure::RateLimited { retry_after: None })
    );
}

#[test]
fn success_and_client_errors_are_not_upstream_failures() {
    for status in [
        StatusCode::OK,
        StatusCode::BAD_REQUEST,
        StatusCode::UNAUTHORIZED,
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
    ] {
        assert_eq!(
            UpstreamFailure::from_status(status, &HeaderMap::new()),
            None,
            "{status}"
        );
    }
}

#[test]
fn http_date_retry_after_is_ignored() {
    let mut headers = HeaderMap::new();
    headers.insert(
        http::header::RETRY_AFTER,
        HeaderValue::from_static("Wed, 21 Oct 2015 07:28:00 GMT"),
    );

    assert_eq!(retry_after(&headers), None);
}

#[tokio::test]
async fn an_unreachable_provider_is_unavailable() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);

    let error = reqwest::get(url).await.unwrap_err();

    assert_eq!(
        UpstreamFailure::from_transport(&error),
        UpstreamFailure::Unavailable
    );
}

#[tokio::test]
async fn an_undecodable_body_is_an_invalid_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>not json</html>"))
        .mount(&server)
        .await;

    let error = reqwest::get(server.uri())
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap_err();

    assert_eq!(
        UpstreamFailure::from_transport(&error),
        UpstreamFailure::InvalidResponse
    );
}

#[tokio::test]
async fn unavailable_answers_503_with_an_actionable_message() {
    let response = axum::response::IntoResponse::into_response(UpstreamError {
        service: "GitHub",
        failure: UpstreamFailure::Unavailable,
    });

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(response.headers().get(http::header::RETRY_AFTER).is_none());
    assert_eq!(
        body_json(response).await,
        serde_json::json!({
            "message": "GitHub is temporarily unavailable. Try again in a few minutes.",
            "code": "upstream_unavailable",
        })
    );
}

#[tokio::test]
async fn rate_limited_answers_503_with_retry_after() {
    let response = axum::response::IntoResponse::into_response(UpstreamError {
        service: "GitHub",
        failure: UpstreamFailure::RateLimited {
            retry_after: Some(Duration::from_secs(42)),
        },
    });

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(response.headers()[http::header::RETRY_AFTER], "42");
    assert_eq!(
        body_json(response).await["code"],
        serde_json::json!("upstream_rate_limited")
    );
}

#[tokio::test]
async fn invalid_response_answers_502() {
    let response = axum::response::IntoResponse::into_response(UpstreamError {
        service: "The sign-in service",
        failure: UpstreamFailure::InvalidResponse,
    });

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(
        body_json(response).await,
        serde_json::json!({
            "message": "The sign-in service returned an unexpected response. Try again in a few minutes.",
            "code": "upstream_invalid_response",
        })
    );
}

async fn body_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}
