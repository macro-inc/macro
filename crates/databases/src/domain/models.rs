//! Domain models: entities, commands, the batched row writes, and domain
//! errors.

use std::collections::HashMap;

use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::DataType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

mod schema_error;

pub use schema_error::{ConversionRefusal, Misfit, MisfitGroup, SchemaError, SharingError};

use models_databases::DatabaseOp;
pub use models_databases::position::Position;
pub use models_databases::views::{CardPosition, DatabaseView, ViewId, ViewPosition};
pub use models_databases::{
    ChangeId, ColumnId, DatabaseId, OptionId, QueryId, RowId, TableId, TableVersion, TakenId,
};

use crate::domain::journal::{JournalPlan, RestoredRow};

/// Identifier of a `models_properties` property definition bound as a column.
pub type PropertyDefinitionId = Uuid;

/// A database: a named collection of tables, owned and shared as one entity.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    /// Identifier.
    #[schema(value_type = Uuid)]
    pub id: DatabaseId,
    /// Display name.
    pub name: String,
    /// Owning user.
    pub owner_id: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
    /// Set when trashed.
    #[schema(required = true)]
    pub trashed_at: Option<DateTime<Utc>>,
}

/// One table (tab) of a database.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize, Deserialize)]
pub struct Table {
    /// Identifier.
    #[schema(value_type = Uuid)]
    pub id: TableId,
    /// Owning database.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// Display name; also the basis of the table's SQL name.
    pub name: String,
    /// Fractional index for tab ordering.
    #[schema(value_type = String)]
    pub position: Position,
    /// Current version.
    pub version: TableVersion,
}

/// A schema operation reserved by a feature using a column.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    strum::Display,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ColumnProtection {
    /// The column must remain present.
    Delete,
    /// The column's type and binding must remain stable.
    ChangeType,
}

/// A column: the placement of a property definition on a table.
///
/// The definition carries name, [`DataType`], multi-select flag, and options;
/// this carries only where it appears and column-kind configuration.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Column {
    /// Identifier of the placement.
    #[schema(value_type = Uuid)]
    pub id: ColumnId,
    /// Table the column appears on.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// The bound property definition.
    #[schema(value_type = Uuid)]
    pub property_definition_id: PropertyDefinitionId,
    /// Fractional index for column ordering.
    #[schema(value_type = String)]
    pub position: Position,
    /// Column-kind specific configuration.
    #[schema(required = true)]
    pub config: Option<ColumnConfig>,
    /// The placement's own label, which also names it in SQL; `None` shows
    /// the definition's name.
    #[serde(default)]
    #[schema(required = true)]
    pub display_name: Option<String>,
    /// Whether the first nonempty value may settle this new text column's type.
    #[serde(default)]
    #[schema(required = true)]
    pub infer_type: bool,
    /// Schema operations reserved by a feature; ordinary edits cannot clear them.
    #[serde(default)]
    pub protections: Vec<ColumnProtection>,
    /// Whether a row may omit this cell; empty collections also count as absent.
    #[serde(default = "column_nullable_default")]
    pub nullable: bool,
}

/// Whether a stored cell satisfies a required column. Empty collections represent
/// no selection; scalar values, including empty text, zero and false, are present.
pub(crate) fn cell_has_value(value: &PropertyValue) -> bool {
    match value {
        PropertyValue::SelectOption(values) => !values.is_empty(),
        PropertyValue::EntityRef(values) => !values.is_empty(),
        PropertyValue::Link(values) => !values.is_empty(),
        PropertyValue::Bool(_)
        | PropertyValue::Num(_)
        | PropertyValue::Str(_)
        | PropertyValue::Date(_) => true,
    }
}

pub(crate) fn column_nullable_default() -> bool {
    true
}

impl Column {
    /// The name the placement goes by: its own, else its definition's.
    pub fn name<'a>(
        &'a self,
        definition: &'a models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions,
    ) -> &'a str {
        self.display_name
            .as_deref()
            .unwrap_or(&definition.definition.display_name)
    }

    /// Whether the placement relates rows of another table.
    pub fn is_relation(&self) -> bool {
        matches!(self.config, Some(ColumnConfig::Link { .. }))
    }
}

