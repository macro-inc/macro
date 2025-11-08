//! Service layer property option model.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The value of a property option - either a string or a number.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum PropertyOptionValue {
    /// String value for SelectString properties
    String(String),
    /// Number value for SelectNumber properties
    Number(f64),
}

impl PropertyOptionValue {
    /// Get as string if this is a string value
    pub fn as_string(&self) -> Option<&str> {
        match self {
            PropertyOptionValue::String(s) => Some(s),
            _ => None,
        }
    }

    /// Get as number if this is a number value
    pub fn as_number(&self) -> Option<f64> {
        match self {
            PropertyOptionValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// Convert to database representation (number_value, string_value)
    pub fn to_db_values(&self) -> (Option<f64>, Option<String>) {
        match self {
            PropertyOptionValue::Number(n) => (Some(*n), None),
            PropertyOptionValue::String(s) => (None, Some(s.clone())),
        }
    }
}

/// A selectable option for select-type properties (service representation).
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PropertyOption {
    pub id: Uuid,
    pub property_definition_id: Uuid,
    pub display_order: i32,
    pub value: PropertyOptionValue,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ===== Conversions =====

impl From<PropertyOptionValue> for crate::api::PropertyOptionValue {
    fn from(svc: PropertyOptionValue) -> Self {
        match svc {
            PropertyOptionValue::String(s) => crate::api::PropertyOptionValue::String(s),
            PropertyOptionValue::Number(n) => crate::api::PropertyOptionValue::Number(n),
        }
    }
}

impl From<PropertyOption> for crate::api::PropertyOptionResponse {
    fn from(svc: PropertyOption) -> Self {
        Self {
            id: svc.id,
            property_definition_id: svc.property_definition_id,
            display_order: svc.display_order,
            value: svc.value.into(),
        }
    }
}
