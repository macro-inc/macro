use super::{health, mount_at_root_and_prefix};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::get,
};
use tower::ServiceExt;

async fn ok() -> &'static str {
    "ok"
}

fn sample_app() -> Router {
    mount_at_root_and_prefix(
        Router::new()
            .route("/health", get(ok))
            .route("/oauth/callback", get(ok))
            .route("/.well-known/oauth-protected-resource/mcp", get(ok))
            .route("/mcp/.well-known/oauth-protected-resource", get(ok))
            .route("/mcp", get(ok)),
    )
}

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
    for path in ["/health", "/mcp/health"] {
        let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
            .oneshot(
                Request::builder()
                    .uri(path)
                    .method("GET")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn existing_paths_stay_and_are_also_served_under_the_prefix() {
    for path in [
        "/health",
        "/mcp/health",
        "/oauth/callback",
        "/mcp/oauth/callback",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
        "/mcp/.well-known/oauth-protected-resource/mcp",
        "/mcp",
        "/mcp/mcp",
    ] {
        assert_eq!(
            get_status(sample_app(), path).await,
            StatusCode::OK,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    let response = mount_at_root_and_prefix(Router::new().route("/health", get(health)))
        .oneshot(
            Request::builder()
                .uri("/missing")
                .method("GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}
