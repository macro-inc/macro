//! `GET /health`: always 200 while the process runs, so a draining replica is
//! not killed early; `ready` turns false once the drain starts.

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use tokio_util::sync::CancellationToken;

/// Health response body.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Health {
    /// False while draining.
    pub ready: bool,
}

async fn health(State(draining): State<CancellationToken>) -> Json<Health> {
    Json(Health {
        ready: !draining.is_cancelled(),
    })
}

/// The health router; `draining` is the shutdown token.
pub fn router(draining: CancellationToken) -> Router {
    Router::new()
        .route("/health", get(health))
        .with_state(draining)
}