/// What changing a column to one type would do to its values: the dry run
/// of a type change, for one target.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize)]
pub struct ColumnCast {
    /// The target property type.
    pub data_type: DataType,
    /// Whether the target holds several values.
    pub is_multi_select: bool,
    /// The target's entity kind, for a reference column.
    #[schema(required = true, value_type = Option<models_properties::EntityType>)]
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Whether the target is a relation to another table's rows.
    pub relation: bool,
    /// Whether the values convert.
    pub cast: CastVerdict,
    /// Why nothing converts, for a `never` cast.
    #[schema(required = true)]
    pub reason: Option<String>,
    /// For a `checked` cast, how many cells would not convert.
    pub failures: usize,
    /// For a `checked` cast with failures, what is wrong with them, as in
    /// `3 values aren't numbers`.
    #[schema(required = true)]
    pub summary: Option<String>,
    /// Up to three of the values that would not convert.
    pub examples: Vec<String>,
}

/// What a column's values become under another type, for a new column of
/// that type beside it: the values that convert, the options they need,
/// and how many do not convert. Nothing is changed by reading it.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnConversion {
    /// The table's version the cells were read at; a batch writing the new
    /// column sends it as its base version.
    pub table_version: TableVersion,
    /// The option labels a new select or tag column needs, in order.
    pub options: Vec<String>,
    /// Each row whose value converts, with that value, options named by
    /// label.
    pub cells: Vec<ConvertedCell>,
    /// How many values do not convert, and are left out.
    pub misfits: u32,
}

/// One row's converted value.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize)]
pub struct ConvertedCell {
    /// The row.
    #[schema(value_type = Uuid)]
    pub row: RowId,
    /// Its value under the new type.
    pub value: models_databases::CellValue,
}

/// Whether a column's values convert to a type.
#[derive(utoipa::ToSchema, Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CastVerdict {
    /// Every value converts.
    Safe,
    /// The values were checked; `failures` say how many do not convert.
    Checked,
    /// No value converts while the column holds any.
    Never,
}

/// Fully validated replacement values for an atomic column rebind.
#[derive(Debug, Clone, PartialEq)]
pub struct ColumnReplacement {
    /// Existing placement and binding, used as a compare-and-swap guard.
    pub column: Column,
    /// Fresh definition owned by this database.
    pub definition_id: PropertyDefinitionId,
    /// Requested relationship configuration, if any.
    pub config: Option<ColumnConfig>,
    /// Converted values for every nonempty source cell, keyed by row identity.
    pub values: Vec<(RowId, PropertyValue)>,
}

/// Column-kind specific configuration stored on the placement.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ColumnConfig {
    /// A relation column: its cells reference rows of another table.
    Link {
        /// Target database.
        #[schema(value_type = Uuid)]
        database_id: DatabaseId,
        /// Target table.
        #[schema(value_type = Uuid)]
        table_id: TableId,
    },
}

/// A row's identity and place in its table. Cells are not here: they are
/// entity properties of the `DATABASE_ROW` entity the id names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowRef {
    /// Identifier.
    pub id: RowId,
    /// Fractional index for manual ordering.
    pub position: Position,
}

/// What a new database starts with: one table whose only column, a text
/// column that infers its type from its first value, holds each row's title.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FirstTable {
    /// The table's display name.
    pub name: &'static str,
    /// The title column's display name.
    pub title_column: &'static str,
}

/// Command to create a database (with its [`FirstTable`]).
#[derive(Debug, Clone)]
pub struct CreateDatabase {
    /// Display name.
    pub name: String,
    /// Owner.
    pub owner_id: MacroUserIdStr<'static>,
    /// The agent creating it for the owner; `None` when the owner acts.
    pub acting_bot: Option<BotId>,
}

/// Settle a new empty column's type using its first value.
#[derive(Debug, Clone)]
pub struct InferColumnType {
    /// Table containing the placement.
    pub table_id: TableId,
    /// Placement to settle.
    pub column_id: ColumnId,
    /// Requested first-value type: string, number, or entity.
    pub data_type: DataType,
    /// Required when the inferred type is an entity reference.
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Version of the schema used to interpret the first value.
    pub base_version: TableVersion,
}

