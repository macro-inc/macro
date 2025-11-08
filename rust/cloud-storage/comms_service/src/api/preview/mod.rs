pub mod get_batch_preview;
use axum::{Router, routing::post};

use crate::api::context::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/", post(get_batch_preview::handler))
}
