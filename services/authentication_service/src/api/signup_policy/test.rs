use axum::body::Body;
use axum::http::StatusCode;
use http_body_util::BodyExt;

use super::*;

const ALLOWED_EMAIL: &str = "allowed@example.test";
const DENIED_EMAIL: &str = "denied@example.test";

#[tokio::test]
async fn forbidden_response_is_generic_and_redacted() {
    let response = signup_forbidden_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let body = response_body(response.into_body()).await;
    assert!(body.contains("signup is not allowed"));
    assert_redacted(&body);
}

async fn response_body(body: Body) -> String {
    let bytes = body.collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn assert_redacted(diagnostic: &str) {
    assert!(!diagnostic.contains(ALLOWED_EMAIL));
    assert!(!diagnostic.contains(DENIED_EMAIL));
    assert!(!diagnostic.contains("example.test"));
}
