use crate::api::ApiContext;
use crate::api::email::sync::disable::disable_handler;
use crate::api::email::sync::enable::enable_handler;
use axum::Router;
use axum::routing::{delete, post};
use tower::ServiceBuilder;

pub(crate) mod disable;
pub(crate) mod enable;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route("/", post(enable_handler)).route(
        "/",
        delete(disable_handler).layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::gmail_token::attach_gmail_token,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.email_service,
                    crate::api::middleware::link::attach_link_context,
                )),
        ),
    )
}
