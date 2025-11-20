use models_properties::api;
use properties_service::inbound::http;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        // Property definitions
        http::create_property_definition,
        // TODO: Implement remaining handlers
        // list_property_definitions,
        // get_property_definition,
        // delete_property_definition,
        // // Property options
        // get_property_options,
        // create_property_option,
        // delete_property_option,
        // // Entity properties
        // get_entity_properties,
        // set_entity_property,
        // delete_entity_property,
    ),
    components(
        schemas(
            api::CreatePropertyDefinitionRequest,
            api::PropertyDataType,
            api::SelectStringOption,
            api::SelectNumberOption,
            api::PropertyDefinitionWithOptionsResponse,
            api::EntityPropertiesResponse,
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
            api::EntityQueryParams,
            api::BulkEntityQueryParams,
            api::BulkEntityPropertiesResponse,
        )
    ),
    tags(
        (name = "properties service", description = "Macro Properties Service")
    )
)]
pub struct ApiDoc;
