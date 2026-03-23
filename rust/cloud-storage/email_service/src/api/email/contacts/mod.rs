use crate::api::ApiContext;
use axum::Router;
use axum::routing::{delete, get, post};
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
            post(block_sender::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::gmail_token::attach_gmail_token,
                ),
            )),
        )
        .route(
            "/block/{email_address}",
            delete(unblock_sender::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::gmail_token::attach_gmail_token,
                ),
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
