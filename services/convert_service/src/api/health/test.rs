use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
#[allow(unused_imports)]
use http_body_util::BodyExt; // for `collect`
use tower::ServiceExt;

#[tokio::test]
async fn a_nearly_full_disk_fails_the_route() {
    let root = tempfile::tempdir().unwrap();
    let response = router_checking(root.path(), u64::MAX)
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn test_health_check() {
    let root = tempfile::tempdir().unwrap();
    let api = router_checking(root.path(), 0);

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
    String::from_utf8(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
}

#[test]
fn a_nearly_full_disk_is_unhealthy() {
    let root = tempfile::tempdir().unwrap();

    assert_eq!(disk_status(root.path(), 0), StatusCode::OK);
    assert_eq!(
        disk_status(root.path(), u64::MAX),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[test]
fn an_unreadable_filesystem_is_unhealthy() {
    let root = tempfile::tempdir().unwrap();

    assert_eq!(
        disk_status(&root.path().join("missing"), 0),
        StatusCode::SERVICE_UNAVAILABLE
    );
}
