use chrono::{DateTime, Utc};
use model_owner::Owner;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A row of a Macro database table in the Soup feed. Its cells are its
/// entity properties; access is its database's.
#[derive(Serialize, Clone, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupDatabaseRow<T = ()> {
    /// Row identifier.
    pub id: Uuid,
    /// The table the row belongs to.
    pub table_id: Uuid,
    /// The database the table belongs to.
    pub database_id: Uuid,
    /// Fractional index ordering the row within its table.
    pub position: String,
    /// The database's owner, which owns every row in it.
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: Owner,
    /// Who created the row, when they still exist.
    pub created_by: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last modification timestamp.
    pub updated_at: DateTime<Utc>,
    /// Enrichment attached by the caller.
    #[serde(flatten)]
    pub extra: T,
}
