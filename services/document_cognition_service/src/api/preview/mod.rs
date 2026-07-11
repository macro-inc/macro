use crate::api::context::ApiContext;
use axum::{Router, routing::post};
pub mod get_batch_preview;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", post(get_batch_preview::handler))
}
