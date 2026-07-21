use models_properties::api;
use properties::inbound::axum_router::{
    definitions::{ListPropertiesQuery, PropertyDefinitionResponse},
    entities::{
        BulkEntityOptionUpdateResult, BulkEntityOptionUpdateStatus, BulkEntityPropertiesRequest,
        BulkUpdateEntitiesPropertyOptionsRequest, BulkUpdateEntitiesPropertyOptionsResponse,
        BulkUpdateEntityPropertyOptionsRequest, BulkUpdateEntityPropertyOptionsResponse,
        EntityPropertiesResponse, EntityPropertyOptionSelectionResponse,
        EntityPropertyOptionUpdateRequest, EntityQueryParams, SetEntityPropertyRequest,
    },
    tags::{EnsureTagSetRequest, TagScope, TagSetResponse},
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
        // Property definitions
        properties::inbound::axum_router::definitions::list_properties,
        properties::inbound::axum_router::definitions::create_property_definition,
        properties::inbound::axum_router::definitions::delete_property_definition,
        // Property options
        properties::inbound::axum_router::options::get_property_options,
        properties::inbound::axum_router::options::add_property_option,
        properties::inbound::axum_router::options::update_property_option,
        properties::inbound::axum_router::options::delete_property_option,
        properties::inbound::axum_router::tags::list_tags,
        properties::inbound::axum_router::tags::ensure_tag_set,
        // Entity properties
        properties::inbound::axum_router::entities::get_entity_properties,
        properties::inbound::axum_router::entities::get_bulk_entity_properties,
        properties::inbound::axum_router::entities::set_entity_property,
        properties::inbound::axum_router::entities::add_entity_property_option,
        properties::inbound::axum_router::entities::remove_entity_property_option,
        properties::inbound::axum_router::entities::bulk_update_entity_property_options,
        properties::inbound::axum_router::entities::bulk_update_entities_property_options,
        properties::inbound::axum_router::entities::delete_entity_property,
    ),
    components(
        schemas(
            api::CreatePropertyDefinitionRequest,
            api::CreatePropertyScope,
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
            BulkUpdateEntityPropertyOptionsRequest,
            BulkUpdateEntityPropertyOptionsResponse,
            EntityPropertyOptionUpdateRequest,
            EntityPropertyOptionSelectionResponse,
            BulkUpdateEntitiesPropertyOptionsRequest,
            BulkUpdateEntitiesPropertyOptionsResponse,
            BulkEntityOptionUpdateResult,
            BulkEntityOptionUpdateStatus,
            api::SetPropertyValue,
            models_properties::EntityReference,
            api::AddPropertyOptionRequest,
            api::AddStringOptionRequest,
            api::AddNumberOptionRequest,
            api::UpdatePropertyOptionRequest,
            api::PropertyDefinitionDetailResponse,
            api::PropertyOptionResponse,
            models_properties::EntityType,
            models_properties::DataType,
            api::EntityPropertyWithDefinitionResponse,
            api::PropertyValue,
            TagScope,
            TagSetResponse,
            EnsureTagSetRequest,
        )
    ),
    tags(
        (name = "properties service", description = "Macro Properties Service")
    )
)]
pub struct ApiDoc;
