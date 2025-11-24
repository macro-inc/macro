pub(crate) mod archived;
pub(crate) mod get;
pub(crate) mod previews;
pub(crate) mod seen;

use axum::Router;
use axum::routing::{get, patch, post};
use tower::ServiceBuilder;

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .nest(
            "/previews",
            previews::router(state.email_cursor_service.clone(), state.clone()),
        )
        .route(
            "/:id",
            get(get::get_thread_handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::api::middleware::link::attach_link_context,
            )),
        )
        .route(
            "/:id/seen",
            post(seen::seen_handler)
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::gmail_token::attach_gmail_token,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::link::attach_link_context,
                )),
        )
        .route(
            "/:id/messages",
            get(get::get_thread_messages_handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::api::middleware::link::attach_link_context,
            )),
        )
        .route(
            "/:id/archived",
            patch(archived::archived_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::api::middleware::gmail_token::attach_gmail_token,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::api::middleware::link::attach_link_context,
                    )),
            ),
        )
}
