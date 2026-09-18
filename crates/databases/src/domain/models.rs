//! Domain models: entities, commands, the query/exec pipeline vocabulary,
//! and domain errors.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::DataType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===== Identifiers =====

/// Identifier of a database (the shareable entity users see).
pub type DatabaseId = Uuid;
/// Identifier of one table (tab) within a database.
pub type TableId = Uuid;
/// Identifier of a column placement within a table.
pub type ColumnId = Uuid;
/// Identifier of a row.
pub type RowId = Uuid;
/// Identifier of a `models_properties` property definition bound as a column.
pub type PropertyDefinitionId = Uuid;

/// Monotonic per-table version, bumped on every row/column/link mutation.
///
/// The cache key for query materializations and the invalidation signal for
/// live query chips.
#[derive(
    utoipa::ToSchema, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize,
)]
pub struct TableVersion(pub i64);

// ===== Entities =====

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
    pub position: String,
    /// Current version.
    pub version: TableVersion,
}

/// A column: the placement of a property definition on a table.
///
/// The definition carries name, [`DataType`], multi-select flag, and options;
/// this carries only where it appears and column-kind configuration.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize, Deserialize)]
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
    pub position: String,
    /// Column-kind specific configuration.
    pub config: Option<ColumnConfig>,
}

/// Column-kind specific configuration stored on the placement.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum ColumnConfig {
    /// A link column targeting another table; edges live in the junction.
    Link {
        /// Target database.
        #[schema(value_type = Uuid)]
        database_id: DatabaseId,
        /// Target table.
        #[schema(value_type = Uuid)]
        table_id: TableId,
    },
    /// A derived lookup through a link or entity column on the same table.
    Lookup {
        /// The link/entity column the lookup reads through.
        #[schema(value_type = Uuid)]
        via_column_id: ColumnId,
        /// Target field on the other side (a definition id or magic column name).
        target: String,
    },
}

/// A row: dense cells keyed by property definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    /// Identifier.
    pub id: RowId,
    /// Owning table.
    pub table_id: TableId,
    /// Fractional index for manual ordering.
    pub position: String,
    /// Cell values keyed by property definition id.
    pub cells: HashMap<PropertyDefinitionId, PropertyValue>,
}

// ===== Schema operations (the structured, non-SQL part of the API) =====

/// Command to create a database (with one starter table).
#[derive(Debug, Clone)]
pub struct CreateDatabase {
    /// Display name.
    pub name: String,
    /// Owner.
    pub owner_id: MacroUserIdStr<'static>,
}

/// Command to create a table in a database.
#[derive(Debug, Clone)]
pub struct CreateTable {
    /// Owning database.
    pub database_id: DatabaseId,
    /// Display name.
    pub name: String,
}

/// How a new column obtains its property definition.
#[derive(Debug, Clone)]
pub enum ColumnBinding {
    /// Create a fresh definition scoped to the database.
    NewDefinition {
        /// Column display name.
        name: String,
        /// Value type.
        data_type: DataType,
        /// Whether the column holds multiple values.
        is_multi_select: bool,
    },
    /// Bind an existing user/team/system definition.
    ExistingDefinition(PropertyDefinitionId),
}

/// Command to add a column to a table.
#[derive(Debug, Clone)]
pub struct CreateColumn {
    /// Table receiving the column.
    pub table_id: TableId,
    /// Definition source.
    pub binding: ColumnBinding,
    /// Column-kind configuration (links, lookups).
    pub config: Option<ColumnConfig>,
}

// ===== The query/exec pipeline =====

/// The acting viewer: every catalog build, materialization, and write is
/// scoped to this identity. The catalog IS the authorization for SQL.
#[derive(Debug, Clone)]
pub struct Viewer {
    /// The user running the statement.
    pub user_id: MacroUserIdStr<'static>,
}

/// A request to execute SQL (any mix of reads and writes).
#[derive(Debug, Clone, Deserialize)]
pub struct ExecRequest {
    /// The statements to run, executed in one transaction.
    pub sql: String,
    /// When set, writes are rejected unless every written table is still at
    /// this version (compare-and-swap). When unset, cell-level last-write-wins.
    pub base_versions: Option<HashMap<TableId, TableVersion>>,
}