/// Settled schema and the version against which its first value can be written.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct InferColumnTypeOutcome {
    /// Updated placement, property definition, and SQL name.
    pub column: ColumnDetail,
    /// Version after settling the column.
    pub table_version: TableVersion,
}

/// The acting viewer: the user a listing, a read or a write is scoped to.
#[derive(Debug, Clone)]
pub struct Viewer {
    /// The user acting.
    pub user_id: MacroUserIdStr<'static>,
    /// The agent acting for that user; `None` when the user acts. Only
    /// attribution reads it: what the viewer can reach stays scoped to
    /// `user_id`.
    pub acting_bot: Option<BotId>,
}

/// Cells of one row to set, or with `None` to clear, by definition.
pub type CellChanges = Vec<(PropertyDefinitionId, Option<PropertyValue>)>;

/// A property definition a write creates for the database, under ids the
/// service minted (and, for a new column's options, the client).
#[derive(Debug, Clone, PartialEq)]
pub struct NewDefinition {
    /// The definition's id.
    pub id: PropertyDefinitionId,
    /// Its name.
    pub name: String,
    /// Its type.
    pub data_type: DataType,
    /// Whether a cell holds several values.
    pub is_multi_select: bool,
    /// What a reference column points at.
    pub specific_entity_type: Option<models_properties::EntityType>,
    /// Its options, in order.
    pub options: Vec<(OptionId, PropertyOptionValue)>,
}

