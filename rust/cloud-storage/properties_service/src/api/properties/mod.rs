use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, put},
};

pub mod definitions;
pub mod entities;
pub mod metadata;
pub mod options;

pub fn router() -> Router<ApiContext> {
    Router::new()
        // Property Definition Management - Unified endpoint with query params
        .route(
            "/definitions",
            get(definitions::list::list_properties)
                .post(definitions::create::create_property_definition),
        )
        .route(
            "/definitions/:definition_id",
            delete(definitions::delete::delete_property_definition),
        )
        // Property Options Management
        .route(
            "/definitions/:definition_id/options",
            get(options::get::get_property_options).post(options::create::add_property_option),
        )
        .route(
            "/definitions/:definition_id/options/:option_id",
            delete(options::delete::delete_property_option),
        )
        // Entity Property Operations
        .route(
            "/entities/:entity_type/:entity_id",
            get(entities::get::get_entity_properties),
        )
        .route(
            "/entities/:entity_type/:entity_id/:property_id",
            put(entities::set::set_entity_property),
        )
        .route(
            "/entity_properties/:entity_property_id",
            delete(entities::delete_property::delete_entity_property),
        )
}
