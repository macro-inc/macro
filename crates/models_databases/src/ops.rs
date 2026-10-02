//! Ops: the whole write surface of a database, its schema and its data, and
//! what each one did.
//!
//! A request's ops apply in order, in one transaction, so a later op may name
//! what an earlier one created: tables, columns, options and views carry ids
//! the client mints (UUIDv7, `TableId::new()` and the like). An id that
//! already names something refuses the request. Rows keep server-minted ids,
//! which an insert's result answers.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};

use crate::ids::{ColumnId, DatabaseId, OptionId, PropertyId, RowId, TableId, TableVersion};
use crate::views::{
    CardPosition, DatabaseView, LaneKey, NewView, RequestedLayout, ViewId, ViewPosition, ViewQuery,
};

/// One write to a database: its tables, columns, options, rows or views,
/// grouped by the resource it changes. A request's ops apply in order and
/// together, or not at all, and every op names a table of the database the
/// request is for (or, creating one, adds it there).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseOp {
    /// A change to a table itself: its creation, name, removal, or the
    /// order of its columns or views.
    Table {
        /// The table; for a creation, its new id, minted by the client, which
        /// later ops of the request may name.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// What changes.
        change: TableChange,
    },
    /// A change to one column of a table: its creation, name, type, removal
    /// or options.
    Column {
        /// The table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// The column; for a creation, its new id, minted by the client,
        /// which later ops of the request may name.
        #[schema(value_type = Uuid)]
        column: ColumnId,
        /// What changes.
        change: ColumnChange,
    },
    /// A write to a table's rows.
    Rows {
        /// The table the rows belong to.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// What changes.
        change: RowsChange,
    },
    /// A change to one view of a table.
    View {
        /// The view's table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// The view; for a creation, its new id, minted by the client.
        #[schema(value_type = Uuid)]
        view: ViewId,
        /// What changes.
        change: ViewChange,
    },
    /// Set the order of the database's tables: `order` names every one of
    /// them once.
    ReorderTables {
        /// Every table, in its new order.
        #[schema(value_type = Vec<Uuid>)]
        order: Vec<TableId>,
    },
}

/// A change to a table itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TableChange {
    /// Add the table, after the database's other tables. It starts with no
    /// columns and no rows.
    Create {
        /// Its name, unique within the database ignoring case.
        name: String,
    },
    /// Rename the table. Its id, columns and rows stay.
    #[serde(rename_all = "camelCase")]
    Rename {
        /// Its new name, unique within the database ignoring case.
        name: String,
        /// The name the caller saw. Given, the rename is refused if the
        /// table goes by another one now, so a concurrent rename is not
        /// overwritten.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        previous_name: Option<String>,
    },
    /// Remove the table with its columns, rows and views. A database keeps
    /// at least one table, and a table another table's relation points at
    /// stays until that relation goes.
    Delete,
    /// Set the order of the table's columns: `order` names every one of
    /// them once.
    ReorderColumns {
        /// Its columns, in their new order.
        #[schema(value_type = Vec<Uuid>)]
        order: Vec<ColumnId>,
    },
    /// Set the order of the table's views: `order` names every one of them
    /// once.
    ReorderViews {
        /// Its views, in their new order.
        #[schema(value_type = Vec<Uuid>)]
        order: Vec<ViewId>,
    },
}

