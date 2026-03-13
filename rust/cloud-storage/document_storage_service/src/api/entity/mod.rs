pub mod get_entity_permission;

use crate::api::context::ApiContext;
use axum::{Router, routing::get};

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/{entity_type}/{entity_id}/permissions",
        get(get_entity_permission::handler),
    )
}
