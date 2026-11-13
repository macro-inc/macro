//! What the syncs service needs, and what it offers.

use std::collections::HashSet;

use call::domain::imports::ImportedCallRecord;
use databases::domain::models::{DatabaseError, Viewer};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{DatabaseId, DatabaseOp, OpResult, RowId, TableId};

use crate::domain::columns::TableColumn;
use crate::domain::models::{
    AvailableSources, ClaimedSync, DatabaseSync, DatabaseSyncError, FinishedRun, NewSync,
    NewSyncRecord, SourceKind, SyncId,
};
use crate::domain::plan::{Fingerprint, RowMapping};

/// The syncs domain service.
pub trait DatabaseSyncsService: Send + Sync + 'static {
    /// Add a synced table to the receipt's database. Retrying with the same
    /// id answers the sync the first attempt made.
    fn create_sync(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync: NewSync,
    ) -> impl Future<Output = Result<DatabaseSync, DatabaseSyncError>> + Send;

    /// Create a database, named after the source, whose one table is synced.
    fn create_synced_database(
        &self,
        user: &MacroUserIdStr<'static>,
        sync: NewSync,
    ) -> impl Future<Output = Result<DatabaseSync, DatabaseSyncError>> + Send;

    /// The receipt's database's syncs, oldest first.
    fn list_syncs(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<Vec<DatabaseSync>, DatabaseSyncError>> + Send;

    /// Run one of the receipt's database's syncs as soon as a worker is free.
    fn sync_now(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<(), DatabaseSyncError>> + Send;

    /// Stop one of the receipt's database's syncs. Its table and rows stay.
    fn delete_sync(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<(), DatabaseSyncError>> + Send;

    /// What the user can sync a table from.
    fn sources(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<AvailableSources, DatabaseSyncError>> + Send;

    /// The user's source of this kind changed: their syncs of it run soon.
    fn source_changed(
        &self,
        user: &MacroUserIdStr<'static>,
        kind: SourceKind,
    ) -> impl Future<Output = Result<(), DatabaseSyncError>> + Send;

    /// Run one due sync; whether there was one.
    fn run_due(&self) -> impl Future<Output = Result<bool, DatabaseSyncError>> + Send;
}

/// Where syncs and the rows they wrote are kept.
pub trait DatabaseSyncsRepo: Send + Sync + 'static {
    /// Store a new sync, due at once. A sync already stored under its id is
    /// left as it is.
    fn insert_sync(
        &self,
        sync: NewSyncRecord,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// The sync with this id, of any database.
    fn sync(
        &self,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<Option<DatabaseSync>, rootcause::Report>> + Send;

    /// A database's syncs, oldest first.
    fn database_syncs(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Vec<DatabaseSync>, rootcause::Report>> + Send;

    /// Delete a sync of the database, with its row records; whether there
    /// was one.
    fn delete_sync(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;

    /// Make a sync of the database due now; whether there was one.
    fn mark_due(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;

    /// Make every sync the user created from this kind of source due now.
    fn mark_source_due(
        &self,
        created_by: &MacroUserIdStr<'static>,
        kind: SourceKind,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Lease the most overdue sync, or one whose lease ran out, for
    /// `lease_for`. A sync marked due while leased runs again after.
    fn claim_due(
        &self,
        lease_for: std::time::Duration,
    ) -> impl Future<Output = Result<Option<ClaimedSync>, rootcause::Report>> + Send;

    /// The source rows the sync wrote.
    fn row_mappings(
        &self,
        sync_id: SyncId,
    ) -> impl Future<Output = Result<Vec<RowMapping>, rootcause::Report>> + Send;

    /// Reserve row ids for inserts about to be sent, so a run cut short
    /// retries them under the same ids.
    fn reserve_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId)],
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Record rows as written with these cells.
    fn record_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId, Fingerprint)],
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Forget source rows.
    fn forget_rows(
        &self,
        sync_id: SyncId,
        external_ids: &[String],
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// End a run that holds `lease`; whether it still held it.
    fn finish(
        &self,
        sync_id: SyncId,
        lease: uuid::Uuid,
        run: FinishedRun,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// A database and its tables, as the syncs service reads them.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncDatabase {
    /// Its tables, in tab order.
    pub tables: Vec<SyncTable>,
}

/// A table and its columns.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncTable {
    /// The table.
    pub id: TableId,
    /// Its name.
    pub name: String,
    /// Its columns, in display order.
    pub columns: Vec<TableColumn>,
}

/// Synced tables through the databases service, so every write keeps its
/// validation, journal and events.
pub trait SyncTables: Send + Sync + 'static {
    /// The database's tables; `None` when it is gone or trashed.
    fn database(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Option<SyncDatabase>, DatabaseError>> + Send;

    /// Which of `rows` the table still has.
    fn existing_rows(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        rows: &[RowId],
    ) -> impl Future<Output = Result<HashSet<RowId>, DatabaseError>> + Send;

    /// Apply ops as `viewer`, all or none.
    fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        ops: Vec<DatabaseOp>,
    ) -> impl Future<Output = Result<Vec<OpResult>, DatabaseError>> + Send;

    /// Create a database for `owner`; its id and its starter table.
    fn create_database(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: String,
    ) -> impl Future<Output = Result<(DatabaseId, TableId), DatabaseError>> + Send;

    /// Remove a database for good: undoing a create that could not finish.
    fn delete_database(
        &self,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;
}

/// The user's Granola meetings imported into Macro.
pub trait GranolaMeetings: Send + Sync + 'static {
    /// Whether the user's Granola connection syncs meetings into Macro.
    fn connected(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;

    /// Every meeting the user imported from Granola.
    fn meetings(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ImportedCallRecord>, rootcause::Report>> + Send;
}

/// The people a user's synced tables may name: their team.
pub trait TeamDirectory: Send + Sync + 'static {
    /// The user and the other members of their team.
    fn team_members(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;
}