/// SQL name and typed columns of one table in the viewer's catalog.
#[derive(Debug, Clone)]
pub struct TableSchema {
    /// SQL-visible table name (e.g. `guests`, `guests__sessions`, `people`).
    pub sql_name: String,
    /// What this table is backed by.
    pub source: TableSource,
    /// Typed columns in declaration order. For user tables the first column
    /// is always `row_id`.
    pub columns: Vec<ColumnSchema>,
    /// Columns forming the primary key (compiled into the SQLite DDL).
    pub primary_key: Vec<String>,
    /// Foreign keys compiled into the SQLite DDL (junction integrity).
    pub foreign_keys: Vec<ForeignKey>,
    /// Whether SQL may write to this table at all (Edit grant on a user table
    /// or its junctions). Magic tables and View-grant tables are read-only.
    pub writable: bool,
    /// Additional read-only names this table answers to (compiled as views),
    /// e.g. the database-qualified form of a table that also has a bare name.
    pub aliases: Vec<String>,
}

/// A foreign-key constraint compiled into the scratch schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForeignKey {
    /// Column on this table.
    pub column: String,
    /// Referenced table's SQL name.
    pub references_table: String,
    /// Referenced column.
    pub references_column: String,
}

/// SQLite storage class for a materialized column (STRICT table types).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlType {
    /// INTEGER (also booleans as 0/1).
    Integer,
    /// REAL.
    Real,
    /// TEXT (ids, dates as ISO-8601, JSON arrays for multi-valued cells).
    Text,
}

impl SqlType {
    /// The storage class a property data type materializes as.
    pub fn for_data_type(data_type: DataType, is_multi_select: bool) -> Self {
        if is_multi_select {
            return SqlType::Text;
        }
        match data_type {
            DataType::Boolean => SqlType::Integer,
            DataType::Number => SqlType::Real,
            DataType::Date
            | DataType::String
            | DataType::Link
            | DataType::SelectNumber
            | DataType::SelectString
            | DataType::Tag
            | DataType::Entity => SqlType::Text,
        }
    }

    /// The type name used in `CREATE TABLE … STRICT`.
    pub fn ddl_name(self) -> &'static str {
        match self {
            SqlType::Integer => "INTEGER",
            SqlType::Real => "REAL",
            SqlType::Text => "TEXT",
        }
    }
}

/// What a catalog table is backed by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableSource {
    /// A user table ([`Table`]).
    UserTable(TableId),
    /// The junction view generated for a multi link/entity column.
    Junction {
        /// Owning user table.
        table_id: TableId,
        /// The link column the junction belongs to.
        column_id: ColumnId,
    },
    /// A magic table (platform data, read-only).
    Magic(String),
}

/// One column of a catalog table.
#[derive(Debug, Clone)]
pub struct ColumnSchema {
    /// SQL-visible column name.
    pub sql_name: String,
    /// SQLite storage class.
    pub sql_type: SqlType,
    /// The property data type behind it, when property-backed.
    pub data_type: Option<DataType>,
    /// Whether the property holds multiple values (materialized as a JSON
    /// array, with a companion junction view).
    pub is_multi_select: bool,
    /// The property definition behind a user-table column, for translating
    /// changeset values back into cells.
    pub definition_id: Option<PropertyDefinitionId>,
    /// Entity type carried by id values in this column, for chip hydration
    /// and join type-checking.
    pub entity_type: Option<EntityType>,
    /// Whether SQL writes to this column are translatable to a domain command.
    pub writable: bool,
    /// Allowed values for select/tag columns, compiled into a `CHECK`
    /// constraint so SQLite rejects unknown options.
    pub allowed_values: Option<Vec<String>>,
    /// Whether NULL is rejected (`row_id`, junction columns).
    pub not_null: bool,
}

/// The viewer's whole queryable world: used to prepare statements and as the
/// authorization boundary (an unreadable table is simply absent).
#[derive(Debug, Clone)]
pub struct Catalog {
    /// Every table the viewer can reference.
    pub tables: Vec<TableSchema>,
}

/// Tables and columns a prepared statement references, from the SQLite
/// authorizer. Doubles as the liveness dependency set.
#[derive(Debug, Clone)]
pub struct TableDeps {
    /// Referenced tables mapped to the columns actually read or written.
    pub tables: HashMap<String, ReferencedTable>,
}

/// One referenced table with access details.
#[derive(Debug, Clone)]
pub struct ReferencedTable {
    /// Columns read.
    pub read_columns: Vec<String>,
    /// Whether the statement writes to this table.
    pub written: bool,
}

/// A value in the SQLite materialization, kept engine-agnostic so the domain
/// never depends on rusqlite types. Serializes as a plain JSON scalar.
#[derive(utoipa::ToSchema, Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SqlValue {
    /// SQL NULL.
    Null,
    /// Integer (also booleans as 0/1).
    Integer(i64),
    /// Float.
    Real(f64),
    /// Text (also ids, dates as ISO-8601, resolved option display values).
    Text(String),
}

