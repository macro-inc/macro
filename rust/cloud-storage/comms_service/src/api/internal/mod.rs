use axum::middleware::from_fn_with_state;
use axum::routing::{get, post};
pub mod check_channels_for_user;
mod create_welcome_message;
pub mod get_channel_mentions;
mod get_channels_history;
mod get_user_channel_ids;

use crate::api::context::AppState;
use crate::api::middleware;
use axum::Router;
use macro_axum_utils::compose_layers;
use macro_middleware::auth;

pub fn router(app_state: AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/check_channels_for_user",
            post(check_channels_for_user::handler),
        )
        .route(
            "/get_channel_mentions/:item_id/:item_type",
            get(get_channel_mentions::handler),
        )
        .route(
            "/create_welcome_message",
            post(create_welcome_message::handler),
        )
        .route("/get_channels_history", post(get_channels_history::handler))
        .route(
            "/user_channels/:user_id",
            get(get_user_channel_ids::handler),
        )
        .route("/health", get(async move || "healthy"))
        .layer(compose_layers![
            from_fn_with_state(app_state.clone(), auth::internal_access::handler),
            from_fn_with_state(app_state.clone(), middleware::connection_drop_prevention,),
        ])
        .with_state(app_state)
}
