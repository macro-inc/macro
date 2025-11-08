pub mod add_user_to_org_channels;
use axum::middleware::from_fn_with_state;
use axum::routing::{delete, get, post};
pub mod check_channels_for_user;
mod create_welcome_message;
mod delete_mentions_by_source;
pub mod get_channel_mentions;
mod get_channel_message;
mod get_channel_participants;
mod get_channels_history;
mod get_user_channel_ids;
pub mod remove_user_from_org_channels;

use crate::api::context::AppState;
use crate::api::middleware;
use axum::Router;
use macro_axum_utils::compose_layers;
use macro_middleware::auth;

pub fn router(app_state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/add_user_to_org_channels",
            post(add_user_to_org_channels::handler),
        )
        .route(
            "/remove_user_from_org_channels",
            post(remove_user_from_org_channels::handler),
        )
        .route(
            "/check_channels_for_user",
            post(check_channels_for_user::handler),
        )
        .route(
            "/get_channel_mentions/:item_id/:item_type",
            get(get_channel_mentions::handler),
        )
        .route(
            "/get_channel_participants/:channel_id",
            get(get_channel_participants::handler),
        )
        .route(
            "/create_welcome_message",
            post(create_welcome_message::handler),
        )
        .route("/get_channels_history", post(get_channels_history::handler))
        .route(
            "/channel/:channel_id/:message_id",
            get(get_channel_message::handler),
        )
        .route(
            "/user_channels/:user_id",
            get(get_user_channel_ids::handler),
        )
        .route(
            "/get_channel_metadata/:channel_id",
            get(crate::api::channels::get_channel_metadata::handler_internal),
        )
        .route(
            "/get_channel_transcript/:channel_id",
            get(crate::api::channels::get_channel_transcript::handler_internal),
        )
        .route(
            "/delete_mentions_by_source",
            delete(delete_mentions_by_source::handler),
        )
        .route("/health", get(async move || "healthy"))
        .layer(compose_layers![
            from_fn_with_state(app_state.clone(), auth::internal_access::handler),
            from_fn_with_state(app_state.clone(), middleware::connection_drop_prevention,),
        ])
        .with_state(app_state)
}
