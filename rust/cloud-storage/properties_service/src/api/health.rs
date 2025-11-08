use axum::{Router, http::StatusCode, response::Json, routing::get};
use serde_json::{Value, json};

pub fn router() -> Router {
    Router::new().route("/health", get(health))
}

#[tracing::instrument]
async fn health() -> Result<Json<Value>, StatusCode> {
    tracing::debug!("health check requested");

    let response = Json(json!({
        "status": "ok",
        "service": "properties_service"
    }));

    tracing::trace!("health check response ready");

    Ok(response)
}
