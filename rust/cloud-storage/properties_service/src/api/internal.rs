use crate::api::context::PropertiesHandlerState;
use crate::api::properties::entities;
use axum::{Router, routing::delete};

/// Internal routes. All routes are authenticated via the internal_access middleware.
/// These routes are not part of the public Swagger documentation.
/// Works with any state type that implements `FromRef<PropertiesHandlerState>`.
pub fn router() -> Router<PropertiesHandlerState> {
    Router::new()
        // Internal-only: Delete all properties for an entity
        .route(
            "/properties/entities/:entity_type/:entity_id",
            delete(entities::delete_entity::delete_entity),
        )
        // Bulk operations (POST with body)
        .route(
            "/properties/entities/bulk",
            axum::routing::post(entities::get_bulk::get_bulk_entity_properties_internal),
        )
}
