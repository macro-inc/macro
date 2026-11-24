//! Postgres and OpenSearch adapters for the database rows index.
//!
//! Reads go to the primary: an event arrives right after its commit, and a
//! replica that has not caught up would index the old state and mark the
//! table caught up.

use std::sync::Arc;

use database_row_search::{
    RowSearchText,
    index::{self, DatabaseTables, TableChanges, TableState},
    read_row_search_text,
};
use opensearch_client::{
    OpensearchClient,
    database_row::{DatabaseRowScope, DatabaseRowWrite},
};
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::database_row_index::{
    DatabaseRowIndex, DatabaseRowSource, IndexedRow, RowIndexScope, RowIndexWrite, RowWriteOutcome,
};

/// Macro databases and the index watermarks, in MacroDB.
#[derive(Clone)]
pub struct PgDatabaseRows {
    db: PgPool,
}

impl PgDatabaseRows {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

fn limit(limit: usize) -> i64 {
    i64::try_from(limit).unwrap_or(i64::MAX)
}

/// The session advisory lock one task holds while it sweeps stale documents.
const STALE_SWEEP_LOCK: i64 = 0x6462_726f_7773;

/// Holds the sweep lock on its own connection. Dropping it closes the
/// connection, which releases the lock even when the sweep failed part way:
/// a session lock outlives a connection returned to the pool.
pub struct PgSweepLease(Option<sqlx::pool::PoolConnection<sqlx::Postgres>>);

impl Drop for PgSweepLease {
    fn drop(&mut self) {
        if let Some(connection) = self.0.take() {
            drop(connection.detach());
        }
    }
}

impl DatabaseRowSource for PgDatabaseRows {
    type SweepLease = PgSweepLease;

    async fn lead_stale_sweep(&self) -> Result<Option<PgSweepLease>, Report> {
        let mut connection = self.db.acquire().await?;
        let led = sqlx::query_scalar!(
            r#"SELECT pg_try_advisory_lock($1) AS "led!""#,
            STALE_SWEEP_LOCK
        )
        .fetch_one(&mut *connection)
        .await?;
        Ok(led.then(|| PgSweepLease(Some(connection))))
    }

    async fn table_state(&self, table_id: Uuid) -> Result<Option<TableState>, Report> {
        Ok(index::read_table_state(&self.db, table_id).await?)
    }

    async fn database_tables(&self, database_id: Uuid) -> Result<Option<DatabaseTables>, Report> {
        Ok(index::read_database_tables(&self.db, database_id).await?)
    }

    async fn table_changes(
        &self,
        table_id: Uuid,
        after: i64,
        through: i64,
    ) -> Result<TableChanges, Report> {
        Ok(index::read_table_changes(&self.db, table_id, after, through).await?)
    }

    async fn table_row_ids(
        &self,
        table_id: Uuid,
        after: Option<Uuid>,
        page: usize,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(index::read_table_row_ids(&self.db, table_id, after, limit(page)).await?)
    }

    async fn row_texts(&self, row_ids: &[Uuid]) -> Result<Vec<RowSearchText>, Report> {
        Ok(read_row_search_text(&self.db, row_ids).await?)
    }

    async fn searchable_database_ids(
        &self,
        after: Option<Uuid>,
        page: usize,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(index::read_searchable_database_ids(&self.db, after, limit(page)).await?)
    }

    async fn searchable_row_ids(&self, row_ids: &[Uuid]) -> Result<Vec<Uuid>, Report> {
        Ok(index::read_searchable_row_ids(&self.db, row_ids).await?)
    }

    async fn watermark(&self, table_id: Uuid) -> Result<Option<i64>, Report> {
        Ok(index::read_watermark(&self.db, table_id).await?)
    }

    async fn raise_watermark(
        &self,
        table_id: Uuid,
        database_id: Uuid,
        version: i64,
    ) -> Result<(), Report> {
        Ok(index::raise_watermark(&self.db, table_id, database_id, version).await?)
    }

    async fn forget_table(&self, table_id: Uuid) -> Result<(), Report> {
        Ok(index::delete_table_watermark(&self.db, table_id).await?)
    }

    async fn forget_database(&self, database_id: Uuid) -> Result<(), Report> {
        Ok(index::delete_database_watermarks(&self.db, database_id).await?)
    }

    async fn gone_tables(&self, page: usize) -> Result<Vec<Uuid>, Report> {
        Ok(index::read_watermarks_of_gone_tables(&self.db, limit(page)).await?)
    }
}

/// The `database_rows` OpenSearch index.
#[derive(Clone)]
pub struct OpenSearchDatabaseRows(pub Arc<OpensearchClient>);

impl DatabaseRowIndex for OpenSearchDatabaseRows {
    async fn write(&self, writes: Vec<RowIndexWrite>) -> Result<RowWriteOutcome, Report> {
        let writes: Vec<DatabaseRowWrite> = writes
            .into_iter()
            .map(|write| match write {
                RowIndexWrite::Upsert(document) => DatabaseRowWrite::Upsert(document),
                RowIndexWrite::Delete {
                    row_id,
                    table_version,
                } => DatabaseRowWrite::Delete {
                    row_id,
                    table_version,
                },
            })
            .collect();
        let outcome = self.0.write_database_rows(&writes).await?;
        Ok(RowWriteOutcome {
            applied: outcome.applied,
            superseded: outcome.superseded,
        })
    }

    async fn delete(&self, scope: RowIndexScope) -> Result<u64, Report> {
        let scope = match scope {
            RowIndexScope::Database(database_id) => DatabaseRowScope::Database(database_id),
            RowIndexScope::Table(table_id) => DatabaseRowScope::Table(table_id),
            RowIndexScope::TableOlderThan { table_id, version } => {
                DatabaseRowScope::TableOlderThan { table_id, version }
            }
        };
        Ok(self.0.delete_database_rows(scope).await?)
    }

    async fn page(&self, after: Option<Uuid>, size: usize) -> Result<Vec<IndexedRow>, Report> {
        Ok(self
            .0
            .page_database_rows(after, size)
            .await?
            .into_iter()
            .map(|row| IndexedRow {
                row_id: row.row_id,
                table_version: row.table_version,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
