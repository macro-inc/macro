use crate::api::ApiContext;
use axum::Router;
use axum::routing::{get, post};
use tower::ServiceBuilder;

pub(crate) mod block_sender;
pub(crate) mod list;
pub(crate) mod list_blocked;
pub(crate) mod unblock_sender;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", get(list::list_contacts_handler))
        .route(
            "/block",
            post(block_sender::handler).layer(axum::middleware::from_fn_with_state(
                state.email_service.clone(),
                crate::api::middleware::link::attach_link_context,
            )),
        )
        .route(
            "/unblock",
            post(unblock_sender::handler).layer(axum::middleware::from_fn_with_state(
                state.email_service.clone(),
                crate::api::middleware::link::attach_link_context,
            )),
        )
        .route(
            "/blocked",
            get(list_blocked::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state,
                    crate::api::middleware::gmail_token::attach_gmail_token,
                ),
            )),
        )
}
