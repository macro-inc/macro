//! Typed access to reusable storage for domains that own authorization and lifecycle.

use std::collections::HashMap;

use models_properties::service::property_value::PropertyValue;
use serde::{Deserialize, Serialize};

use super::models::{
    AppliedOps, ColumnId, DatabaseError, DatabaseId, OpBatch, RowId, TableDetail, TableId,
    TableVersion, Viewer,
};

/// One storage row, with cells keyed by column placement.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageRow {
    /// Row identity, independent of any referenced entity.
    pub row_id: RowId,
    /// Populated cells.
    pub cells: HashMap<ColumnId, PropertyValue>,
}

/// A bounded page of rows at a table version.
#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StorageRows {
    /// Rows in the requested view's order.
    pub rows: Vec<StorageRow>,
    /// Cursor for another page, if present.
    pub next: Option<RowId>,
    /// Table version when the read began.
    pub version: TableVersion,
}

/// A query over one authorized storage table.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageRowsQuery {
    /// Continue after this row in the filtered, sorted result.
    pub after: Option<RowId>,
    /// The common database filter and sort semantics.
    #[serde(default)]
    pub query: models_databases::views::ViewQuery,
    /// Read these retained rows regardless of the active filter.
    pub row_ids: Option<Vec<RowId>>,
}

/// Trusted domain capability. Consumers enforce access and hold their own
/// lifecycle guard through each call. This never creates a database app entity.
pub trait DatabaseStorageService: Send + Sync + 'static {
    /// Read schema from an authorized core resource.
    fn storage_tables(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<TableDetail>, DatabaseError>> + Send;
    /// Read a page from a table in the authorized resource.
    fn storage_rows(
        &self,
        id: DatabaseId,
        table: TableId,
        query: StorageRowsQuery,
    ) -> impl Future<Output = Result<StorageRows, DatabaseError>> + Send;
    /// Validate typed operations with the shared planner, then commit through
    /// `DatabaseStorage`. External property bindings and cross-resource relations
    /// require a host capability and are not accepted by this entry point.
    fn apply_storage_ops(
        &self,
        id: DatabaseId,
        viewer: Viewer,
        batch: OpBatch,
    ) -> impl Future<Output = Result<AppliedOps, DatabaseError>> + Send;
}
