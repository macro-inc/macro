use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// A foreign entity record as displayed in Soup.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupForeignEntity {
    /// Internal primary key for this foreign entity record.
    pub id: Uuid,
    /// Identifier assigned by the external system.
    pub foreign_entity_id: String,
    /// Source system that owns the external identifier.
    pub foreign_entity_source: String,
    /// Arbitrary metadata stored with the mapping.
    #[cfg_attr(feature = "schema", schema(value_type = Object))]
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
