//! HTTP endpoints for legacy AI chat streams.
//!
//! Sending is retired (legacy chats are read-only); stopping a stream that is
//! still running remains.

pub mod chat_message;
pub mod stop;
mod util;

use axum::{Router, routing::post};

use crate::cognition::api::context::ApiContext;

/// Create the stream API router
pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/chat/message", post(chat_message::send_chat_message))
        .route("/chat/message/stop", post(stop::stop_chat_stream))
}
