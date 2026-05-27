//! Domain models for foreign entity records.

use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

/// A persisted mapping to an entity owned by an external system.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForeignEntity {
    /// Internal primary key for this foreign entity record.
    pub id: Uuid,
    /// Identifier assigned by the external system.
    pub foreign_entity_id: String,
    /// Source system that owns the external identifier.
    pub foreign_entity_source: String,
    /// Arbitrary metadata stored with the mapping.
    pub metadata: Value,
    /// Internal entity identifier this foreign entity is stored for.
    pub stored_for_id: String,
    /// Internal auth entity namespace this foreign entity is stored for.
    pub stored_for_auth_entity: String,
    /// Timestamp when the record was created.
    pub created_at: DateTime<Utc>,
    /// Timestamp when the record was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Fields required to create a foreign entity record.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateForeignEntity {
    /// Identifier assigned by the external system.
    pub foreign_entity_id: String,
    /// Source system that owns the external identifier.
    pub foreign_entity_source: String,
    /// Arbitrary metadata to store with the mapping.
    #[serde(default = "default_metadata")]
    pub metadata: Value,
    /// Internal entity identifier this foreign entity is stored for.
    pub stored_for_id: String,
    /// Internal auth entity namespace this foreign entity is stored for.
    pub stored_for_auth_entity: String,
}

/// Optional fields for patching a foreign entity record.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchForeignEntity {
    /// New external identifier. `None` leaves the current value unchanged.
    pub foreign_entity_id: Option<String>,
    /// New source system. `None` leaves the current value unchanged.
    pub foreign_entity_source: Option<String>,
    /// New metadata value. `None` leaves the current value unchanged.
    pub metadata: Option<Value>,
    /// New internal entity identifier. `None` leaves the current value unchanged.
    pub stored_for_id: Option<String>,
    /// New internal auth entity namespace. `None` leaves the current value unchanged.
    pub stored_for_auth_entity: Option<String>,
}

/// Errors that can occur during foreign entity operations.
#[derive(Debug, thiserror::Error)]
pub enum ForeignEntityError {
    /// The requested foreign entity record was not found.
    #[error("foreign entity not found: {0}")]
    NotFound(Uuid),
    /// The request was invalid.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// An unexpected internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl CreateForeignEntity {
    pub(crate) fn validate(&self) -> Result<(), ForeignEntityError> {
        validate_non_blank("foreignEntityId", &self.foreign_entity_id)?;
        validate_non_blank("foreignEntitySource", &self.foreign_entity_source)?;
        validate_non_blank("storedForId", &self.stored_for_id)?;
        validate_non_blank("storedForAuthEntity", &self.stored_for_auth_entity)?;

        Ok(())
    }
}

impl PatchForeignEntity {
    pub(crate) fn validate(&self) -> Result<(), ForeignEntityError> {
        if self.is_empty() {
            return Err(ForeignEntityError::BadRequest(
                "patch must include at least one field".to_string(),
            ));
        }

        validate_optional_non_blank("foreignEntityId", self.foreign_entity_id.as_deref())?;
        validate_optional_non_blank("foreignEntitySource", self.foreign_entity_source.as_deref())?;
        validate_optional_non_blank("storedForId", self.stored_for_id.as_deref())?;
        validate_optional_non_blank(
            "storedForAuthEntity",
            self.stored_for_auth_entity.as_deref(),
        )?;

        Ok(())
    }

    fn is_empty(&self) -> bool {
        self.foreign_entity_id.is_none()
            && self.foreign_entity_source.is_none()
            && self.metadata.is_none()
            && self.stored_for_id.is_none()
            && self.stored_for_auth_entity.is_none()
    }
}

pub(crate) fn validate_foreign_entity_lookup(
    foreign_entity_id: &str,
    foreign_entity_source: Option<&str>,
) -> Result<(), ForeignEntityError> {
    validate_non_blank("foreignEntityId", foreign_entity_id)?;
    validate_optional_non_blank("foreignEntitySource", foreign_entity_source)
}

fn default_metadata() -> Value {
    Value::Object(serde_json::Map::new())
}

fn validate_optional_non_blank(
    field_name: &str,
    value: Option<&str>,
) -> Result<(), ForeignEntityError> {
    if let Some(value) = value {
        validate_non_blank(field_name, value)?;
    }

    Ok(())
}

fn validate_non_blank(field_name: &str, value: &str) -> Result<(), ForeignEntityError> {
    if value.trim().is_empty() {
        return Err(ForeignEntityError::BadRequest(format!(
            "{field_name} must not be blank"
        )));
    }

    Ok(())
}