/// One op's writes, every value already checked against its column as the
/// ops before it leave the schema.
#[derive(Debug, Clone, PartialEq)]
pub enum Write {
    /// The op changes nothing: a rename to the name already there, a type
    /// change to the type the column has, options it already has.
    Unchanged {
        /// The table the op named.
        table_id: TableId,
    },
    /// Add a table after the database's others.
    CreateTable {
        /// Its id.
        table_id: TableId,
        /// Its name.
        name: String,
    },
    /// Rename a table, provided it still goes by `from` and no other table
    /// took `name` first.
    RenameTable {
        /// The table.
        table_id: TableId,
        /// The name the batch read it by.
        from: String,
        /// Its new name.
        name: String,
    },
    /// Remove a table with its columns, rows and views, provided the
    /// database has another.
    DeleteTable {
        /// The table.
        table_id: TableId,
        /// Its version when the batch read it, which its change event
        /// carries.
        version: TableVersion,
    },
    /// Give every table of the database a new position, provided they are
    /// still exactly these.
    OrderTables {
        /// Every table, in its new order.
        tables: Vec<TableId>,
        /// Each table's new key, in the same order.
        positions: Vec<Position>,
    },
    /// Add a column, creating its definition first when it is new.
    CreateColumn {
        /// The placement, its id and position minted.
        column: Column,
        /// The definition to create, for a new property.
        definition: Option<NewDefinition>,
    },
    /// Relabel a column, provided its own label is still `from`.
    RenameColumn {
        /// The column's table.
        table_id: TableId,
        /// The column.
        column_id: ColumnId,
        /// Its own label when the batch read it.
        from: Option<String>,
        /// Its new label.
        name: String,
    },
    /// Remove a column, provided it is still bound to its definition, and
    /// store the table's views that named it, without it.
    DeleteColumn {
        /// The column's table.
        table_id: TableId,
        /// The column.
        column_id: ColumnId,
        /// The definition it was bound to.
        definition_id: PropertyDefinitionId,
        /// The views that named it, rewritten without it.
        views: Vec<DatabaseView>,
        /// The table a relation pointed at, which sees the relation go.
        related: Option<(DatabaseId, TableId)>,
    },
    /// Give a table's columns new positions.
    OrderColumns {
        /// The table.
        table_id: TableId,
        /// Each column with its new key.
        positions: Vec<(ColumnId, Position)>,
    },
    /// Swap a column onto a new definition with its converted cells,
    /// provided the table is still at the version its cells were read at.
    ReplaceColumn {
        /// The column's table.
        table_id: TableId,
        /// The version its cells were read at; `None` for a column of a
        /// table the batch created, which has no stored cells.
        read_version: Option<TableVersion>,
        /// The definition to create; `None` to bind back one the column had
        /// before, which still exists with its options.
        definition: Option<NewDefinition>,
        /// The rebind and its converted cells.
        replacement: ColumnReplacement,
        /// The table's views whose filters tested the old values, without
        /// those tests.
        views: Vec<DatabaseView>,
    },
    /// Add options to a definition.
    AddOptions {
        /// The table the op named.
        table_id: TableId,
        /// Every table of the database binding the definition.
        tables: Vec<TableId>,
        /// The definition.
        definition_id: PropertyDefinitionId,
        /// The options, under their ids.
        options: Vec<(OptionId, PropertyOptionValue)>,
    },
    /// Append rows, in order, with the cells each starts with.
    InsertRows {
        /// The table.
        table_id: TableId,
        /// One entry per new row.
        rows: Vec<Vec<(PropertyDefinitionId, PropertyValue)>>,
        /// The ids and positions the rows come back under, one per row,
        /// when the insert puts back rows a removal took; empty to mint
        /// new ones after the table's last row.
        restored: Vec<RestoredRow>,
    },
    /// Set (or, with `None`, clear) cells of existing rows of the table.
    UpdateRows {
        /// The table the rows must belong to.
        table_id: TableId,
        /// Each row with its cells.
        rows: Vec<(RowId, CellChanges)>,
    },
    /// Remove rows of the table with their cells.
    DeleteRows {
        /// Refuse an undo's removal while another entity references these rows.
        only_if_unreferenced: bool,
        /// The table the rows must belong to.
        table_id: TableId,
        /// The rows.
        rows: Vec<RowId>,
    },
    /// Change one option of a definition in place; every cell holding it
    /// keeps it.
    UpdateOption {
        /// The table the op named.
        table_id: TableId,
        /// Every table of the database binding the definition, the op's
        /// own among them: each sees the option change.
        tables: Vec<TableId>,
        /// The definition.
        definition_id: PropertyDefinitionId,
        /// The option.
        option_id: OptionId,
        /// Its new value, when its label changes.
        value: Option<PropertyOptionValue>,
        /// Its new hex colour, or `None` to clear it; when it changes.
        color: Option<Option<String>>,
    },
    /// Remove one option of a definition and take it out of every cell
    /// holding it, emptying the cells left with nothing, out of the views
    /// naming it, and out of the boards with a lane for it.
    DeleteOption {
        /// Refuse removal while any entity selects this option.
        only_if_unused: bool,
        /// The table the op named.
        table_id: TableId,
        /// Every table of the database binding the definition, the op's
        /// own among them.
        tables: Vec<TableId>,
        /// The definition.
        definition_id: PropertyDefinitionId,
        /// The option.
        option_id: OptionId,
        /// The views of those tables that named the option, without it.
        views: Vec<DatabaseView>,
    },
    /// Store a new view.
    CreateView {
        /// The view, its id, position and times minted.
        view: DatabaseView,
    },
    /// Replace a view's name, query and layout.
    UpdateView {
        /// The view as it becomes.
        view: DatabaseView,
        /// Whether its board is grouped by another column now, so where its
        /// cards were means nothing any more.
        regrouped: bool,
    },
    /// Remove a view and where its cards were.
    DeleteView {
        /// The view's table.
        table_id: TableId,
        /// The view.
        view_id: ViewId,
    },
    /// Give a table's views new positions.
    OrderViews {
        /// The table.
        table_id: TableId,
        /// Every view of the table with its new key.
        positions: Vec<ViewPosition>,
    },
    /// Move a board's card: store the places a move gives cards, and set
    /// the card's grouping cell to its new lane.
    MoveCard {
        /// The board's table.
        table_id: TableId,
        /// The board.
        view_id: ViewId,
        /// The card's row, which must belong to the table.
        row: RowId,
        /// The places to store, the moved card's last.
        positions: Vec<CardPosition>,
        /// The grouping column's definition, and the card's new value there.
        cell: (PropertyDefinitionId, Option<PropertyValue>),
    },
}

