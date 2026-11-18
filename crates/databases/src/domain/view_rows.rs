//! The ordered read model for a validated view of one authorized table.

use std::future::Future;

use database_sql::{catalog::Table, resolve::SelectQuery};
use models_databases::{RowId, TableVersion};

/// A view read failed before a page could be returned.
#[derive(Debug, thiserror::Error)]
pub enum ViewRowsError {
    /// The caller must restart pagination against the current table.
    #[error("the table changed; refresh the view before continuing")]
    Stale,
    /// The compiled view is not a supported single-table read.
    #[error("invalid database view query")]
    InvalidQuery,
    /// Persistence failed.
    #[error("could not read database rows")]
    Infrastructure(rootcause::Report),
}

/// Read row identities after applying all of a view's filters and ordering.
/// The adapter checks the table version and reads the rows in one snapshot.
pub trait ViewRowsRepository: Send + Sync + 'static {
    /// At most `limit` matching row identities, strictly after `after`.
    fn page(
        &self,
        table: &Table,
        query: &SelectQuery,
        version: TableVersion,
        after: Option<RowId>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<RowId>, ViewRowsError>> + Send;
}
