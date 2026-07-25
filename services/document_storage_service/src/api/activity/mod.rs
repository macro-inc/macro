use crate::api::context::ApiContext;
use axum::{Router, routing::get};

pub(in crate::api) mod get_recent_activity;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/",
        #[expect(deprecated, reason = "get_recent_activity_handler")]
        get(get_recent_activity::get_recent_activity_handler),
    )
}