/// One table's rows, ready to load into the scratch SQLite.
#[derive(Debug, Clone)]
pub struct MaterializedTable {
    /// Schema (including compiled constraints).
    pub schema: TableSchema,
    /// Row tuples in column order. User tables carry their `row_id` as the
    /// first column so changesets can be traced back.
    pub rows: Vec<Vec<SqlValue>>,
}

/// A SELECT's result set with provenance for hydration and write-through.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct QueryResult {
    /// Result columns.
    pub columns: Vec<ResultColumn>,
    /// Row values as JSON scalars.
    pub rows: Vec<Vec<SqlValue>>,
}

/// One result column with its origin.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ResultColumn {
    /// Column name or alias.
    pub name: String,
    /// Entity type of id values, when known — drives chip rendering.
    #[schema(inline)]
    pub entity_type: Option<EntityType>,
    /// Origin `(table, column)` when the column traces to a single base
    /// column — the precondition for write-through.
    pub origin: Option<(String, String)>,
}

/// A row-level change exactly as SQLite's session changeset reports it —
/// SQL names and storage-class values, before the domain service translates
/// it into typed cells ([`RowChange`]).
#[derive(Debug, Clone, PartialEq)]
pub struct RawRowChange {
    /// SQL name of the table written.
    pub table: String,
    /// What happened.
    pub op: RawOp,
    /// Primary-key values of the affected row, by column name. For an insert
    /// these are the values SQLite assigned or defaulted.
    pub primary_key: Vec<(String, SqlValue)>,
    /// New values by column name (inserts: every column; updates: only the
    /// columns that changed).
    pub new_values: Vec<(String, SqlValue)>,
}

/// The kind of a [`RawRowChange`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawOp {
    /// Row inserted.
    Insert,
    /// Row updated.
    Update,
    /// Row deleted.
    Delete,
}

/// The row-level changes a statement made, extracted from the SQLite session
/// changeset and expressed in domain terms.
#[derive(Debug, Clone, PartialEq)]
pub enum RowChange {
    /// A row inserted into a user table.
    Insert {
        /// Table written.
        table_id: TableId,
        /// Cell values keyed by definition, already converted and validated.
        cells: HashMap<PropertyDefinitionId, SetPropertyValue>,
    },
    /// Cells updated on an existing row.
    Update {
        /// Table written.
        table_id: TableId,
        /// Row written.
        row_id: RowId,
        /// Changed cells only; `None` clears the cell (SQL `NULL`).
        cells: HashMap<PropertyDefinitionId, Option<SetPropertyValue>>,
    },
    /// A row deleted (membership removed; referenced entities untouched).
    Delete {
        /// Table written.
        table_id: TableId,
        /// Row removed.
        row_id: RowId,
    },
    /// A link edge added.
    Link {
        /// The link column.
        column_id: ColumnId,
        /// Source row.
        source_row_id: RowId,
        /// Target row.
        target_row_id: RowId,
    },
    /// A link edge removed.
    Unlink {
        /// The link column.
        column_id: ColumnId,
        /// Source row.
        source_row_id: RowId,
        /// Target row.
        target_row_id: RowId,
    },
}

/// Result of applying a translated changeset: minted row ids (in changeset
/// order) and the new version of every written table.
pub type AppliedChanges = (Vec<RowId>, HashMap<TableId, TableVersion>);

/// Outcome of an [`ExecRequest`].
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ExecOutcome {
    /// Result sets of the SELECT statements, in order.
    pub results: Vec<QueryResult>,
    /// How many row changes were applied to Postgres.
    pub changes_applied: usize,
    /// Server-minted ids for rows the statement inserted.
    #[schema(value_type = Vec<Uuid>)]
    pub inserted_row_ids: Vec<RowId>,
    /// New versions of every written table, for client-side liveness.
    #[schema(value_type = HashMap<String, TableVersion>)]
    pub new_versions: HashMap<TableId, TableVersion>,
    /// Dependency set of the statement, for liveness subscription.
    #[schema(value_type = Vec<Uuid>)]
    pub read_tables: Vec<TableId>,
    /// Magic tables whose materialization hit its row cap; aggregates over
    /// them are incomplete.
    pub truncated_tables: Vec<String>,
}

/// Result of applying a changeset under optional compare-and-swap.
#[derive(Debug, Clone, PartialEq)]
pub enum ApplyOutcome {
    /// Every change committed.
    Applied(AppliedChanges),
    /// A written table had moved past its expected version; nothing committed.
    VersionConflict {
        /// The table that changed underneath the caller.
        table_id: TableId,
    },
}

