use crate::api::properties::{
    definitions::{ListPropertiesQuery, PropertyDefinitionResponse},
    entities::{
        EntityPropertiesResponse, EntityQueryParams, SetEntityPropertyRequest,
        types::BulkEntityPropertiesRequest,
    },
};
use models_properties::api;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        // Property definitions
        crate::api::properties::definitions::list::list_properties,
        crate::api::properties::definitions::create::create_property_definition,
        crate::api::properties::definitions::delete::delete_property_definition,
        // Property options
        crate::api::properties::options::get::get_property_options,
        crate::api::properties::options::create::add_property_option,
        crate::api::properties::options::delete::delete_property_option,
        // Entity properties
        crate::api::properties::entities::get::get_entity_properties,
        crate::api::properties::entities::set::set_entity_property,
        crate::api::properties::entities::delete_property::delete_entity_property,
    ),
    components(
        schemas(
            api::CreatePropertyDefinitionRequest,
            api::PropertyDataType,
            api::SelectStringOption,
            api::SelectNumberOption,
            ListPropertiesQuery,
            PropertyDefinitionResponse,
            api::PropertyDefinitionWithOptionsResponse,
            EntityPropertiesResponse,
            SetEntityPropertyRequest,
            EntityQueryParams,
            BulkEntityPropertiesRequest,
            api::SetPropertyValue,
            models_properties::EntityReference,
            api::AddPropertyOptionRequest,
            api::AddStringOptionRequest,
            api::AddNumberOptionRequest,
            api::PropertyDefinitionResponse,
            api::PropertyOptionResponse,
            models_properties::EntityType,
            models_properties::DataType,
            api::EntityPropertyWithDefinitionResponse,
            api::PropertyValue,
        )
    ),
    tags(
        (name = "properties service", description = "Macro Properties Service")
    )
)]
pub struct ApiDoc;
