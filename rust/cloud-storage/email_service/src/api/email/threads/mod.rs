pub(crate) mod archived;
pub(crate) mod get;
pub(crate) mod seen;

use axum::Router;
use axum::routing::{get, patch, post};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let required_link_routes = Router::new()
        .nest(
            "/previews",
            email::inbound::axum::previews_router::router(state.email_service.clone()),
        )
        .route("/{id}/seen", post(seen::seen_handler))
        .route("/{id}/messages", get(get::get_thread_messages_handler))
        .route("/{id}/archived", patch(archived::archived_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.email_service.clone(),
            crate::api::middleware::link::attach_link_context,
        ));

    let hex_thread_routes =
        email::inbound::axum::get_thread_router::thread_router(state.email_thread_state.clone());

    let hex_thread_labels_routes = email::inbound::axum::thread_labels_router::thread_labels_router::<
        ApiContext,
        crate::api::context::EmailSvc,
        email::outbound::GmailTokenProviderImpl,
    >();

    let hex_thread_project_routes =
        email::inbound::axum::thread_project_router::thread_project_router(
            state.email_thread_state.clone(),
        );

    Router::new()
        .merge(required_link_routes)
        .merge(hex_thread_routes)
        .merge(hex_thread_labels_routes)
        .merge(hex_thread_project_routes)
}
