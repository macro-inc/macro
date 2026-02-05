pub mod get_entity_permission;
pub mod update_user_channel_permissions;

use axum::{Router, routing::get};
use crate::api::context::ApiContext;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/{entity_type}/{entity_id}/permissions",
        get(get_entity_permission::handler),
    )
}
