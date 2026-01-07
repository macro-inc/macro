use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use macro_axum_utils::compose_layers;

pub mod add_participants;
pub mod create_channel;
pub mod delete_channel;
pub mod delete_message;
pub mod get_channel;
pub mod get_channel_metadata;
pub mod get_channel_transcript;
pub mod get_channels;
pub mod get_mentions;
pub mod get_message_with_context;
pub mod get_or_create_dm;
pub mod get_or_create_private;
pub mod join_channel;
pub mod leave_channel;
pub mod patch_channel;
pub mod patch_message;
pub mod post_message;
pub mod post_reaction;
pub mod post_typing;
pub mod remove_participants;
use crate::api::context::AppState;

use tower_http::compression::CompressionLayer;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", post(create_channel::create_channel_handler))
        .route(
            "/",
            get(get_channels::get_channels_handler).layer(CompressionLayer::new()),
        )
        .route(
            "/:channel_id",
            get(get_channel::get_channel_handler).layer(compose_layers![CompressionLayer::new(),]),
        )
        .route(
            "/:channel_id",
            delete(delete_channel::delete_channel_handler),
        )
        .route("/:channel_id", patch(patch_channel::patch_channel_handler))
        .route(
            "/:channel_id/message",
            post(post_message::post_message_handler),
        )
        .route(
            "/:channel_id/typing",
            post(post_typing::post_typing_handler),
        )
        .route(
            "/:channel_id/reaction",
            post(post_reaction::post_reaction_handler),
        )
        .route(
            "/:channel_id/message/:message_id",
            patch(patch_message::patch_message_handler),
        )
        .route(
            "/:channel_id/message/:message_id",
            delete(delete_message::delete_message_handler),
        )
        .route(
            "/:channel_id/join",
            post(join_channel::join_channel_handler),
        )
        .route(
            "/:channel_id/leave",
            post(leave_channel::leave_channel_handler),
        )
        .route("/:channel_id/participants", post(add_participants::handler))
        .route(
            "/:channel_id/participants",
            delete(remove_participants::handler),
        )
        .route("/get_or_create_dm", post(get_or_create_dm::handler))
        .route(
            "/get_or_create_private",
            post(get_or_create_private::handler),
        )
        .route("/:channel_id/mentions", get(get_mentions::handler))
        .route(
            "/:channel_id/metadata",
            get(get_channel_metadata::handler_external),
        )
        .route(
            "/:channel_id/transcript",
            get(get_channel_transcript::handler_external),
        )
        .route("/messages/context", get(get_message_with_context::handler))
}
