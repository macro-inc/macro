use super::*;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

fn docs_router() -> Router {
    Router::new()
        .merge(mount_at_root_and_prefix(
            Router::new().route("/health", axum::routing::get(health)),
        ))
        .merge(mount_docs_at_root_and_prefix())
}

#[tokio::test]
async fn openapi_is_served_at_root_and_gateway_prefix() {
    let app = docs_router();

    for uri in [
        "/api-doc/openapi.json",
        "/scheduled-action/api-doc/openapi.json",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::OK,
            "openapi at {uri} should be 200"
        );
    }
}

#[tokio::test]
async fn health_is_served_at_root_and_gateway_prefix() {
    let app = docs_router();

    for uri in ["/health", "/scheduled-action/health"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "health at {uri} should be 200"
        );
    }
}
