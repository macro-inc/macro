use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, post},
};
// TODO: Implement internal handlers
// use properties_service::inbound::http::{delete_all_entity_properties, get_bulk_entity_properties};

/// Internal routes. All routes are authenticated via the internal_access middleware.
/// These routes are not part of the public Swagger documentation.
pub fn router() -> Router<ApiContext> {
    Router::new()
    // TODO: Implement remaining handlers
    // // Internal-only: Delete all properties for an entity
    // .route(
    //     "/properties/entities/:entity_type/:entity_id",
    //     delete(delete_all_entity_properties),
    // )
    // // Bulk operations (POST with body)
    // .route(
    //     "/properties/entities/bulk",
    //     post(get_bulk_entity_properties),
    // )
}
