use super::{health, mount_at_root_and_prefix};
use crate::disk::DiskGuard;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

/// A health check response for a disk that must keep `min_free_bytes` free.
async fn health_status(path: &str, min_free_bytes: u64) -> StatusCode {
    let disk = tempfile::tempdir().unwrap();
    let guard = DiskGuard::new(disk.path(), min_free_bytes, 0);

    mount_at_root_and_prefix(health::router(guard))
        .oneshot(
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
    for path in ["/health", "/convert/health"] {
        assert_eq!(health_status(path, 0).await, StatusCode::OK, "{path}");
    }
}

#[tokio::test]
async fn health_fails_when_the_disk_is_low_so_the_task_is_replaced() {
    for path in ["/health", "/convert/health"] {
        assert_eq!(
            health_status(path, u64::MAX).await,
            StatusCode::SERVICE_UNAVAILABLE,
            "{path}"
        );
    }
}

#[tokio::test]
async fn unprefixed_unknown_path_is_not_rewritten_onto_the_prefix() {
    assert_eq!(health_status("/missing", 0).await, StatusCode::NOT_FOUND);
}
