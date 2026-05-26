pub mod create;
pub mod delete;

use axum::Router;
use axum::routing::{delete, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let hex_list_labels_routes = email::inbound::axum::list_labels_router::list_labels_router::<
        ApiContext,
        crate::api::context::EmailSvc,
    >();

    Router::new()
        .route(
            "/",
            post(create::handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::api::middleware::gmail_token::attach_gmail_token,
            )),
        )
        .route("/{id}", delete(delete::handler))
        .layer(axum::middleware::from_fn_with_state(
            state.email_service,
            crate::api::middleware::link::attach_link_context,
        ))
        .merge(hex_list_labels_routes)
}
