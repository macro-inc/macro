use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
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
async fn health_is_reachable_at_root_and_gateway_prefix() {
    for path in ["/health", "/cognition/health"] {
        assert_eq!(
            get_status(mount_at_root_and_prefix(health::router()), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    assert_eq!(
        get_status(mount_at_root_and_prefix(health::router()), "/missing").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn openapi_is_served_at_root_and_gateway_prefix() {
    for path in ["/api-doc/openapi.json", "/cognition/api-doc/openapi.json"] {
        assert_eq!(
            get_status(swagger_ui(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}