/// A change to one column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColumnChange {
    /// Add the column to the table: a new property the database owns, or an
    /// existing one bound into the table.
    Create {
        /// What the column holds.
        definition: NewColumn,
        /// The column it goes right after; left out, it goes after the
        /// table's last column.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false, value_type = Option<Uuid>)]
        #[specta(optional)]
        after: Option<ColumnId>,
    },
    /// Rename the column. Its id, type and cells stay; SQL names it by its
    /// new name.
    #[serde(rename_all = "camelCase")]
    Rename {
        /// Its new name, unique within the table ignoring case.
        name: String,
        /// The name the caller saw. Given, the rename is refused if the
        /// column goes by another one now.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        previous_name: Option<String>,
    },
    /// Convert the column to another type, converting its cells; its id
    /// survives the change. A value that does not fit refuses the change,
    /// counting and quoting the misfits: a type change never empties a
    /// cell. To keep the original, create a column of the new type and
    /// write it the values that convert.
    ChangeType {
        /// The type it becomes.
        to: ColumnKind,
    },
    /// Remove the column and its cells. The views naming it forget it; a
    /// board grouped by it must go or regroup first. A property shared
    /// beyond the database stays, unbound here.
    Delete,
    /// Add options to a select or tag column, after its others. An option
    /// whose label the column already has, ignoring case, is left out, so
    /// re-sending a list adds only what is new. Like
    /// [`ColumnChange::UpdateOption`], an option of a property shared beyond
    /// the database goes everywhere it is used.
    AddOptions {
        /// The options, each under an id the client mints.
        options: Vec<NewOption>,
    },
    /// Relabel or recolour one option of a select or tag column. Every cell
    /// holding it keeps it. A column bound to a property shared outside the
    /// database changes wherever that property is used, so it takes the
    /// right to edit that property.
    UpdateOption {
        /// The option.
        #[schema(value_type = Uuid)]
        option: OptionId,
        /// Its new label; left out, it keeps its own. Labels are unique
        /// within a column, ignoring case.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        label: Option<String>,
        /// Its new colour, a hex string like `#RRGGBB`, or `null` to clear
        /// it; left out, it keeps its own. A tag option always has one.
        #[serde(
            default,
            deserialize_with = "present",
            skip_serializing_if = "Option::is_none"
        )]
        #[schema(value_type = Option<String>)]
        #[specta(type = Option<String>, optional)]
        color: Option<Option<String>>,
    },
    /// Remove one option of a select or tag column, and take it out of every
    /// cell holding it: a single-valued cell is emptied, a multi-valued one
    /// keeps its other options. Like [`ColumnChange::UpdateOption`], an
    /// option of a shared property goes everywhere it is used.
    DeleteOption {
        /// The option.
        #[schema(value_type = Uuid)]
        option: OptionId,
    },
}

/// A write to a table's rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RowsChange {
    /// Append rows to the table, in order, each with the cells it starts
    /// with.
    Insert {
        /// One entry per new row: the cells it starts with. Columns left out
        /// start empty.
        rows: Vec<Vec<CellWrite>>,
    },
    /// Write cells of existing rows. Last write wins: there is no version
    /// check.
    Update {
        /// Which rows get which cells.
        changes: RowChanges,
    },
    /// Remove rows and their cells.
    Delete {
        /// The rows, each named once.
        #[schema(value_type = Vec<Uuid>)]
        rows: Vec<RowId>,
    },
}

/// A change to one view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewChange {
    /// Add the view to the table, after its other views.
    Create {
        /// What it shows and how.
        view: NewView,
    },
    /// Change the view's name, query or layout; what is left out stays.
    Update {
        /// Its new name.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        name: Option<String>,
        /// Its new query.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        query: Option<ViewQuery>,
        /// Its new layout. A board grouped by another column forgets where
        /// its cards were; a board left without a card title keeps the one
        /// it has, or takes the table's first column.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        layout: Option<RequestedLayout>,
    },
    /// Remove the view, with where its cards were.
    Delete,
    /// Move one of the board's cards: into a lane, which sets the row's
    /// grouping cell to the lane's option or person (or empties it for the
    /// lane of empty cells), and to a place there, between two of its
    /// cards. Only an unsorted board's cards move by hand.
    MoveCard {
        /// The card's row.
        #[schema(value_type = Uuid)]
        row: RowId,
        /// The lane it goes to: an option of a select board's column, a
        /// person for a board grouped by people, or the lane of empty cells.
        lane: LaneKey,
        /// The card that ends up just before it (it lands right after this
        /// one), if any.
        #[serde(default)]
        #[schema(value_type = Option<Uuid>)]
        before: Option<RowId>,
        /// The card that ends up just after it, if any. Given with `before`,
        /// it must be the card right after `before`; with neither, the card
        /// goes to the end of the lane.
        #[serde(default)]
        #[schema(value_type = Option<Uuid>)]
        after: Option<RowId>,
    },
}

impl DatabaseOp {
    /// The table the op names: the one it creates, for a creation; `None`
    /// for a reorder of the database's tables, which names them all.
    pub fn table(&self) -> Option<TableId> {
        match self {
            DatabaseOp::ReorderTables { .. } => None,
            DatabaseOp::Table { table, .. }
            | DatabaseOp::Column { table, .. }
            | DatabaseOp::Rows { table, .. }
            | DatabaseOp::View { table, .. } => Some(*table),
        }
    }
}

/// What a new column holds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum NewColumn {
    /// A new property the database owns.
    #[serde(rename_all = "camelCase")]
    New {
        /// The column's name, unique within the table ignoring case.
        name: String,
        /// Its type. A relation names the table whose rows it holds, one the
        /// caller can see.
        #[serde(rename = "type")]
        kind: ColumnKind,
        /// For a select or tag column, the options it starts with, in
        /// order, each under an id the client mints. A select column with
        /// none accepts nothing until options are added.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[schema(nullable = false)]
        #[specta(optional)]
        options: Vec<NewOption>,
        /// Let the column's first value settle its type: only for a plain
        /// text column.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[specta(optional)]
        infer_type: bool,
    },
    /// An existing property, a person's, a team's or a system one, bound
    /// into the table under its own name.
    Existing {
        /// The property's definition.
        #[schema(value_type = Uuid)]
        property: PropertyId,
    },
}

