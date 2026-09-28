use super::*;
use axum::{Router, body::Body, http::Request, routing::post};
use tower::ServiceExt as _;

fn router(enabled: bool) -> Router {
    Router::new()
        .route("/comments", post(|| async { StatusCode::OK }))
        .layer(axum::middleware::from_fn_with_state(
            LegacyCommentWrites { enabled },
            handler,
        ))
}

fn write_request() -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/comments")
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn enabled_switch_passes_writes_through() {
    let response = router(true).oneshot(write_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn disabled_switch_answers_service_unavailable_with_the_reason() {
    let response = router(false).oneshot(write_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let error: ErrorResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(error.message, DISABLED_MESSAGE);
}
