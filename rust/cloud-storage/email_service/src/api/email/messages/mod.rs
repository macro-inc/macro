pub(crate) mod get;
pub(crate) mod labels;

use axum::Router;
use axum::routing::{get, patch, post};
use email::inbound::axum::send_router::send_router;

use crate::api::ApiContext;

const BATCH_UPDATE_MESSAGE_LIMIT: usize = 10;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    // Mutating routes operate on exactly one inbox, resolved by the
    // X-Email-Link-Id header (or the primary inbox) via attach_link_context.
    let single_inbox_routes = Router::new()
        .merge(send_router(state.email_service.clone()))
        .route("/labels", patch(labels::handler))
        .layer(axum::middleware::from_fn_with_state(
            state.email_service,
            crate::api::middleware::link::attach_link_context,
        ));

    // Read routes union across every inbox the caller owns and resolve their own
    // link set, so they must not carry the single-inbox middleware.
    let union_read_routes = Router::new()
        .route("/batch", post(get::batch_handler))
        .route("/{id}", get(get::handler));

    Router::new()
        .merge(single_inbox_routes)
        .merge(union_read_routes)
}
