use crate::api::context::PropertiesHandlerState;
use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};

pub mod definitions;
pub mod entities;
pub mod metadata;
pub mod options;

/// Creates the properties router. Works with any state type that implements `FromRef<PropertiesHandlerState>`.
pub fn router() -> Router<PropertiesHandlerState> {
    let ensure_user_exists =
        axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler);

    Router::new()
        // Property Definition Management - requires authentication
        .route(
            "/definitions",
            get(definitions::list::list_properties)
                .post(definitions::create::create_property_definition)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/definitions/:definition_id",
            delete(definitions::delete::delete_property_definition)
                .layer(ensure_user_exists.clone()),
        )
        // Property Options Management - requires authentication
        .route(
            "/definitions/:definition_id/options",
            get(options::get::get_property_options)
                .post(options::create::add_property_option)
                .layer(ensure_user_exists.clone()),
        )
        .route(
            "/definitions/:definition_id/options/:option_id",
            delete(options::delete::delete_property_option).layer(ensure_user_exists.clone()),
        )
        // Entity Property Operations
        // GET allows anonymous access for public entities
        .route(
            "/entities/:entity_type/:entity_id",
            get(entities::get::get_entity_properties),
        )
        // Bulk entity properties - requires authentication
        .route(
            "/entities/bulk",
            post(entities::get_bulk::get_bulk_entity_properties).layer(ensure_user_exists.clone()),
        )
        // PUT/DELETE require authentication
        .route(
            "/entities/:entity_type/:entity_id/:property_id",
            put(entities::set::set_entity_property).layer(ensure_user_exists.clone()),
        )
        .route(
            "/entity_properties/:entity_property_id",
            delete(entities::delete_property::delete_entity_property)
                .layer(ensure_user_exists.clone()),
        )
        // Status shortcut - requires authentication
        .route(
            "/entities/:entity_type/:entity_id/status/complete",
            patch(entities::set_property_status_complete::set_property_status_complete)
                .layer(ensure_user_exists),
        )
}
