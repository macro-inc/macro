use axum::Router;
use axum::routing::get;
use tower::ServiceBuilder;

use crate::api::ApiContext;

pub(crate) mod get;
pub(crate) mod get_document_id;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    // The attachment download unions across the caller's inboxes: it resolves the
    // owning inbox (and that inbox's Gmail token) itself, so it carries neither
    // the single-inbox link middleware nor the primary-inbox token middleware.
    let union_read_routes = Router::new().route("/{id}", get(get::handler));

    let single_inbox_routes = Router::new()
        .route("/{id}/document_id", get(get_document_id::handler))
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn_with_state(
                    state.email_service.clone(),
                    crate::api::middleware::link::attach_link_context,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state.clone(),
                    crate::api::middleware::gmail_token::attach_gmail_token,
                )),
        );

    Router::new()
        .merge(union_read_routes)
        .merge(single_inbox_routes)
}
