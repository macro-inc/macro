//! Postgres repository for databases, tables, columns, rows, and links.
//!
//! Mechanics only: sqlx queries and transactions. Policy lives in the domain
//! service. Tables: `databases`, `database_tables`, `database_columns`,
//! `database_rows`, `database_row_links`
//! (`crates/macro_db_client/migrations/20260908204308_add_databases.up.sql`).

use std::collections::HashMap;

use sqlx::PgPool;

use crate::domain::models::{
    AppliedChanges, ColumnId, CreateColumn, CreateDatabase, CreateTable, Database, DatabaseId,
    PropertyDefinitionId, Row, RowChange, RowId, Table, TableId, TableVersion, Viewer,
};
use crate::domain::ports::DatabasesRepo;

/// Errors from the Postgres repository.
#[derive(Debug, thiserror::Error)]
pub enum PgDatabasesRepoError {
    /// Underlying database failure.
    #[error("database error")]
    Sqlx(#[from] sqlx::Error),
}

/// [`DatabasesRepo`] backed by MacroDB.
#[derive(Debug, Clone)]
pub struct PgDatabasesRepo {
    pool: PgPool,
}

impl PgDatabasesRepo {
    /// Create a repository over the given pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl DatabasesRepo for PgDatabasesRepo {
    type Err = PgDatabasesRepoError;

    async fn create_database(&self, _cmd: &CreateDatabase) -> Result<Database, Self::Err> {
        let _ = &self.pool;
        todo!("INSERT INTO databases … RETURNING (sqlx query! once schema is prepared)")
    }

    async fn get_database(
        &self,
        _id: DatabaseId,
    ) -> Result<Option<(Database, Vec<Table>)>, Self::Err> {
        todo!("SELECT database + its tables ordered by position")
    }

    async fn create_table(&self, _cmd: &CreateTable) -> Result<Table, Self::Err> {
        todo!("INSERT INTO database_tables … RETURNING")
    }

    async fn create_column(
        &self,
        _table_id: TableId,
        _property_definition_id: PropertyDefinitionId,
        _cmd: &CreateColumn,
    ) -> Result<ColumnId, Self::Err> {
        todo!("INSERT INTO database_columns …; bump table version in the same transaction")
    }

    async fn fetch_rows(&self, _table_id: TableId) -> Result<Vec<Row>, Self::Err> {
        todo!(
            "SELECT id, position, cells FROM database_rows WHERE table_id = $1 (one scan; decode cells JSONB into PropertyValue map)"
        )
    }

    async fn fetch_links(&self, _column_id: ColumnId) -> Result<Vec<(RowId, RowId)>, Self::Err> {
        todo!(
            "SELECT source_row_id, target_row_id FROM database_row_links WHERE link_column_id = $1"
        )
    }

    async fn apply_changes(
        &self,
        _viewer: &Viewer,
        _changes: &[RowChange],
    ) -> Result<AppliedChanges, Self::Err> {
        todo!(
            "one transaction: inserts (mint row ids), cell UPDATEs (jsonb merge), deletes, link edges; bump each written table's version once; return minted ids + new versions"
        )
    }

    async fn table_versions(
        &self,
        _table_ids: &[TableId],
    ) -> Result<HashMap<TableId, TableVersion>, Self::Err> {
        todo!("SELECT id, version FROM database_tables WHERE id = ANY($1)")
    }
}
