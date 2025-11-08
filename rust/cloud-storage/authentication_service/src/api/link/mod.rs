use crate::api::context::ApiContext;
use axum::{Router, routing::post};
pub(in crate::api) mod create_in_progress_link;

#[allow(dead_code)]
pub fn router() -> Router<ApiContext> {
    Router::new().route("/", post(create_in_progress_link::handler))
}
