use crate::api::ApiContext;
use crate::api::email::sync::disable::disable_handler;
use axum::Router;
use axum::routing::delete;

pub(crate) mod disable;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/",
        delete(disable_handler).layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        )),
    )
}