impl ApplyOutcome {
    /// The applied changes, if nothing conflicted.
    pub fn applied(self) -> Option<AppliedChanges> {
        match self {
            ApplyOutcome::Applied(applied) => Some(applied),
            ApplyOutcome::VersionConflict { .. } => None,
        }
    }
}

/// A serialized SQLite snapshot of one database (takeout / local analysis).
#[derive(Debug, Clone)]
pub struct SqliteSnapshot {
    /// The bytes of a complete SQLite database file.
    pub bytes: Vec<u8>,
    /// Versions of the contained tables at snapshot time.
    pub versions: HashMap<TableId, TableVersion>,
}

// ===== Access & rendering models =====

/// The access a viewer holds on a database, from its `entity_access` rows.
#[derive(
    utoipa::ToSchema, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum AccessGrant {
    /// Read rows and run read-only SQL.
    View,
    /// View plus comments (no additional database rights).
    Comment,
    /// Write rows/links and change the schema.
    Edit,
    /// Everything, including sharing and deletion.
    Owner,
}

impl AccessGrant {
    /// Whether SQL may write to the database's tables.
    pub fn can_write(self) -> bool {
        matches!(self, AccessGrant::Edit | AccessGrant::Owner)
    }

    /// Parse the `AccessLevel` enum text stored in `entity_access`.
    pub fn parse(level: &str) -> Option<Self> {
        match level.to_ascii_lowercase().as_str() {
            "view" => Some(AccessGrant::View),
            "comment" => Some(AccessGrant::Comment),
            "edit" => Some(AccessGrant::Edit),
            "owner" => Some(AccessGrant::Owner),
            _ => None,
        }
    }
}

/// A database as listed for a viewer.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ListedDatabase {
    /// The database.
    pub database: Database,
    /// The viewer's access.
    pub grant: AccessGrant,
}

/// Everything a client needs to render and edit one database: tables,
/// column placements with their definitions, and the SQL names the query
/// surface exposes them under.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct DatabaseDetail {
    /// The database.
    pub database: Database,
    /// The viewer's access.
    pub grant: AccessGrant,
    /// Tables in tab order.
    pub tables: Vec<TableDetail>,
}

/// One table with its columns and SQL name.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct TableDetail {
    /// The table.
    pub table: Table,
    /// Name to use in SQL (`FROM guests`).
    pub sql_name: String,
    /// Columns in display order.
    pub columns: Vec<ColumnDetail>,
}

/// One column placement with the definition behind it.
#[derive(utoipa::ToSchema, Debug, Clone, Serialize)]
pub struct ColumnDetail {
    /// The placement.
    pub column: Column,
    /// Name to use in SQL.
    pub sql_name: String,
    /// The bound definition (name, type, options).
    pub definition:
        models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions,
    /// Whether SQL may write this column.
    pub writable: bool,
}

// ===== Errors =====

/// Errors for schema and persistence operations.
#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    /// The database, table, column, or row does not exist (or is invisible
    /// to the viewer, which is deliberately indistinguishable).
    #[error("not found")]
    NotFound,
    /// The caller lacks the permission the operation requires.
    #[error("unauthorized")]
    Unauthorized,
    /// A schema operation was invalid (duplicate placement, bad binding, …).
    #[error("invalid schema operation: {0}")]
    InvalidSchemaOperation(String),
    /// Persistence failure.
    #[error("repository error: {0:?}")]
    Repo(rootcause::Report),
}

/// Errors for SQL analysis, execution, and write-back.
#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    /// SQLite rejected the statement (syntax, unknown table/column, or a
    /// compiled validity constraint). Surfaced verbatim — these errors are
    /// the product's "broken query" state.
    #[error("sql error: {0}")]
    Sql(String),
    /// The statement writes to a read-only table (magic tables, View-only
    /// grants, derived columns).
    #[error("read-only: {0}")]
    ReadOnly(String),
    /// `base_versions` was set and a written table has moved.
    #[error("version conflict on table {table_id}")]
    VersionConflict {
        /// The table that changed underneath the caller.
        table_id: TableId,
    },
    /// The statement exceeded the execution budget (time or row caps).
    #[error("query budget exceeded")]
    BudgetExceeded,
    /// A changeset row could not be translated to a domain command.
    #[error("untranslatable change: {0}")]
    UntranslatableChange(String),
    /// Materialization or apply-side persistence failure.
    #[error("query infrastructure error: {0:?}")]
    Infrastructure(rootcause::Report),
}
