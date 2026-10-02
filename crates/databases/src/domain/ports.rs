//! Ports between the service and its adapters. `CellStore` is the one place
//! a batch's writes, schema and data, commit together.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;

use crate::domain::journal::{
    ChangeRecord, JournalActor, JournaledRowChange, RowHistoryEntry, TableChanges, UndoOutcome,
    VersionTouches,
};
use crate::domain::models::{
    AppliedOps, Awareness, CardPosition, ChangeId, Column, ColumnCast, ColumnConversion, ColumnId,
    CreateDatabase, Database, DatabaseDetail, DatabaseError, DatabaseId, DatabaseView, FirstTable,
    InferColumnType, InferColumnTypeOutcome, ListedDatabase, OpBatch, PropertyDefinitionId,
    QueryDefinition, QueryId, RowId, RowRef, SavedQuery, SavedQueryError, Table, TableId,
    TableVersion, ViewId, Viewer, Writes, WritesOutcome,
};
use models_databases::{ColumnKind, OpResult};

/// Persistence for databases, tables, column placements and row identities.
pub trait DatabasesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Create a database with its first table and that table's title
    /// column, granting the creator owner access, all or nothing.
    fn create_database(
        &self,
        command: &CreateDatabase,
        first_table: FirstTable,
    ) -> impl Future<Output = Result<Database, Self::Error>> + Send;

    /// The live database the user was given as their starter, if they were
    /// given one and it is neither trashed nor deleted.
    fn starter_database(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<DatabaseId>, Self::Error>> + Send;

    /// A database and its tables, if it exists.
    fn get_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<Option<(Database, Vec<Table>)>, Self::Error>> + Send;

    /// Rename a database; `false` when it is gone.
    fn rename_database(
        &self,
        id: DatabaseId,
        name: &str,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// Move a database to the trash; `false` when it is gone.
    fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// Restore a trashed database; `false` when it is gone.
    fn restore_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// Remove a database permanently.
    fn delete_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Settle an untyped column on a definition, provided no row has a value
    /// in it yet, journaling the change as `actor`'s.
    fn infer_column_type(
        &self,
        table: &Table,
        column: &Column,
        definition_id: PropertyDefinitionId,
        actor: &JournalActor,
    ) -> impl Future<Output = Result<Option<TableVersion>, Self::Error>> + Send;

    /// Every row of a table, in position order.
    fn row_refs(
        &self,
        table_id: TableId,
    ) -> impl Future<Output = Result<Vec<RowRef>, Self::Error>> + Send;

    /// Current versions for a set of tables.
    fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> impl Future<Output = Result<HashMap<TableId, TableVersion>, Self::Error>> + Send;

    /// Databases by id (missing ids are skipped).
    fn databases_by_ids(
        &self,
        ids: &[DatabaseId],
    ) -> impl Future<Output = Result<Vec<Database>, Self::Error>> + Send;

    /// Every table of the given databases, ordered by database then position.
    fn tables_for_databases(
        &self,
        database_ids: &[DatabaseId],
    ) -> impl Future<Output = Result<Vec<Table>, Self::Error>> + Send;

    /// Every column placement of the given tables, ordered by table then position.
    fn columns_for_tables(
        &self,
        table_ids: &[TableId],
    ) -> impl Future<Output = Result<Vec<Column>, Self::Error>> + Send;

    /// Every view of the given tables, ordered by table then position.
    fn views_for_tables(
        &self,
        table_ids: &[TableId],
    ) -> impl Future<Output = Result<Vec<DatabaseView>, Self::Error>> + Send;

    /// Where a board's cards sit, those that have a place.
    fn view_positions(
        &self,
        view_id: ViewId,
    ) -> impl Future<Output = Result<Vec<CardPosition>, Self::Error>> + Send;

    /// Store a new, immutable query.
    fn save_query(
        &self,
        database_id: Option<DatabaseId>,
        definition: &QueryDefinition,
        created_by: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<SavedQuery, Self::Error>> + Send;

    /// A saved query, if it exists.
    fn get_query(
        &self,
        id: QueryId,
    ) -> impl Future<Output = Result<Option<SavedQuery>, Self::Error>> + Send;

    /// One journaled change of a database, with the rows and columns it
    /// touched; `None` when the database has no such change.
    fn change(
        &self,
        database_id: DatabaseId,
        change: ChangeId,
    ) -> impl Future<Output = Result<Option<ChangeRecord>, Self::Error>> + Send;

    /// A table's journaled changes after a version, oldest first, with the
    /// rows and columns each touched.
    fn changes_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> impl Future<Output = Result<Vec<ChangeRecord>, Self::Error>> + Send;

    /// What each journaled version of a table after `version` touched,
    /// oldest first.
    fn touches_after(
        &self,
        table_id: TableId,
        version: TableVersion,
    ) -> impl Future<Output = Result<Vec<VersionTouches>, Self::Error>> + Send;

    /// A row's journaled changes in one table of a database, newest first,
    /// the row's removal among them.
    fn row_history(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        row_id: RowId,
    ) -> impl Future<Output = Result<Vec<JournaledRowChange>, Self::Error>> + Send;
}

/// A row's cells, kept by the properties system as entity properties of the
/// `DATABASE_ROW` entity the row id names. Authorization is the domain
/// service's, resolved through the row's database; the store trusts its
/// caller.
pub trait CellStore: Send + Sync + 'static {
    /// The error type returned by the store.
    type Error: std::error::Error + Send + Sync + 'static;

    /// The cells of these rows, keyed by row then definition. A row with no
    /// cells is absent from the map.
    fn cells(
        &self,
        rows: &[RowId],
    ) -> impl Future<
        Output = Result<HashMap<RowId, HashMap<PropertyDefinitionId, PropertyValue>>, Self::Error>,
    > + Send;

    /// One column's cells of these rows: what `definition` holds on each, for
    /// the rows where it holds something.
    fn column_cells(
        &self,
        rows: &[RowId],
        definition: PropertyDefinitionId,
    ) -> impl Future<Output = Result<HashMap<RowId, PropertyValue>, Self::Error>> + Send;

    /// Apply a request's writes in one transaction, in order: schema, row
    /// identities, cells and options together. The database is locked (for
    /// a write to its tables) or shared, each written table locked, checked
    /// live and at its expected version, each new definition created before
    /// any column binds it, each updated or deleted row checked to belong to
    /// its table, each related row to its target table, each changed option
    /// or column to its definition, and each changed table's version bumped
    /// once. A batch that [`Writes::creates`] a database inserts it, owned
    /// by its owner, before anything else, and for a starter first claims
    /// the owner's one starter. Anything but [`WritesOutcome::Applied`]
    /// wrote nothing, beyond the claim of [`WritesOutcome::StarterTaken`].
    fn apply_writes(
        &self,
        writes: &Writes,
    ) -> impl Future<Output = Result<WritesOutcome, Self::Error>> + Send;
}

/// Which databases a viewer can reach, as `entity_access` answers it: the
/// boundary of what a listing, and so the SQL adapter's catalog, can see.
/// Trash is not its concern: a trashed database's grants are still answered,
/// and the service drops them.
pub trait AccessDirectory: Send + Sync + 'static {
    /// The error type returned by directory operations.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Every database the viewer holds a grant on, at the highest level.
    fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> impl Future<Output = Result<Vec<(DatabaseId, AccessLevel)>, Self::Error>> + Send;

    /// The viewer's highest level on one database; `None` without a grant.
    fn database_access(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
    ) -> impl Future<Output = Result<Option<AccessLevel>, Self::Error>> + Send;
}

