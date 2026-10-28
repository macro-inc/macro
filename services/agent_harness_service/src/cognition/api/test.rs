use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn get_status(app: Router, path: &str) -> StatusCode {
    app.oneshot(
        Request::builder()
            .uri(path)
            .method("GET")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

#[tokio::test]
async fn health_is_reachable_at_gateway_prefix() {
    for (path, expected) in [
        ("/cognition/health", StatusCode::OK),
        ("/health", StatusCode::NOT_FOUND),
    ] {
        assert_eq!(
            get_status(mount_router(health::router()), path).await,
            expected,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    assert_eq!(
        get_status(mount_router(health::router()), "/missing").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn openapi_is_served_at_gateway_prefix() {
    for (path, expected) in [
        ("/cognition/api-doc/openapi.json", StatusCode::OK),
        ("/api-doc/openapi.json", StatusCode::NOT_FOUND),
    ] {
        assert_eq!(
            get_status(mount_router(Router::new()), path).await,
            expected,
            "{path}"
        );
    }
}

#[tokio::test]
async fn prefixed_openapi_declares_the_cognition_server() {
    let response = mount_router(Router::new())
        .oneshot(
            Request::builder()
                .uri("/cognition/api-doc/openapi.json")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let spec: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(
        spec["servers"][0]["url"].as_str(),
        Some(GATEWAY_PATH_PREFIX)
    );
}
