use crate::api::context::ApiContext;
use axum::{Router, routing::get};
use tower::ServiceBuilder;

pub(in crate::api) mod get_recent_activity;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/",
        #[expect(deprecated, reason = "get_recent_activity_handler")]
        get(get_recent_activity::get_recent_activity_handler).layer(ServiceBuilder::new().layer(
            axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
        )),
    )
}
