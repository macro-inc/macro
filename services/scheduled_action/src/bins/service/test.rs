use super::*;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

fn docs_router() -> Router {
    Router::new()
        .merge(mount_at_root_and_prefix(Router::new().route("/health", axum::routing::get(health))))
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .merge(
            SwaggerUi::new(format!("{GATEWAY_PATH_PREFIX}/docs"))
                .url(format!("{GATEWAY_PATH_PREFIX}/api-doc/openapi.json"), ApiDoc::openapi()),
        )
}

#[tokio::test]
async fn openapi_is_served_at_root_and_gateway_prefix() {
    let app = docs_router();

    for uri in [
        "/api-doc/openapi.json",
        "/agent-schedule/api-doc/openapi.json",
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

        assert_eq!(response.status(), StatusCode::OK, "openapi at {uri} should be 200");
    }
}