impl Write {
    /// The tables whose versions the write bumps when it changes anything,
    /// each of which must be live when the batch is applied. A table the
    /// write creates is not among them, nor one it removes.
    pub fn versioned_tables(&self) -> &[TableId] {
        match self {
            Write::Unchanged { .. } | Write::CreateTable { .. } | Write::DeleteTable { .. } => &[],
            Write::RenameTable { table_id, .. }
            | Write::RenameColumn { table_id, .. }
            | Write::DeleteColumn { table_id, .. }
            | Write::OrderColumns { table_id, .. }
            | Write::ReplaceColumn { table_id, .. }
            | Write::InsertRows { table_id, .. }
            | Write::UpdateRows { table_id, .. }
            | Write::DeleteRows { table_id, .. }
            | Write::DeleteView { table_id, .. }
            | Write::OrderViews { table_id, .. }
            | Write::MoveCard { table_id, .. } => std::slice::from_ref(table_id),
            Write::CreateColumn { column, .. } => std::slice::from_ref(&column.table_id),
            Write::CreateView { view } | Write::UpdateView { view, .. } => {
                std::slice::from_ref(&view.table_id)
            }
            Write::OrderTables { tables, .. } => tables,
            Write::AddOptions { tables, .. }
            | Write::UpdateOption { tables, .. }
            | Write::DeleteOption { tables, .. } => tables,
        }
    }

    /// How many rows it inserts, updates or deletes; none for a change to
    /// the schema, an option or a view.
    pub fn affected(&self) -> usize {
        match self {
            Write::InsertRows { rows, .. } => rows.len(),
            Write::UpdateRows { rows, .. } => rows.len(),
            Write::DeleteRows { rows, .. } => rows.len(),
            _ => 0,
        }
    }

    /// Whether it changes anything, and so bumps its tables' versions. A
    /// view's change bumps its table's too, so open clients pick it up.
    pub fn changes(&self) -> bool {
        match self {
            Write::Unchanged { .. } => false,
            Write::InsertRows { .. } | Write::UpdateRows { .. } | Write::DeleteRows { .. } => {
                self.affected() > 0
            }
            _ => true,
        }
    }
}

/// A request's writes, applied in one transaction: every write and version
/// bump commits, or none does.
#[derive(Debug, Clone, PartialEq)]
pub struct Writes {
    /// The database every write is in.
    pub database_id: DatabaseId,
    /// Who the inserted rows are created by.
    pub created_by: MacroUserIdStr<'static>,
    /// The writes, in the order the ops were sent.
    pub writes: Vec<Write>,
    /// Rows relation cells point at, each with the table it must belong to.
    pub related_rows: Vec<(TableId, RowId)>,
    /// The versions tables must still be at when the batch takes their
    /// locks: the caller's base versions.
    pub expected_versions: Vec<(TableId, TableVersion)>,
    /// What the batch's journal entries are built from.
    pub journal: JournalPlan,
}

impl Writes {
    /// Whether a write adds, renames, removes or reorders tables, which
    /// takes the database's lock rather than a share of it.
    pub fn changes_tables(&self) -> bool {
        self.writes.iter().any(|write| {
            matches!(
                write,
                Write::CreateTable { .. }
                    | Write::RenameTable { .. }
                    | Write::DeleteTable { .. }
                    | Write::OrderTables { .. }
            )
        })
    }
}

