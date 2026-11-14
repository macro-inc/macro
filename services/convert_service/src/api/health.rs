use std::path::Path;

use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};
use model::response::EmptyResponse;

use crate::job_folder::{MIN_FREE_BYTES, free_bytes};

/// Health check
///
/// Unhealthy when the jobs disk is nearly full: every conversion would fail,
/// and ECS replaces an unhealthy task with one on a fresh disk.
#[utoipa::path(
        get,
        path = "/health",
        responses(
            (status = 200, description = "health", body = EmptyResponse),
            (status = 503, description = "too little free disk space for conversions", body = EmptyResponse),
        )
    )]
pub async fn health_handler() -> impl IntoResponse {
    (
        disk_status(&std::env::temp_dir(), MIN_FREE_BYTES),
        Json(EmptyResponse::default()),
    )
}

/// `OK` when the filesystem holding `path` has at least `min_free_bytes` free.
fn disk_status(path: &Path, min_free_bytes: u64) -> StatusCode {
    match free_bytes(path) {
        Ok(free) if free >= min_free_bytes => StatusCode::OK,
        Ok(free) => {
            tracing::error!(
                free_bytes = free,
                "too little free disk space for conversions"
            );
            StatusCode::SERVICE_UNAVAILABLE
        }
        Err(e) => {
            tracing::error!(error=?e, "unable to check free disk space");
            StatusCode::SERVICE_UNAVAILABLE
        }
    }
}

pub fn router() -> Router {
    Router::new().route("/health", get(health_handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    #[allow(unused_imports)]
    use http_body_util::BodyExt; // for `collect`
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_check() {
        let api = router();

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
}
