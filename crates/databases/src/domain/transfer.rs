//! Bounded, retry-safe table imports. CSV syntax is decoded by the client library.

use super::models::{DatabaseError, DatabaseId, PropertyDefinitionId, Table, Viewer};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An import is identified once, before sending, so retries cannot duplicate rows.
#[derive(Debug, Clone, Deserialize, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportTable {
    /// Stable key for this import, retained through retries.
    pub request_id: Uuid,
    /// New table's display name.
    pub name: String,
    /// Header names, in order. All imported values remain text.
    pub columns: Vec<String>,
    /// Rectangular text rows. Empty fields are preserved.
    pub rows: Vec<Vec<String>>,
}

/// Atomic persistence outcome; only a created result has consumed the definitions.
pub enum ImportOutcome {
    /// Created the table and every cell in one transaction.
    Created(Table),
    /// The same request already committed.
    Replayed(Table),
    /// A different request already used this table name.
    NameConflict,
    /// The request key was reused with different contents.
    KeyConflict,
    /// The database was removed while importing.
    NotFound,
}

/// Persistence mechanics for atomic imports.
pub trait DatabaseTransferRepo: Send + Sync + 'static {
    /// Persistence error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Find an earlier committed request, even after its table was renamed.
    fn imported_table(
        &self,
        database_id: DatabaseId,
        request_id: Uuid,
    ) -> impl Future<Output = Result<Option<(Table, String)>, Self::Err>> + Send;
    /// Create all placements and rows together, serializing on the database.
    fn import_table(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        request: &ImportTable,
        fingerprint: &str,
        definitions: &[PropertyDefinitionId],
    ) -> impl Future<Output = Result<ImportOutcome, Self::Err>> + Send;
}

/// Import use case, with edit capability checked at the boundary.
pub trait DatabaseTransferService: Send + Sync + 'static {
    /// Import into a new table without rounding numbers or overwriting existing data.
    fn import_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        request: ImportTable,
    ) -> impl Future<Output = Result<Table, DatabaseError>> + Send;
}
