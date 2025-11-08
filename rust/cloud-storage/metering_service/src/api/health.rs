use axum::{Router, http::StatusCode, response::Json, routing::get};
use metering_db_client::paths;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[utoipa::path(
    get,
    path = paths::HEALTH,
    responses(
        (status = 200, description = "Service is healthy", body = HealthResponse)
    ),
    tag = "health"
)]
pub async fn health() -> (StatusCode, Json<HealthResponse>) {
    (
        StatusCode::OK,
        Json(HealthResponse {
            status: "healthy".to_string(),
            service: "metering".to_string(),
            timestamp: chrono::Utc::now(),
        }),
    )
}

pub fn router() -> Router {
    Router::new().route("/", get(health))
}
