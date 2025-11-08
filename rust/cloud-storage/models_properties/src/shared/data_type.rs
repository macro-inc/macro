//! Data type shared across database, service, and API layers.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Data type for property values, determining storage and validation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, sqlx::Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[sqlx(type_name = "property_data_type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DataType {
    /// Boolean true/false values.
    Boolean,
    /// Date and time values.
    Date,
    /// Numeric values.
    Number,
    /// String/text values.
    String,
    /// Select property with numeric options.
    SelectNumber,
    /// Select property with string options.
    SelectString,
    /// Entity reference property.
    Entity,
    /// Link value Property.
    Link,
}
