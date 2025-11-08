//! API layer response types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::shared::{DataType, EntityType, PropertyOwner};

// ===== Property Definition Responses =====

/// Property definition response (API representation).
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDefinitionResponse {
    pub id: Uuid,
    #[serde(flatten)]
    pub owner: PropertyOwner,
    pub display_name: String,
    pub data_type: DataType,
    pub is_multi_select: bool,
    pub specific_entity_type: Option<EntityType>,
    /// Flag to indicate if this is a system-generated metadata property
    pub is_metadata: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

/// Property definition with options response.
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyDefinitionWithOptionsResponse {
    pub definition: PropertyDefinitionResponse,
    pub property_options: Vec<PropertyOptionResponse>,
}

// ===== Property Option Responses =====

/// The value of a property option - either a string or a number.
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum PropertyOptionValue {
    /// String value for SelectString properties
    String(String),
    /// Number value for SelectNumber properties
    Number(f64),
}

/// Property option response (API representation).
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyOptionResponse {
    pub id: Uuid,
    pub property_definition_id: Uuid,
    pub display_order: i32,
    pub value: PropertyOptionValue,
}

// ===== Entity Property Responses =====

/// Entity property response (API representation).
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPropertyResponse {
    pub id: Uuid,
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
}

// ===== Entity Property Value Responses =====

/// Property value that matches JSONB structure - supports single or multi-select.
/// Uses serde's tag/content pattern to create discriminated unions.
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum PropertyValue {
    /// Boolean value
    /// Serializes as: {"type": "Boolean", "value": true}
    #[serde(rename = "Boolean")]
    Bool(bool),
    /// Numeric value
    /// Serializes as: {"type": "Number", "value": 42.5}
    #[serde(rename = "Number")]
    Num(f64),
    /// String value
    /// Serializes as: {"type": "String", "value": "text"}
    #[serde(rename = "String")]
    Str(String),
    /// Date/timestamp value
    /// Serializes as: {"type": "Date", "value": "2025-01-01T00:00:00Z"}
    Date(DateTime<Utc>),
    /// Select option(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "SelectOption", "value": ["uuid"]} (length 0 or 1)
    /// Multi-select: {"type": "SelectOption", "value": ["uuid1", "uuid2", ...]} (length 0+)
    SelectOption(Vec<Uuid>),
    /// Entity reference(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "EntityReference", "value": [{...}]} (length 0 or 1)
    /// Multi-select: {"type": "EntityReference", "value": [{...}, {...}, ...]} (length 0+)
    #[serde(rename = "EntityReference")]
    EntityRef(Vec<crate::shared::EntityReference>),
    /// Link value(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "Link", "value": ["https://example.com"]} (length 0 or 1)
    /// Multi-select: {"type": "Link", "value": ["https://example.com", "https://other.com"]} (length 0+)
    Link(Vec<String>),
}

// ===== Composite Responses =====

/// Entity property with definition response (API representation).
#[derive(ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPropertyWithDefinitionResponse {
    pub property: EntityPropertyResponse,
    pub definition: PropertyDefinitionResponse,
    pub value: Option<PropertyValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<PropertyOptionResponse>>,
}

/// Response for entity properties endpoint.
#[derive(ToSchema, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPropertiesResponse {
    pub entity_id: String,
    pub properties: Vec<EntityPropertyWithDefinitionResponse>,
}

/// Response for bulk entity properties endpoint.
pub type BulkEntityPropertiesResponse = HashMap<String, EntityPropertiesResponse>;
