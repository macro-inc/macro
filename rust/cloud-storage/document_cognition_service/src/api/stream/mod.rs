//! HTTP endpoints for streaming responses via the stream service.
//!
//! These endpoints replace the WebSocket-based streaming with HTTP POST requests
//! that publish to a durable stream. The connection_gateway handles delivery to clients.

pub mod chat_message;
pub mod simple_completion;

use axum::{Router, routing::post};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

/// Create the stream API router
pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/chat/message", post(chat_message::send_chat_message))
        .route(
            "/completion/simple",
            post(simple_completion::simple_completion),
        )
        .layer(
            ServiceBuilder::new()
                .layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                ))
                .layer(axum::middleware::from_fn_with_state(
                    state,
                    macro_middleware::user_permissions::attach_user_permissions::handler,
                ))
                .layer(axum::middleware::from_fn(chat_message::attach_bearer_token)),
        )
}
