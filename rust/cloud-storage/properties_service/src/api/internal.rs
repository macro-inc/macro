use crate::api::context::ApiContext;
use crate::api::properties::entities;
use axum::{Router, routing::delete};

/// Internal routes. All routes are authenticated via the internal_access middleware.
/// These routes are not part of the public Swagger documentation.
pub fn router() -> Router<ApiContext> {
    Router::new()
        // Internal-only: Delete all properties for an entity
        .route(
            "/properties/:entity_type/entities/:entity_id",
            delete(entities::delete_entity::delete_entity),
        )
        // Bulk operations (POST with body)
        .route(
            "/properties/entities/bulk",
            axum::routing::post(entities::get_bulk::get_bulk_entity_properties),
        )
}