/// What applying [`Writes`] did. Anything but `Applied` wrote nothing.
#[derive(Debug, Clone, PartialEq)]
pub enum WritesOutcome {
    /// The final batch would leave a required cell empty; nothing committed.
    MissingRequiredCell {
        /// The write that affected the row or its schema.
        write: usize,
        /// The required column.
        column: ColumnId,
        /// The row missing its value.
        row: RowId,
    },
    /// A row the undo would remove has a surviving incoming relation.
    RowInUse,
    /// An option the batch must leave unused is selected by an entity.
    OptionInUse,
    /// Everything committed.
    Applied {
        /// Per write, the rows it inserted; empty for everything else.
        inserted: Vec<Vec<RowId>>,
        /// The new version of every table a write changed, bumped once.
        table_versions: HashMap<TableId, TableVersion>,
        /// The journal's change for each table version the batch produced.
        changes: Vec<CommittedChange>,
    },
    /// A table whose schema the batch changes moved after the batch was
    /// planned: planned again, it is planned against what is there now.
    SchemaMoved(TableId),
    /// The database is gone or trashed, or a written table is gone.
    TableNotFound(TableId),
    /// A table is no longer at the version it was expected at.
    VersionConflict(TableId),
    /// A write created something under an id that already names something.
    IdTaken {
        /// The write's index.
        write: usize,
        /// The id.
        id: TakenId,
    },
    /// Another table took a write's table name first.
    TableNameTaken {
        /// The write's index.
        write: usize,
    },
    /// A write renamed a table that was renamed meanwhile.
    TableRenamedElsewhere {
        /// The write's index.
        write: usize,
    },
    /// A write removed the database's last table.
    LastTable {
        /// The write's index.
        write: usize,
    },
    /// The database's tables changed under a reorder.
    TablesChanged {
        /// The write's index.
        write: usize,
    },
    /// A write named a column that was removed or retyped meanwhile.
    MissingColumn {
        /// The write's index.
        write: usize,
    },
    /// A column became protected before the batch committed.
    ColumnProtected {
        /// The write's index.
        write: usize,
        /// The reserved operation.
        capability: ColumnProtection,
    },
    /// A write relabeled a column that was relabeled meanwhile.
    ColumnRenamedElsewhere {
        /// The write's index.
        write: usize,
    },
    /// A write named an option its definition no longer has.
    MissingOption {
        /// The write's index.
        write: usize,
    },
    /// A write gave an option a label another option of its definition
    /// took first.
    OptionLabelTaken {
        /// The write's index.
        write: usize,
    },
    /// A write named a view its table no longer has.
    MissingView {
        /// The write's index.
        write: usize,
    },
    /// A write gave a view a name another view of its table took first.
    ViewNameTaken {
        /// The write's index.
        write: usize,
    },
    /// A write named a row its table does not have.
    MissingRow {
        /// The write's index.
        write: usize,
        /// The row.
        row: RowId,
    },
    /// A relation cell named a row its target table does not have.
    MissingRelatedRow(RowId),
    /// A write put a removed row back under an id a row has again.
    RowTaken {
        /// The write's index.
        write: usize,
        /// The row.
        row: RowId,
    },
}

/// One change a committed batch journaled: a table, the version the batch
/// produced, and the journal's id for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommittedChange {
    /// The table.
    #[schema(value_type = Uuid)]
    pub table: TableId,
    /// The version the batch produced.
    pub version: TableVersion,
    /// The journal's id of the change.
    #[schema(value_type = i64)]
    pub change: ChangeId,
}

/// What a committed batch answers: a result per op, and the journal's change
/// for each table version it produced.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedOps {
    /// One result per op, in order.
    pub results: Vec<models_databases::OpResult>,
    /// The journal's changes.
    pub changes: Vec<CommittedChange>,
}

/// A batch of ops for one database and the versions its tables must be at.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct OpBatch {
    /// The ops, in the order they apply.
    pub ops: Vec<DatabaseOp>,
    /// The version each named table must still be at; the batch is refused
    /// as a conflict if one moved. Without one, ops are last-write-wins.
    pub base_versions: HashMap<TableId, TableVersion>,
}

impl From<Vec<DatabaseOp>> for OpBatch {
    fn from(ops: Vec<DatabaseOp>) -> Self {
        Self {
            ops,
            base_versions: HashMap::new(),
        }
    }
}

/// Why an op of a batch was refused: which op, and where relevant which row
/// and column. Nothing in the batch was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpRefusal {
    /// The op's index in the request.
    pub op: usize,
    /// The row's index within the op.
    pub row: Option<usize>,
    /// The column placement.
    pub column: Option<ColumnId>,
    /// An id the op minted that already names something.
    pub taken: Option<TakenId>,
    /// What is wrong.
    pub reason: String,
}

impl std::fmt::Display for OpRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "op {}", self.op)?;
        if let Some(row) = self.row {
            write!(f, ", row {row}")?;
        }
        if let Some(column) = self.column {
            write!(f, ", column {column}")?;
        }
        write!(f, ": {}", self.reason)
    }
}

