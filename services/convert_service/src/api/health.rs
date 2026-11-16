use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use model::response::{EmptyResponse, ErrorResponse};

use crate::disk::DiskGuard;

/// Health check
///
/// Unhealthy when the disk conversions write to is running out of room. The
/// load balancer's health check reads this, so the task is replaced with one
/// that has an empty disk.
#[utoipa::path(
        get,
        path = "/health",
        responses(
            (status = 200, description = "health", body = EmptyResponse),
            (status = 503, description = "low disk space", body = ErrorResponse),
        )
    )]
pub async fn health_handler(State(disk): State<DiskGuard>) -> Response {
    match disk.check() {
        Ok(()) => (StatusCode::OK, Json(EmptyResponse::default())).into_response(),
        Err(e) => {
            tracing::error!(error=?e, "health check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorResponse {
                    message: "low disk space".into(),
                }),
            )
                .into_response()
        }
    }
}

pub fn router(disk: DiskGuard) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .with_state(disk)
}
