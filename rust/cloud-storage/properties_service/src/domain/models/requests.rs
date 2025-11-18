//! Domain request models for property operations

use super::{EntityType, PropertyDefinition, PropertyOption, PropertyValue};
use uuid::Uuid;

// ===== Property Definition Requests =====

#[derive(Debug, Clone)]
pub struct CreatePropertyRequest {
    pub user_id: String,
    pub definition: PropertyDefinition,
}

#[derive(Debug, Clone)]
pub struct CreatePropertyWithOptionsRequest {
    pub user_id: String,
    pub definition: PropertyDefinition,
    pub options: Vec<PropertyOption>,
}

#[derive(Debug, Clone)]
pub struct ListPropertiesRequest {
    pub organization_id: Option<i32>,
    pub user_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DeletePropertyRequest {
    pub user_id: String,
    pub organization_id: Option<i32>,
    pub property_id: Uuid,
}

// ===== Property Option Requests =====

#[derive(Debug, Clone)]
pub struct CreateOptionRequest {
    pub property_definition_id: Uuid,
    pub option: PropertyOption,
}

#[derive(Debug, Clone)]
pub struct GetOptionsRequest {
    pub property_definition_id: Uuid,
}

#[derive(Debug, Clone)]
pub struct DeleteOptionRequest {
    pub property_definition_id: Uuid,
    pub option_id: Uuid,
}

// ===== Entity Property Requests =====

#[derive(Debug, Clone)]
pub struct GetEntityPropertiesRequest {
    pub user_id: String,
    pub entity_id: String,
    pub entity_type: EntityType,
}

#[derive(Debug, Clone)]
pub struct SetEntityPropertyRequest {
    pub user_id: String,
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    pub value: Option<PropertyValue>,
}

#[derive(Debug, Clone)]
pub struct DeleteEntityPropertyRequest {
    pub user_id: String,
    pub entity_property_id: Uuid,
}

// ===== Bulk/Internal Requests =====

#[derive(Debug, Clone)]
pub struct DeleteAllEntityPropertiesRequest {
    pub entity_id: String,
    pub entity_type: EntityType,
}

#[derive(Debug, Clone)]
pub struct GetBulkEntityPropertiesRequest {
    pub entity_refs: Vec<(String, EntityType)>,
}
