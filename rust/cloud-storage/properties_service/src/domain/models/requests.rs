//! Domain request models for property operations

use super::{DataType, EntityType, PropertyOptionValue, PropertyOwner, PropertyValue};
use uuid::Uuid;

// ===== Property Definition Requests =====

#[derive(Debug, Clone)]
pub struct CreatePropertyRequest {
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
}

/// Request to create a property with options (for select types)
#[derive(Debug, Clone)]
pub struct CreatePropertyWithOptionsRequest {
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
    pub options: Vec<(PropertyOptionValue, i32)>, // (value, display_order)
}

#[derive(Debug, Clone)]
pub struct ListPropertiesRequest {
    pub owner: PropertyOwner,
    pub include_options: bool,
}

#[derive(Debug, Clone)]
pub struct DeletePropertyRequest {
    pub owner: PropertyOwner,
    pub property_id: Uuid,
}

// ===== Property Option Requests =====

#[derive(Debug, Clone)]
pub struct CreateOptionRequest {
    pub property_definition_id: Uuid,
    pub value: PropertyOptionValue,
    pub display_order: i32,
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
    pub include_metadata: bool,
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