/// A select or tag option to create.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct NewOption {
    /// Its id, minted by the client; later ops of the request may name it.
    #[schema(value_type = Uuid)]
    pub id: OptionId,
    /// Its label, unique within the column ignoring case. A numeric
    /// select's labels are numbers.
    pub label: String,
}

/// A field that is `Some` whenever it is present, so `null` reads as
/// `Some(None)` and a missing one, by `default`, as `None`.
fn present<'de, Value, Input>(deserializer: Input) -> Result<Option<Value>, Input::Error>
where
    Value: Deserialize<'de>,
    Input: Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

/// One cell of a row: which column, and its new value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct CellWrite {
    /// The column placement.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// The value, or [`CellValue::Clear`] to empty the cell.
    pub value: CellValue,
}

/// Which rows an update writes, and with what.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RowChanges {
    /// The same cells on every row.
    Uniform {
        /// The rows.
        #[schema(value_type = Vec<Uuid>)]
        rows: Vec<RowId>,
        /// The cells each of them gets.
        cells: Vec<CellWrite>,
    },
    /// Each row its own cells.
    PerRow {
        /// The rows and their cells, in order.
        rows: Vec<RowChange>,
    },
}

/// One row's cells in a [`RowChanges::PerRow`] update.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
pub struct RowChange {
    /// The row.
    #[schema(value_type = Uuid)]
    pub row: RowId,
    /// Its new cells.
    pub cells: Vec<CellWrite>,
}

/// A cell's value. It must fit the column's type: text for a text column,
/// options of the column for a select, and so on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum CellValue {
    /// Free text.
    Text(String),
    /// A finite number.
    Number(f64),
    /// A checkbox.
    Boolean(bool),
    /// A date-time.
    Date(DateTime<Utc>),
    /// Complete http or https URLs; at most one for a single-valued column.
    Link(Vec<String>),
    /// Options of a select or tag column; at most one for a single-valued
    /// column.
    Options(Vec<OptionRef>),
    /// References to Macro entities of the kind the column points at; at
    /// most one for a single-valued column.
    Entities(Vec<EntityRef>),
    /// Rows of the table a relation column points at.
    #[schema(value_type = Vec<Uuid>)]
    Rows(Vec<RowId>),
    /// No value: the cell is emptied.
    Clear,
}

/// A select option, by its id or by its label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OptionRef {
    /// An option the column has.
    #[schema(value_type = Uuid)]
    Id(OptionId),
    /// An option's label, matched without regard to case. An unknown label
    /// is refused.
    Label(String),
}

/// A reference to one Macro entity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    /// What kind of entity it is; it must be the kind the column points at.
    pub entity_type: EntityKind,
    /// The entity's id.
    pub entity_id: String,
}

/// A kind of Macro entity a reference column can point at.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityKind {
    /// People.
    User,
    /// Documents.
    Document,
    /// Tasks.
    Task,
    /// CRM companies.
    Company,
    /// CRM contacts.
    Contact,
    /// Call recordings.
    CallRecord,
    /// Channels.
    Channel,
    /// AI chats.
    Chat,
    /// Projects.
    Project,
    /// Email threads.
    Thread,
    /// Calendar events.
    CalendarEvent,
    /// Initiatives.
    Initiative,
}

/// A type a column can have.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ColumnKind {
    /// Free text.
    Text,
    /// A number.
    Number,
    /// A checkbox.
    Boolean,
    /// A date-time.
    Date,
    /// A URL.
    Link,
    /// Text options.
    Select {
        /// Whether a cell holds several options.
        multi: bool,
    },
    /// Numeric options.
    SelectNumber {
        /// Whether a cell holds several options.
        multi: bool,
    },
    /// Colored labels; always several per cell.
    Tag,
    /// References to Macro entities.
    Entity {
        /// What the references point at.
        target: EntityKind,
        /// Whether a cell holds several references.
        multi: bool,
    },
    /// Rows of another table.
    Relation {
        /// The database of the related table.
        #[schema(value_type = Uuid)]
        database: DatabaseId,
        /// The related table.
        #[schema(value_type = Uuid)]
        table: TableId,
    },
}

