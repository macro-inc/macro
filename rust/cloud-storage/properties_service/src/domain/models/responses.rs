//! Domain response models for property operations

use super::{
    EntityPropertyWithDefinition, PropertyDefinition, PropertyOption, PropertyWithOptions,
};
use std::collections::HashMap;

// ===== Property Definition Responses =====

#[derive(Debug, Clone)]
pub struct CreatePropertyResponse {}

#[derive(Debug, Clone)]
pub struct CreatePropertyWithOptionsResponse {}

#[derive(Debug, Clone)]
pub struct ListPropertiesResponse {
    pub properties: Vec<PropertyWithOptions>,
}

#[derive(Debug, Clone)]
pub struct DeletePropertyResponse {}

// ===== Property Option Responses =====

#[derive(Debug, Clone)]
pub struct CreateOptionResponse {}

#[derive(Debug, Clone)]
pub struct GetOptionsResponse {
    pub options: Vec<PropertyOption>,
}

#[derive(Debug, Clone)]
pub struct DeleteOptionResponse {}

// ===== Entity Property Responses =====

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
    pub results: HashMap<String, GetEntityPropertiesResponse>,
}
