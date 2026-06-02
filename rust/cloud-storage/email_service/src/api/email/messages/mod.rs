pub(crate) mod get;
pub(crate) mod labels;

use axum::Router;
use axum::routing::{get, patch, post};
use email::inbound::axum::send_router::send_router;

use crate::api::ApiContext;

const BATCH_UPDATE_MESSAGE_LIMIT: usize = 10;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    // Every route resolves its own inbox — send via EmailLinkExtractor, label
    // batch from the messages, and the reads union across the caller's inboxes —
    // so none carry the single-inbox X-Email-Link-Id middleware.
    Router::new()
        .merge(send_router(state.email_service.clone()))
        .route("/labels", patch(labels::handler))
        .route("/batch", post(get::batch_handler))
        .route("/{id}", get(get::handler))
}
