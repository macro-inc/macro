use axum::{
    Router,
    routing::{get, post},
};

use crate::api::context::ApiContext;

pub(in crate::api) mod create_merge_request;
pub(in crate::api) mod verify_merge_request;

#[allow(dead_code)]
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_merge_request::handler))
        .route("/verify/:code", get(verify_merge_request::handler))
}
