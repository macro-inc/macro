//! Domain response models for property operations

use super::{EntityProperty, PropertyDefinition, PropertyOption, PropertyValue};

// ===== Property Definition Responses =====

#[derive(Debug, Clone)]
pub struct CreatePropertyResponse {
    pub property: PropertyDefinition,
}

#[derive(Debug, Clone)]
pub struct CreatePropertyWithOptionsResponse {
    pub property: PropertyDefinition,
}

#[derive(Debug, Clone)]
pub struct ListPropertiesResponse {
    pub properties: Vec<PropertyDefinition>,
}

#[derive(Debug, Clone)]
pub struct DeletePropertyResponse {}

// ===== Property Option Responses =====

#[derive(Debug, Clone)]
pub struct CreateOptionResponse {
    pub option: PropertyOption,
}

#[derive(Debug, Clone)]
pub struct GetOptionsResponse {
    pub options: Vec<PropertyOption>,
}

#[derive(Debug, Clone)]
pub struct DeleteOptionResponse {}

// ===== Entity Property Responses =====

/// Entity property with its definition and optional value/options
/// Used for rich entity property queries
#[derive(Debug, Clone)]
pub struct EntityPropertyWithDefinition {
    pub property: EntityProperty,
    pub definition: PropertyDefinition,
    pub value: Option<PropertyValue>,
    pub options: Option<Vec<PropertyOption>>,
}

#[derive(Debug, Clone)]
pub struct GetEntityPropertiesResponse {
    pub entity_id: String,
    pub properties: Vec<EntityPropertyWithDefinition>,
}

#[derive(Debug, Clone)]
pub struct SetEntityPropertyResponse {}

#[derive(Debug, Clone)]
pub struct DeleteEntityPropertyResponse {}

// ===== Bulk/Internal Responses =====

#[derive(Debug, Clone)]
pub struct DeleteAllEntityPropertiesResponse {}

#[derive(Debug, Clone)]
pub struct GetBulkEntityPropertiesResponse {
    pub results: Vec<(String, Vec<EntityPropertyWithDefinition>)>,
}