/// The definitions behind columns: creating database-owned ones, binding
/// existing ones, and reading them back with their options.
pub trait ColumnDefinitionStore: Send + Sync + 'static {
    /// The error type returned by the store.
    type Error: std::error::Error + Send + Sync + 'static;

    /// An existing definition the viewer may bind in `database_id`; `None`
    /// when it is missing or not theirs to bind.
    fn bindable_definition(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        id: PropertyDefinitionId,
    ) -> impl Future<Output = Result<Option<PropertyDefinitionId>, Self::Error>> + Send;

    /// Create a definition owned by the database with its first options, in
    /// display order, together. Each option takes the palette colour of its
    /// position (`properties::TagColor::for_position`).
    fn create_typed_definition(
        &self,
        database_id: DatabaseId,
        name: &str,
        data_type: models_properties::DataType,
        is_multi_select: bool,
        specific_entity_type: Option<models_properties::EntityType>,
        options: &[PropertyOptionValue],
    ) -> impl Future<Output = Result<PropertyDefinitionWithOptions, Self::Error>> + Send;

    /// Remove a definition that no column binds any more.
    fn delete_unused_definition(
        &self,
        id: PropertyDefinitionId,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Definitions by id, with their options.
    fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Error>> + Send;

    /// The definitions among `ids` the viewer may change as the properties
    /// system decides it for definitions outside any database: their own, or
    /// a team's they belong to; never a system one.
    fn editable_definitions(
        &self,
        viewer: &Viewer,
        ids: &[PropertyDefinitionId],
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionId>, Self::Error>> + Send;
}

/// Liveness: tell open clients a table changed.
pub trait TableEventPublisher: Send + Sync + 'static {
    /// The error type returned by the publisher.
    type Error: std::error::Error + Send + Sync + 'static;

    /// Announce a table's new version.
    fn table_changed(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;

    /// Relay where a viewer is to the database's other viewers.
    fn awareness(
        &self,
        database_id: DatabaseId,
        user_id: &MacroUserIdStr<'_>,
        state: &Awareness,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
}

/// The databases domain service.
pub trait DatabasesService: Send + Sync + 'static {
    /// Create a database with a starter table.
    fn create_database(
        &self,
        command: CreateDatabase,
    ) -> impl Future<Output = Result<Database, DatabaseError>> + Send;

    /// Every database the viewer can see.
    fn list_databases(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<Vec<ListedDatabase>, DatabaseError>> + Send;

    /// Every database [`Self::list_databases`] answers, each with its tables
    /// and columns, read in one batch.
    fn database_details(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<Vec<DatabaseDetail>, DatabaseError>> + Send;

    /// A database with its tables and columns.
    fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<DatabaseDetail, DatabaseError>> + Send;

    /// Rename a database.
    fn rename_database(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> impl Future<Output = Result<Database, DatabaseError>> + Send;

    /// Move a database to the trash.
    fn trash_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Restore a trashed database.
    fn restore_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Remove a database permanently.
    fn delete_database_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Settle an untyped column's type from its first value.
    fn infer_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        command: InferColumnType,
    ) -> impl Future<Output = Result<InferColumnTypeOutcome, DatabaseError>> + Send;

    /// What changing a column to each type the type menu offers would do to
    /// its values, read in one pass without changing anything.
    fn column_casts(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
    ) -> impl Future<Output = Result<Vec<ColumnCast>, DatabaseError>> + Send;

    /// What one column's values become under `to`: the values that
    /// convert, for a new column of that type beside it, which leaves the
    /// column itself as it is. Changes nothing.
    fn column_conversion(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        to: ColumnKind,
    ) -> impl Future<Output = Result<ColumnConversion, DatabaseError>> + Send;

    /// Apply a batch of ops to the receipt's database, in order, in one
    /// transaction: all of them, or, when one is refused, none. Every write
    /// to a database's schema or data is one of these ops. A later op may
    /// name what an earlier one created under the id its client minted. Ops
    /// are last-write-wins unless the batch names base versions.
    fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> impl Future<Output = Result<Vec<OpResult>, DatabaseError>> + Send;

    /// [`Self::apply_ops`], answering with the journal's change for each
    /// table version the batch produced, which the caller can undo.
    fn apply_ops_with_changes(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> impl Future<Output = Result<AppliedOps, DatabaseError>> + Send;

    /// Undo one of the viewer's own changes: apply its inverse as a new,
    /// journaled batch, guarded against what others changed since. A cell
    /// changed since is left alone; anything else changed since refuses the
    /// undo. Redo is undoing the undo's change.
    fn undo_change(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        change: ChangeId,
    ) -> impl Future<Output = Result<UndoOutcome, DatabaseError>> + Send;

    /// Where a board's cards sit: their lane and key, for the cards that
    /// have been placed. Rows that were never moved by hand have none, and
    /// show after the placed ones.
    fn view_positions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        view_id: ViewId,
    ) -> impl Future<Output = Result<Vec<CardPosition>, DatabaseError>> + Send;

    /// A row's history: every committed change that touched it, newest
    /// first, with who made it, when, and the values of the columns it
    /// touched before and after. It reads after the row is removed, too.
    fn row_history(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        row_id: RowId,
    ) -> impl Future<Output = Result<Vec<RowHistoryEntry>, DatabaseError>> + Send;

    /// What changed in one of the database's tables since a version: the
    /// rows, each once as it stands now, and the columns. A reader holding
    /// the table at that version reads just those rows, unless the shape
    /// changed, the journal has a gap, or too many rows changed.
    fn table_changes(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        since: TableVersion,
    ) -> impl Future<Output = Result<TableChanges, DatabaseError>> + Send;

    /// Tell the database's other viewers where this viewer is; a relay
    /// failure is the caller's error.
    fn share_awareness(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
        state: Awareness,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Save a question, scoped to `database_id`, which the viewer must be
    /// able to see. Whether its SQL compiles is the SQL adapter's to check:
    /// the domain stores the definition as it is given.
    fn save_query(
        &self,
        viewer: Viewer,
        database_id: Option<DatabaseId>,
        definition: QueryDefinition,
    ) -> impl Future<Output = Result<SavedQuery, SavedQueryError>> + Send;

    /// A saved query's definition, readable by its creator and by anyone who
    /// can view the live database it is scoped to. Anyone else gets
    /// [`SavedQueryError::NotFound`], so query ids cannot be probed.
    fn get_query(
        &self,
        viewer: Viewer,
        id: QueryId,
    ) -> impl Future<Output = Result<SavedQuery, SavedQueryError>> + Send;
}
