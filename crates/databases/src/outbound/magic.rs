//! Magic tables: platform data exposed to SQL, permission-scoped per viewer.
//!
//! Each magic table is a contract — a SQL name, a typed column list, and one
//! blessed, permission-filtered query that can produce it on demand for a
//! viewer, projected to only the referenced columns. Column-level laziness is
//! what makes heavy fields (`documents.content_md`, `calls.transcript`) safe
//! to offer. All magic tables are read-only (enforced by the executor's
//! authorizer).
//!
//! Planned tables and their backing sources:
//! - `people`      — ContactsDB: contacts + team members the viewer can see
//! - `documents`   — MacroDB, entity_access-filtered; lazy `content_md`
//! - `tasks`       — documents with the Task sub-type + property pivot
//! - `companies`   — CRM tables + shared property pivot
//! - `calls`       — call records; lazy `transcript`; participants junction
//! - `email_threads` — threads + participants junction

use crate::domain::models::{MaterializedTable, TableSchema, Viewer};
use crate::domain::ports::MagicTables;

/// Errors from magic-table materialization.
#[derive(Debug, thiserror::Error)]
pub enum MagicTablesError {
    /// The named table is not part of the registry.
    #[error("unknown magic table: {0}")]
    Unknown(String),
    /// A backing store failed.
    #[error("magic table backend error: {0:?}")]
    Backend(rootcause::Report),
}

/// The registry of every magic-table source, dispatched by SQL name.
///
/// Construction happens in the composition root, which is the only place that
/// knows about ContactsDB clients and friends.
#[derive(Debug, Clone, Default)]
pub struct MagicTableRegistry {
    // TODO: per-table sources (ContactsDB client, MacroDB pool, property
    // pivot) injected here by the composition root.
}

impl MagicTables for MagicTableRegistry {
    type Err = MagicTablesError;

    fn schemas(&self) -> Vec<TableSchema> {
        todo!("static schemas for people/documents/tasks/… incl. entity_type tags per column")
    }

    async fn materialize(
        &self,
        _viewer: &Viewer,
        _sql_name: &str,
        _columns: &[String],
    ) -> Result<MaterializedTable, Self::Err> {
        todo!("dispatch to the table's blessed permission-filtered query, projected to `columns`")
    }
}