/// What a saved query asks. Serialized as `{"version": 1, "query": "<sql>"}`:
/// the integer version tags the shape, so a later version can change the
/// fields without breaking the stored rows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueryDefinition {
    /// A read-only SQL statement.
    V1 {
        /// The SELECT, in the databases dialect.
        query: String,
    },
}

impl QueryDefinition {
    /// The SQL the definition runs.
    pub fn sql(&self) -> &str {
        match self {
            QueryDefinition::V1 { query } => query,
        }
    }
}

impl Serialize for QueryDefinition {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        match self {
            QueryDefinition::V1 { query } => {
                let mut state = serializer.serialize_struct("QueryDefinition", 2)?;
                state.serialize_field("version", &1u8)?;
                state.serialize_field("query", query)?;
                state.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for QueryDefinition {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Versioned {
            version: u8,
            query: String,
        }
        let versioned = Versioned::deserialize(deserializer)?;
        match versioned.version {
            1 => Ok(QueryDefinition::V1 {
                query: versioned.query,
            }),
            other => Err(serde::de::Error::custom(format!(
                "unsupported query definition version {other}"
            ))),
        }
    }
}

impl utoipa::ToSchema for QueryDefinition {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("QueryDefinition")
    }
}

impl utoipa::PartialSchema for QueryDefinition {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{ObjectBuilder, Type};
        ObjectBuilder::new()
            .description(Some("A versioned query definition."))
            .property(
                "version",
                ObjectBuilder::new()
                    .schema_type(Type::Integer)
                    .enum_values(Some([1])),
            )
            .required("version")
            .property(
                "query",
                ObjectBuilder::new()
                    .schema_type(Type::String)
                    .description(Some("A read-only SELECT in the databases dialect.")),
            )
            .required("query")
            .into()
    }
}

/// A stored, immutable query. Editing a question saves a new one.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    /// Identifier.
    #[schema(value_type = Uuid)]
    pub id: QueryId,
    /// What it asks.
    pub definition: QueryDefinition,
    /// The database whose tables win name resolution; `null` once that
    /// database is deleted, or when none was given.
    #[schema(required = true, value_type = Option<Uuid>)]
    pub database_id: Option<DatabaseId>,
    /// Who saved it; `null` once that user is deleted.
    #[schema(required = true)]
    pub created_by: Option<String>,
    /// When it was saved.
    pub created_at: DateTime<Utc>,
}

/// A database as listed for a viewer.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ListedDatabase {
    /// The database.
    pub database: Database,
    /// The viewer's access.
    pub grant: AccessLevel,
    /// Tables in tab order, so discovery can find a table independently of
    /// the containing database's display name.
    pub tables: Vec<Table>,
}

/// Everything a client needs to render and edit one database: tables,
/// column placements with their definitions, and the SQL names the query
/// surface exposes them under.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct DatabaseDetail {
    /// The database.
    pub database: Database,
    /// The viewer's access.
    pub grant: AccessLevel,
    /// Tables in tab order.
    pub tables: Vec<TableDetail>,
}

/// One table with its columns and SQL name.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct TableDetail {
    /// The table.
    pub table: Table,
    /// The name SQL refers to the table by: its display name quoted and
    /// qualified by the database's (`FROM "Plans"."Table 1"`).
    pub sql_name: String,
    /// Columns in display order.
    pub columns: Vec<ColumnDetail>,
    /// The table's views, in their order.
    pub views: Vec<DatabaseView>,
}

/// One column placement with the definition behind it.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ColumnDetail {
    /// The placement.
    pub column: Column,
    /// The name SQL refers to the column by: its display name, quoted.
    pub sql_name: String,
    /// The bound definition (name, type, options).
    pub definition:
        models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions,
    /// Whether SQL may write this column.
    pub writable: bool,
    /// Whether the definition belongs to something beyond this database (a
    /// person's, a team's or a system property), so changing its options
    /// changes them everywhere that property is used.
    pub shared_outside_database: bool,
}