impl EntityKind {
    /// The kind as the properties system and the type names spell it.
    pub fn name(self) -> &'static str {
        self.into()
    }
}

/// What one op did, in the order the ops were sent, grouped as the ops are:
/// a result's `kind` is its op's, naming the same resource, and its
/// `change` says what happened to it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpResult {
    /// What a table op did.
    #[serde(rename_all = "camelCase")]
    Table {
        /// The table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// Its version once the request committed; left out when the op
        /// removed it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        table_version: Option<TableVersion>,
        /// What happened to it.
        change: TableResult,
    },
    /// What a column op did.
    #[serde(rename_all = "camelCase")]
    Column {
        /// The table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// The column.
        #[schema(value_type = Uuid)]
        column: ColumnId,
        /// The table's version once the request committed.
        table_version: TableVersion,
        /// What happened to it.
        change: ColumnResult,
    },
    /// What a rows op did.
    #[serde(rename_all = "camelCase")]
    Rows {
        /// The table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// The table's version once the request committed.
        table_version: TableVersion,
        /// What happened to them.
        change: RowsResult,
    },
    /// What a view op did.
    #[serde(rename_all = "camelCase")]
    View {
        /// The view's table.
        #[schema(value_type = Uuid)]
        table: TableId,
        /// The view.
        #[schema(value_type = Uuid)]
        view: ViewId,
        /// The table's version once the request committed.
        table_version: TableVersion,
        /// What happened to it.
        change: ViewResult,
    },
    /// The database's tables in their new order.
    ReorderTables {
        /// Every table, in its new order, with its version once the request
        /// committed.
        tables: Vec<VersionedTable>,
    },
}

/// What happened to a table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TableResult {
    /// It was added.
    Created,
    /// It was renamed.
    Renamed,
    /// It was removed.
    Deleted,
    /// Its columns were reordered.
    ColumnsReordered,
    /// Its views were reordered.
    ViewsReordered {
        /// Every view's key, in their new order.
        positions: Vec<ViewPosition>,
    },
}

/// What happened to a column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ColumnResult {
    /// It was added.
    Created,
    /// It was renamed.
    Renamed,
    /// Its type changed, and its cells with it.
    TypeChanged,
    /// It was removed.
    Deleted,
    /// It gained options.
    OptionsAdded {
        /// The options created, in order: those sent, less any whose label
        /// the column already had.
        #[schema(value_type = Vec<Uuid>)]
        added: Vec<OptionId>,
    },
    /// One of its options was relabelled or recoloured.
    OptionUpdated,
    /// One of its options was removed.
    OptionDeleted,
}

/// What happened to a table's rows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RowsResult {
    /// Rows were added.
    Inserted {
        /// The new rows, in the order they were sent.
        #[schema(value_type = Vec<Uuid>)]
        rows: Vec<RowId>,
    },
    /// Rows' cells were written.
    Updated {
        /// How many rows the op updated.
        affected: u32,
    },
    /// Rows were removed.
    Deleted {
        /// How many rows the op deleted.
        affected: u32,
    },
}

/// What happened to a view.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ViewResult {
    /// It was added.
    Created {
        /// The view as stored.
        view: Box<DatabaseView>,
    },
    /// It was changed.
    Updated {
        /// The view as stored.
        view: Box<DatabaseView>,
    },
    /// It was removed.
    Deleted,
    /// One of its cards moved.
    CardMoved {
        /// The positions written, the moved card's last.
        positions: Vec<CardPosition>,
    },
}

/// An id a request minted for something new that already names something,
/// which refuses the request: a retried request whose first attempt
/// committed, or an id minted twice.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum TakenId {
    /// A table's.
    #[schema(value_type = Uuid)]
    Table(TableId),
    /// A column's.
    #[schema(value_type = Uuid)]
    Column(ColumnId),
    /// An option's.
    #[schema(value_type = Uuid)]
    Option(OptionId),
    /// A view's.
    #[schema(value_type = Uuid)]
    View(ViewId),
}

/// A table and its version.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
pub struct VersionedTable {
    /// The table.
    #[schema(value_type = Uuid)]
    pub table: TableId,
    /// Its version.
    pub version: TableVersion,
}

impl OpResult {
    /// The version of the op's table once the request committed; `None`
    /// when the op removed it, or names every table of the database.
    pub fn table_version(&self) -> Option<TableVersion> {
        match self {
            OpResult::Table { table_version, .. } => *table_version,
            OpResult::ReorderTables { .. } => None,
            OpResult::Column { table_version, .. }
            | OpResult::Rows { table_version, .. }
            | OpResult::View { table_version, .. } => Some(*table_version),
        }
    }
}
