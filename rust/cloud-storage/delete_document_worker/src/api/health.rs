use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::get};
use model::response::EmptyResponse;

/// Health check
pub async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, Json(EmptyResponse::default()))
}

pub fn router() -> Router {
    Router::new().route("/health", get(health_handler))
}