impl ColumnDetail {
    /// The name the column goes by: the placement's own, else the
    /// definition's.
    pub fn name(&self) -> &str {
        self.column.name(&self.definition)
    }

    /// Whether a cell holds several values: a relation always does.
    pub fn is_multi_valued(&self) -> bool {
        self.definition.definition.is_multi_select || self.column.is_relation()
    }

    /// The Macro entity kind the column references; a relation references
    /// rows of a table instead.
    pub fn entity_type(&self) -> Option<models_properties::EntityType> {
        if self.column.is_relation() {
            return None;
        }
        self.definition.definition.specific_entity_type
    }
}

impl DatabaseDetail {
    /// Whether the viewer may write the database's rows and schema.
    pub fn writable(&self) -> bool {
        grant_writes(self.grant)
    }
}

/// Whether a grant lets its holder write rows and change the schema.
pub fn grant_writes(grant: AccessLevel) -> bool {
    grant >= AccessLevel::Edit
}

/// Where one viewer is inside a database right now: ephemeral, relayed to
/// the other viewers and never stored. A missing row or column means the
/// viewer is on the table but on no cell. Optional end row and column IDs
/// mark the opposite corner of a rectangular cell selection.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Awareness {
    /// This mounted client's random peer id, distinct from its authenticated user.
    /// Older clients omit it and remain visible as one peer per user.
    #[schema(value_type = Option<Uuid>, nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_id: Option<Uuid>,
    /// The table the viewer is looking at.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// The row of the focused cell, if any.
    #[schema(value_type = Option<Uuid>, nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_id: Option<RowId>,
    /// The column placement of the focused cell, if any.
    #[schema(value_type = Option<Uuid>, nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_id: Option<ColumnId>,
    /// The opposite row corner of a selected rectangle, if any.
    #[schema(value_type = Option<Uuid>, nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_row_id: Option<RowId>,
    /// The opposite column corner of a selected rectangle, if any.
    #[schema(value_type = Option<Uuid>, nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_column_id: Option<ColumnId>,
    /// Whether the cell is open for editing.
    #[serde(default)]
    pub editing: bool,
    /// Whether the viewer left the database; other viewers drop their state.
    #[serde(default)]
    pub left: bool,
}

/// Errors for schema and persistence operations.
#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    /// Undo would remove a row with a surviving incoming relation.
    #[error("This row is now referenced elsewhere.")]
    RowInUse,
    /// Undo would remove an option that an entity still selects.
    #[error("This option is now in use.")]
    OptionInUse,
    /// The database, table, column, or row does not exist (or is invisible
    /// to the viewer, which is deliberately indistinguishable).
    #[error("not found")]
    NotFound,
    /// The caller lacks the permission the operation requires.
    #[error("unauthorized")]
    Unauthorized,
    /// A schema operation was refused.
    #[error("invalid schema operation: {0}")]
    InvalidSchemaOperation(SchemaError),
    /// A sharing change was refused.
    #[error("invalid sharing change: {0}")]
    InvalidSharing(SharingError),
    /// The schema changed after the client read its version.
    #[error("The table changed since it was read. Refresh and try again.")]
    VersionConflict,
    /// An op of a batch was refused, so none of the batch was written.
    #[error("{0}")]
    InvalidOp(OpRefusal),
    /// Persistence failure.
    #[error("repository error: {0}")]
    Repo(rootcause::Report),
}

impl From<SchemaError> for DatabaseError {
    fn from(error: SchemaError) -> Self {
        DatabaseError::InvalidSchemaOperation(error)
    }
}

impl From<SharingError> for DatabaseError {
    fn from(error: SharingError) -> Self {
        DatabaseError::InvalidSharing(error)
    }
}

/// Why a saved query could not be stored or read.
#[derive(Debug, thiserror::Error)]
pub enum SavedQueryError {
    /// The saved query, or the database it is scoped to, does not exist or
    /// is invisible to the viewer.
    #[error("not found")]
    NotFound,
    /// The query is longer than any saved query may be.
    #[error("the query is too long")]
    TooLong,
    /// Persistence failure.
    #[error("repository error: {0}")]
    Repo(rootcause::Report),
}
