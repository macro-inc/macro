//! PostgreSQL reads in a view's global order, with keyset pagination.

mod query;

use database_sql::{catalog::Table, resolve::SelectQuery};
use models_databases::{RowId, TableVersion};
use sqlx::PgPool;
use tracing::Instrument;

use crate::domain::view_rows::{ViewRowsError, ViewRowsRepository};

/// The database-row read model, including the property values that determine
/// membership and order. Only the selected identities are hydrated afterward.
pub struct PgViewRows {
    pool: PgPool,
}

impl PgViewRows {
    /// Use the primary so accepted edits are visible on the following read.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn persistence(error: sqlx::Error) -> ViewRowsError {
    ViewRowsError::Infrastructure(rootcause::Report::new(error).into())
}

impl ViewRowsRepository for PgViewRows {
    #[tracing::instrument(name = "database.view_rows.page", skip_all, fields(database.table_id = %table.id, database.page_limit = limit, database.rows), err)]
    async fn page(
        &self,
        table: &Table,
        query: &SelectQuery,
        version: TableVersion,
        after: Option<RowId>,
        limit: u16,
    ) -> Result<Vec<RowId>, ViewRowsError> {
        let mut sql = query::page(table, query, after, limit)?;
        let mut transaction = self
            .pool
            .begin()
            .instrument(tracing::info_span!("database.view_rows.pool.acquire"))
            .await
            .map_err(persistence)?;
        sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(persistence)?;
        let actual = sqlx::query_scalar!(
            "SELECT version FROM database_tables WHERE id = $1 AND database_id = $2",
            table.id.into_uuid(),
            table.database_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(persistence)?;
        if actual != Some(version.0) {
            return Err(ViewRowsError::Stale);
        }
        let rows: Vec<uuid::Uuid> = sql
            .build_query_scalar()
            .fetch_all(&mut *transaction)
            .instrument(tracing::info_span!("database.view_rows.select"))
            .await
            .map_err(persistence)?;
        transaction.commit().await.map_err(persistence)?;
        tracing::Span::current().record("database.rows", rows.len());
        Ok(rows.into_iter().map(RowId::from_uuid).collect())
    }
}
