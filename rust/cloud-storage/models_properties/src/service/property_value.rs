//! Service layer property value model.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing;
use uuid::Uuid;

use crate::api::requests::SetPropertyValue;
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

/// Convert SetPropertyValue (API request format) to PropertyValue (storage format).
///
/// This function handles the conversion from the API's single/multi variants
/// to the storage format's array-based representation, including deduplication
/// for multi-value types.
pub fn convert_set_property_value_to_property_value(value: &SetPropertyValue) -> PropertyValue {
    match value {
        // Single primitive values
        SetPropertyValue::Boolean { value } => PropertyValue::Bool(*value),
        SetPropertyValue::Date { value } => PropertyValue::Date(*value),
        SetPropertyValue::Number { value } => PropertyValue::Num(*value),
        SetPropertyValue::String { value } => PropertyValue::Str(value.clone()),

        // Single select option
        SetPropertyValue::SelectOption { option_id } => {
            PropertyValue::SelectOption(vec![*option_id])
        }

        // Multi-select options
        SetPropertyValue::MultiSelectOption { option_ids } => {
            let original_count = option_ids.len();
            let unique_ids: HashSet<Uuid> = option_ids.iter().copied().collect();

            if unique_ids.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_ids.len(),
                    "Duplicate option IDs detected in MultiSelectOption, deduplicating"
                );
            }

            PropertyValue::SelectOption(unique_ids.into_iter().collect())
        }

        // Single entity reference
        SetPropertyValue::EntityReference { reference } => {
            PropertyValue::EntityRef(vec![EntityReference {
                entity_type: reference.entity_type,
                entity_id: reference.entity_id.clone(),
                specific_message_id: reference.specific_message_id,
            }])
        }

        // Multi-entity references
        SetPropertyValue::MultiEntityReference { references } => {
            let original_count = references.len();

            let mut seen_ids: HashSet<String> = HashSet::new();
            let unique_refs: Vec<EntityReference> = references
                .iter()
                .filter(|ref_| seen_ids.insert(ref_.entity_id.clone()))
                .map(|ref_| EntityReference {
                    entity_type: ref_.entity_type,
                    entity_id: ref_.entity_id.clone(),
                    specific_message_id: ref_.specific_message_id,
                })
                .collect();

            if unique_refs.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_refs.len(),
                    "Duplicate entity references detected in MultiEntityReference, deduplicating by entity_id"
                );
            }

            PropertyValue::EntityRef(unique_refs)
        }

        // Single link
        SetPropertyValue::Link { url } => PropertyValue::Link(vec![url.clone()]),

        // Multi-link
        SetPropertyValue::MultiLink { urls } => {
            let original_count = urls.len();
            let unique_urls: HashSet<String> = urls.iter().cloned().collect();

            if unique_urls.len() < original_count {
                tracing::warn!(
                    original_count = original_count,
                    unique_count = unique_urls.len(),
                    "Duplicate URLs detected in MultiLink, deduplicating"
                );
            }

            PropertyValue::Link(unique_urls.into_iter().collect())
        }
    }
}
