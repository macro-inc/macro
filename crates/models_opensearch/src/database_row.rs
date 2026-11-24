//! The `database_rows` search document: one per row of a Macro database.
//!
//! The index is for candidate retrieval only. Search decides what a user may
//! see from fresh Postgres, never from this document, so the document holds
//! only what matching needs: ids and the row's searchable text.

/// Physical index behind the [`crate::SearchIndex::DatabaseRows`] alias.
/// Bump the suffix to roll a new version, then swap the alias.
pub const DATABASE_ROWS_PHYSICAL_INDEX: &str = "database_rows_v1";

/// One database row as indexed. `_id` is [`DatabaseRowDocument::row_id`].
///
/// Writes and deletes carry `table_version` as an `external_gte` version, so
/// a state older than the indexed one never overwrites it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DatabaseRowDocument {
    /// The row id; also the document `_id`.
    pub row_id: uuid::Uuid,
    /// The database storage id. A database entity shares it as its primary key.
    pub database_id: uuid::Uuid,
    /// The table holding the row.
    pub table_id: uuid::Uuid,
    /// Plain text of the primary column, or the first column when the table
    /// has none.
    pub title: String,
    /// Plain text of the row's searchable cells: text (mentions reduced to
    /// their visible label), links, and select and tag option labels.
    pub cell_text: Vec<String>,
    /// The table version this document reflects; the external write version.
    pub table_version: i64,
    /// When the row was last written, in epoch milliseconds.
    pub updated_at: i64,
}
