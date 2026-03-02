use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
#[allow(unused_imports)]
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn test_health_check() {
    let api = router();

    let response = api
        .oneshot(
            Request::builder()
                .uri("/health")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
