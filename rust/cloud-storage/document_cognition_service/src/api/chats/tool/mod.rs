mod post;

use crate::api::context::ApiContext;
use axum::{Router, routing::post};

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", post(post::handler))
}
