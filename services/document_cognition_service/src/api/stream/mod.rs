//! HTTP endpoints for streaming responses via the stream service.
//!
//! These endpoints replace the WebSocket-based streaming with HTTP POST requests
//! that publish to a durable stream. The connection_gateway handles delivery to clients.

pub mod chat_message;
pub mod stop;
mod util;

use axum::{Router, routing::post};

use crate::api::context::ApiContext;

/// Create the stream API router
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/chat/message", post(chat_message::send_chat_message))
        .route("/chat/message/stop", post(stop::stop_chat_stream))
        .layer(axum::middleware::from_fn(chat_message::attach_bearer_token))
}
