//! Paged view reads: authorize the catalog, compile the existing view model,
//! and keep every cursor bound to the query and table version it started with.

#[cfg(test)]
mod test;

use std::{future::Future, sync::Arc};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use databases::domain::{
    models::{DatabaseError, RowId, TableId, TableVersion},
    ports::DatabasesService,
    view_rows::{ViewRowsError, ViewRowsRepository},
};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use models_databases::views::{ViewProblem, ViewQuery};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::catalog::ViewerCatalog;

/// The page size remains the same as the existing database row reader.
pub const VIEW_PAGE_LIMIT: u16 = 500;

/// One page of the rows a table view shows.
pub struct ViewRowsRequest {
    /// The table in the authorized database.
    pub table_id: TableId,
    /// All filtering and ordering, before the page boundary.
    pub query: ViewQuery,
    /// The preceding page's opaque continuation.
    pub cursor: Option<String>,
    /// How many rows to return, from one through 500.
    pub limit: u16,
}

/// Ordered row identities, ready for the canonical entity loader.
#[derive(Debug)]
pub struct ViewRowsPage {
    /// Identities in global view order.
    pub rows: Vec<RowId>,
    /// Absent once all matching rows have been read.
    pub next_cursor: Option<String>,
    /// The table version used by this read.
    pub version: TableVersion,
}

/// Why a view page could not be answered.
#[derive(Debug, thiserror::Error)]
pub enum ViewPageError {
    /// The authorized database could not be loaded.
    #[error(transparent)]
    Database(#[from] DatabaseError),
    /// The view does not fit its table's schema.
    #[error(transparent)]
    View(#[from] ViewProblem),
    /// The page size is out of bounds.
    #[error("page size must be between 1 and 500")]
    InvalidLimit,
    /// The cursor belongs to a different query or is malformed.
    #[error("invalid database view cursor")]
    InvalidCursor,
    /// The row read failed, including when its version became stale.
    #[error(transparent)]
    Read(#[from] ViewRowsError),
}

/// The use case exposed to GraphQL and other authenticated adapters.
pub trait ViewRowsService: Send + Sync + 'static {
    /// Read a page within the database the receipt authorizes.
    fn page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: ViewRowsRequest,
    ) -> impl Future<Output = Result<ViewRowsPage, ViewPageError>> + Send;
}

/// View compilation and cursor policy over the owning domains' ports.
pub struct DatabaseViewRows<Databases, Rows> {
    databases: Arc<Databases>,
    rows: Rows,
}

impl<Databases, Rows> DatabaseViewRows<Databases, Rows> {
    /// Compose catalog reads with the ordered row read model.
    pub fn new(databases: Arc<Databases>, rows: Rows) -> Self {
        Self { databases, rows }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    format: u8,
    query: String,
    schema: String,
    version: TableVersion,
    after: RowId,
}

fn query_key(table: TableId, query: &ViewQuery) -> Result<String, ViewPageError> {
    let json = serde_json::to_vec(&(table, query)).map_err(|_| ViewPageError::InvalidCursor)?;
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(json)))
}

fn decode_cursor(encoded: &str, query: &str) -> Result<Cursor, ViewPageError> {
    if encoded.len() > 1024 {
        return Err(ViewPageError::InvalidCursor);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| ViewPageError::InvalidCursor)?;
    let cursor: Cursor =
        serde_json::from_slice(&bytes).map_err(|_| ViewPageError::InvalidCursor)?;
    if cursor.format != 1 || cursor.query != query {
        return Err(ViewPageError::InvalidCursor);
    }
    Ok(cursor)
}

impl<Databases: DatabasesService, Rows: ViewRowsRepository> ViewRowsService
    for DatabaseViewRows<Databases, Rows>
{
    #[tracing::instrument(name = "database.view_rows.read", skip_all, fields(database.table_id = %request.table_id, database.page_limit = request.limit, database.rows), err)]
    async fn page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: ViewRowsRequest,
    ) -> Result<ViewRowsPage, ViewPageError> {
        if !(1..=VIEW_PAGE_LIMIT).contains(&request.limit) {
            return Err(ViewPageError::InvalidLimit);
        }
        let detail = self.databases.get_database(receipt).await?;
        let catalog = ViewerCatalog::new(vec![detail], None);
        let query =
            database_sql::compile_table_query(request.table_id, &request.query, catalog.catalog())?;
        let (_, stored) = catalog
            .table(request.table_id)
            .ok_or(ViewProblem::UnknownTable {
                table: request.table_id,
            })?;
        let table = catalog
            .catalog()
            .tables
            .iter()
            .find(|table| table.id == request.table_id)
            .ok_or(ViewProblem::UnknownTable {
                table: request.table_id,
            })?;
        let version = stored.table.version;
        let key = query_key(request.table_id, &request.query)?;
        let schema = URL_SAFE_NO_PAD.encode(Sha256::digest(
            serde_json::to_vec(table).map_err(|_| ViewPageError::InvalidCursor)?,
        ));
        let cursor = request
            .cursor
            .as_deref()
            .map(|cursor| decode_cursor(cursor, &key))
            .transpose()?;
        if cursor
            .as_ref()
            .is_some_and(|cursor| cursor.version != version || cursor.schema != schema)
        {
            return Err(ViewRowsError::Stale.into());
        }
        let mut rows = self
            .rows
            .page(
                table,
                &query,
                version,
                cursor.map(|cursor| cursor.after),
                request.limit + 1,
            )
            .await?;
        let more = rows.len() > usize::from(request.limit);
        rows.truncate(usize::from(request.limit));
        let next_cursor = more
            .then(|| rows.last())
            .flatten()
            .map(|after| {
                serde_json::to_vec(&Cursor {
                    format: 1,
                    query: key,
                    schema,
                    version,
                    after: *after,
                })
                .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
                .map_err(|_| ViewPageError::InvalidCursor)
            })
            .transpose()?;
        tracing::Span::current().record("database.rows", rows.len());
        Ok(ViewRowsPage {
            rows,
            next_cursor,
            version,
        })
    }
}
