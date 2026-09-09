use super::*;
use axum::{body::Body, http::Request};
use tower::ServiceExt;

#[tokio::test]
async fn browser_sse_resume_preflight_allows_last_event_id() {
    let app = Router::new()
        .route("/mcp", routing::get(|| async { "ok" }))
        .layer(mcp_cors_layer());
    let response = app
        .oneshot(
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/mcp")
                .header("origin", "https://client.example")
                .header("access-control-request-method", "GET")
                .header(
                    "access-control-request-headers",
                    "authorization,mcp-session-id,last-event-id",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(response.status().is_success());
    let allowed = response.headers()["access-control-allow-headers"]
        .to_str()
        .unwrap();
    assert!(allowed.contains("last-event-id"));
}
