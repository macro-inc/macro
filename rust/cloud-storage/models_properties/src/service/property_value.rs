//! Service layer property value model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::shared::EntityReference;

/// Property value (service representation).
///
/// Represents the actual value stored for an entity property.
/// This is serialized to/from JSONB in the database.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema, PartialEq)]
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
    EntityRef(Vec<EntityReference>),
    /// Link value(s) - always an array (check is_multi_select to determine if single or multi)
    /// Single-select: {"type": "Link", "value": ["https://example.com"]} (length 0 or 1)
    /// Multi-select: {"type": "Link", "value": ["https://example.com", "https://other.com"]} (length 0+)
    Link(Vec<String>),
}

// ===== Conversions =====

impl From<PropertyValue> for crate::api::PropertyValue {
    fn from(svc: PropertyValue) -> Self {
        match svc {
            PropertyValue::Bool(v) => crate::api::PropertyValue::Bool(v),
            PropertyValue::Num(v) => crate::api::PropertyValue::Num(v),
            PropertyValue::Str(v) => crate::api::PropertyValue::Str(v),
            PropertyValue::Date(v) => crate::api::PropertyValue::Date(v),
            PropertyValue::SelectOption(v) => crate::api::PropertyValue::SelectOption(v),
            PropertyValue::EntityRef(v) => crate::api::PropertyValue::EntityRef(v),
            PropertyValue::Link(v) => crate::api::PropertyValue::Link(v),
        }
    }
}

impl From<crate::api::PropertyValue> for PropertyValue {
    fn from(api: crate::api::PropertyValue) -> Self {
        match api {
            crate::api::PropertyValue::Bool(v) => PropertyValue::Bool(v),
            crate::api::PropertyValue::Num(v) => PropertyValue::Num(v),
            crate::api::PropertyValue::Str(v) => PropertyValue::Str(v),
            crate::api::PropertyValue::Date(v) => PropertyValue::Date(v),
            crate::api::PropertyValue::SelectOption(v) => PropertyValue::SelectOption(v),
            crate::api::PropertyValue::EntityRef(v) => PropertyValue::EntityRef(v),
            crate::api::PropertyValue::Link(v) => PropertyValue::Link(v),
        }
    }
}
