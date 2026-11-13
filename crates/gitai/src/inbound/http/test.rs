use axum::body::{Body, Bytes};
use axum::http::{Request, StatusCode};
use axum::routing::post;
use tower::ServiceExt;

use super::*;

async fn status_for_body_of(len: usize) -> StatusCode {
    let routes = with_worker_body_limit(
        Router::new().route("/upload", post(|body: Bytes| async move { body.len().to_string() })),
    );
    let request = Request::post("/upload")
        .body(Body::from(vec![b'x'; len]))
        .unwrap();
    routes.oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn worker_routes_accept_bodies_up_to_64_mb() {
    // Above axum's 2 MB default, so the explicit limit is what admits it.
    assert_eq!(status_for_body_of(8 * 1024 * 1024).await, StatusCode::OK);
    assert_eq!(
        status_for_body_of(WORKER_BODY_LIMIT_BYTES).await,
        StatusCode::OK
    );
    assert_eq!(
        status_for_body_of(WORKER_BODY_LIMIT_BYTES + 1).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
}
