//! Database errors for properties operations

use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur during database operations
#[derive(Debug, Error)]
pub enum PropertiesDatabaseError {
    #[error(
        "Invalid property options: {provided} provided, only {valid} belong to property {property_id}"
    )]
    InvalidPropertyOptions {
        provided: usize,
        valid: i64,
        property_id: Uuid,
    },

    #[error("Either organization_id or user_id is required when creating property definitions")]
    MissingOwner,

    #[error("Failed to serialize property value to JSON: {0}")]
    SerializationError(#[source] serde_json::Error),

    #[error("Failed to deserialize property value from JSONB: {0}")]
    DeserializationError(#[source] serde_json::Error),

    #[error("Database conversion error: {0}")]
    Conversion(#[from] models_properties::db::DbConversionError),

    #[error("Query error: {0}")]
    Query(#[from] sqlx::Error),
}
