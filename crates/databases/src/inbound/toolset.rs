//! Toolset inbound adapter for Macro Databases.
//!
//! A driving adapter like [`axum_router`](super::axum_router), but for the
//! agent loop. It goes through the same [`DatabasesService`] port and the same
//! access receipts, so a tool can reach exactly what the HTTP API can and
//! nothing more — in particular, SQL is authorized by the catalog the service
//! builds for the acting user, not by anything decided here.
//!
//! The tools are deliberately thin: mint a receipt, convert the request, call
//! the service, render the answer. No policy, no SQL, no persistence.

mod add_column;
mod add_column_options;
mod create_database;
mod create_table;
mod describe_database;
mod list_databases;
mod query_database;
mod save_database_view;

#[cfg(test)]
mod test;

/// The SQL dialect note, shared verbatim by every tool that writes or reads
/// SQL and returned as a field by `DescribeDatabase`.
///
/// A macro rather than a `const` because `#[schemars(description = ...)]` is
/// built at compile time from literals, and `concat!` only concatenates
/// literals. One definition is the point: a dialect explained three ways is how
/// the three drift apart.
macro_rules! sql_guide {
    () => {
        "SQLite dialect, with Macro's own rules on top:\n\
         \n\
         - **`row_id` is the primary key** of every user table. It is minted by the server; \
         never insert one yourself.\n\
         - **Multi-valued columns are JSON arrays**, and each one also has a companion \
         junction table `table__column(row_id, linked_id)` for flat joins.\n\
         - **Relation columns point to database rows, not Macro entities.** Their `relation` \
         metadata identifies the target database/table and exact junction names. Join source.row_id \
         to junction.row_id and junction.linked_id to target.row_id; never compare display names \
         or a JSON array to a target name. Use readJunctionSqlName for saved reads, or json_each \
         of the relation column if no stable junction alias is available. Insert/delete edges \
         through junctionSqlName only when relation.writable; the projected column is read-only.\n\
         - **`col HAS 'x'`** tests membership in a multi-valued column. It is the one piece of \
         sugar; everything else is plain SQLite.\n\
         - **Select columns take their option labels as text** (`status = 'Going'`), never \
         option ids. The options are explicit schema: only the labels the column carries are \
         accepted, and new ones are added with AddColumnOptions.\n\
         - **Entity columns hold actual Macro ids.** Resolve people through `people.id` \
         (often `macro|email`) and documents through `documents.id`; never invent ids or \
         replace them with names. Respect each column's `specificEntityType`.\n\
         - **Writes are plain `INSERT` / `UPDATE` / `DELETE`** against the user table and are \
         validated against the column schema; an unknown select option or a wrong type is \
         rejected by the statement, not silently coerced.\n\
         - **Use the exact identifiers returned by DescribeDatabase.** Quote SQL table and \
         column identifiers with double quotes (escape an embedded quote by doubling it). \
         A name containing a dot is one quoted identifier, not a schema qualifier. Display \
         labels can differ from SQL names after a rename.\n\
         - **Write to `sqlName`; read through `readSqlName`.** The stable read-only alias \
         survives table renames and name collisions and is the right identifier for saved \
         queries/charts. INSERT/UPDATE/DELETE must use the table's current `sqlName`.\n\
         - **Schema uses tools, not SQL DDL.** CreateDatabase, CreateTable, AddColumn, \
         AddColumnOptions, and SaveDatabaseView change structure/presentation. CREATE TABLE, \
         ALTER TABLE, and CREATE VIEW are not supported in QueryDatabase.\n\
         - Tables you only hold view access on are read-only, and magic tables always are."
    };
}

pub(crate) use sql_guide;

/// The magic tables every caller can join against, described for the model.
macro_rules! magic_tables_note {
    () => {
        "Magic tables expose Macro's own data to SQL, scoped to what the user can see:\n\
         \n\
         - `documents(id, title, owner_id, created_at, updated_at)`\n\
         - `people(id, name, email)`\n\
         \n\
         They are read-only, and they are always in scope — join a user table's entity column \
         against `people.id` or `documents.id` to resolve ids to names."
    };
}

pub(crate) use magic_tables_note;

use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use entity_access::domain::{
    models::{AccessError, EditAccessLevel, EntityAccessReceipt, ViewAccessLevel},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_properties::shared::DataType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::catalog::{option_labels, read_table_name};
use crate::domain::models::{
    AccessGrant, ColumnConfig, DatabaseDetail, DatabaseError, ListedDatabase, QueryError, Viewer,
};
use crate::domain::ports::DatabasesService;
use crate::domain::views::{DatabaseViewService, DatabaseViewsServiceImpl};

pub use add_column::{AddColumn, AddColumnResponse};
pub use add_column_options::{AddColumnOptions, AddColumnOptionsResponse};
pub use create_database::{CreateDatabase, CreateDatabaseResponse};
pub use create_table::{CreateTable, CreateTableResponse};
pub use describe_database::DescribeDatabase;
pub use list_databases::{ListDatabases, ListDatabasesResponse};
pub use query_database::{QueryDatabase, QueryDatabaseResponse, ReadOnlyQueryDatabase};
pub use save_database_view::SaveDatabaseView;

/// Service context for the databases AI tools.
pub struct DatabasesToolContext<S: DatabasesService, E: EntityAccessService> {
    /// The databases service instance.
    pub service: Arc<S>,
    /// Mints the access receipts the schema operations are gated on.
    pub entity_access_service: Arc<E>,
    /// Personal saved-view use case, backed by the owning saved_views port.
    pub views: Arc<dyn DatabaseViewService>,
}

impl<S: DatabasesService, E: EntityAccessService> Clone for DatabasesToolContext<S, E> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            views: self.views.clone(),
        }
    }
}

impl<S: DatabasesService, E: EntityAccessService> DatabasesToolContext<S, E> {
    /// Create a new databases tool context.
    pub fn new<V>(service: S, entity_access_service: Arc<E>, views: V) -> Self
    where
        V: saved_views::ViewStorage + Send + Sync + 'static,
        V::Err: std::error::Error + Send + Sync + 'static,
    {
        let service = Arc::new(service);
        Self {
            views: Arc::new(DatabaseViewsServiceImpl::new(service.clone(), views)),
            service,
            entity_access_service,
        }
    }

    /// Prove the caller may read `database_id`.
    pub(crate) async fn view_receipt(
        &self,
        user_id: &MacroUserIdStr<'_>,
        database_id: Uuid,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, ToolCallError> {
        self.receipt::<ViewAccessLevel>(user_id, database_id, "read")
            .await
    }

    /// Prove the caller may change `database_id`'s schema.
    pub(crate) async fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'_>,
        database_id: Uuid,
    ) -> Result<EntityAccessReceipt<EditAccessLevel>, ToolCallError> {
        self.receipt::<EditAccessLevel>(user_id, database_id, "edit")
            .await
    }

    /// Schema enrichment follows an already committed mutation. Its failure
    /// must not make an acknowledged create appear safe to repeat.
    pub(crate) async fn schema_after_write(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: Uuid,
    ) -> (Option<ToolDatabaseSchema>, Option<String>) {
        let refreshed = async {
            let receipt = self.view_receipt(user_id, database_id).await?;
            self.service
                .get_database(receipt, viewer_of(user_id))
                .await
                .map(ToolDatabaseSchema::from)
                .map_err(database_error)
        }
        .await;
        match refreshed {
            Ok(schema) => (Some(schema), None),
            Err(error) => (
                None,
                Some(format!(
                    "The change was saved, but its schema could not be refreshed: {} Call DescribeDatabase with databaseId {database_id} before continuing; do not repeat this successful mutation.",
                    error.description
                )),
            ),
        }
    }

    /// Mint a receipt, saying what actually went wrong.
    ///
    /// Collapsing "no such database" into "no access" sends a model with a
    /// wrong id looking in the wrong place, so the two stay distinct.
    async fn receipt<T: entity_access::domain::models::RequiredPermission>(
        &self,
        user_id: &MacroUserIdStr<'_>,
        database_id: Uuid,
        verb: &str,
    ) -> Result<EntityAccessReceipt<T>, ToolCallError> {
        self.entity_access_service
            .generate_entity_access_receipt::<T>(
                user_id,
                None,
                &database_id.to_string(),
                EntityType::Database,
            )
            .await
            .map_err(|e| {
                let description = match &e {
                    AccessError::NotFound(_) => format!(
                        "No database with id {database_id} exists. Call ListDatabases to see \
                         the user's databases and their ids."
                    ),
                    AccessError::BadRequest(message) => message.to_string(),
                    _ => format!(
                        "The user does not have permission to {verb} database {database_id}."
                    ),
                };
                ToolCallError {
                    description,
                    internal_error: e.into(),
                }
            })
    }
}

/// Create the databases toolset.
pub fn databases_toolset<S, E>() -> AsyncToolCollection<DatabasesToolContext<S, E>>
where
    S: DatabasesService,
    E: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListDatabases, DatabasesToolContext<S, E>>()
        .add_tool::<DescribeDatabase, DatabasesToolContext<S, E>>()
        .add_tool::<QueryDatabase, DatabasesToolContext<S, E>>()
        .add_tool::<CreateDatabase, DatabasesToolContext<S, E>>()
        .add_tool::<CreateTable, DatabasesToolContext<S, E>>()
        .add_tool::<AddColumn, DatabasesToolContext<S, E>>()
        .add_tool::<AddColumnOptions, DatabasesToolContext<S, E>>()
        .add_tool::<SaveDatabaseView, DatabasesToolContext<S, E>>()
}

/// Discovery and read-only SQL for live document answers. No mutation tools.
pub fn databases_read_only_toolset<S, E>() -> AsyncToolCollection<DatabasesToolContext<S, E>>
where
    S: DatabasesService,
    E: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListDatabases, DatabasesToolContext<S, E>>()
        .add_tool::<DescribeDatabase, DatabasesToolContext<S, E>>()
        .add_tool::<ReadOnlyQueryDatabase, DatabasesToolContext<S, E>>()
}

/// The acting user, as the service's query surface understands them.
pub(crate) fn viewer_of(user_id: &MacroUserIdStr<'static>) -> Viewer {
    Viewer {
        user_id: user_id.clone(),
    }
}

/// Turn a schema/persistence error into something the model can act on.
///
/// `InvalidSchemaOperation` is passed through verbatim — it is the service
/// explaining what was wrong with the request, which is exactly what lets a
/// model correct itself and retry.
pub(crate) fn database_error(error: DatabaseError) -> ToolCallError {
    let description = match &error {
        DatabaseError::NotFound => {
            "That database, table, or column does not exist. Call ListDatabases for the current \
             list, then DescribeDatabase for its tables and columns."
                .to_string()
        }
        DatabaseError::Unauthorized => {
            "The user does not have permission to do that to this database.".to_string()
        }
        DatabaseError::InvalidSchemaOperation(message) => message.clone(),
        DatabaseError::VersionConflict => error.to_string(),
        DatabaseError::Repo(_) => "The databases service failed.".to_string(),
    };

    // The error is handed over whole rather than rendered to a string: a
    // `Repo` failure carries a rootcause report, and flattening it here throws
    // away the chain the logs are for.
    let internal_error = match error {
        DatabaseError::Repo(report) => report.into(),
        other => anyhow::Error::new(other),
    };

    ToolCallError {
        description,
        internal_error,
    }
}

/// Turn a SQL error into something the model can act on.
///
/// SQLite's message is passed through verbatim and is the whole point: "no
/// such column: guests.statuz" tells a model exactly what to fix, where a
/// generic "query failed" tells it nothing.
pub(crate) fn query_error(error: QueryError) -> ToolCallError {
    let description = match &error {
        QueryError::Sql(message) => format!(
            "SQL error: {message}\n\nCall ListDatabases to find the table inside its database, \
             then DescribeDatabase for exact sqlName/readSqlName and column sqlName identifiers. \
             Quote identifiers and retry the corrected SQL. A guessed name failing does not \
             establish that the user's table is missing."
        ),
        QueryError::ReadOnly(message) => format!(
            "{message}. A magic table or readSqlName alias is always read-only. To edit a \
             user table, use its current sqlName from DescribeDatabase; the user must also \
             have edit access to that database."
        ),
        QueryError::VersionConflict { table_id } => {
            format!("Table {table_id} changed underneath this statement. Re-read it and retry.")
        }
        QueryError::BudgetExceeded => {
            "The statement exceeded the query budget. Narrow it with a WHERE clause or a LIMIT."
                .to_string()
        }
        QueryError::TruncatedDependency(tables) => format!(
            "This write reads {tables}, which is too large to load in full, so the statement \
             did not see all of it. Narrow the write to specific rows, or split it up."
        ),
        QueryError::UntranslatableChange(message) => format!(
            "That write could not be applied: {message}. Write to the user table's own columns \
             with plain INSERT/UPDATE/DELETE."
        ),
        QueryError::Infrastructure(_) => "The databases service failed.".to_string(),
    };

    // As in [`database_error`]: keep the report, not a rendering of it.
    let internal_error = match error {
        QueryError::Infrastructure(report) => report.into(),
        other => anyhow::Error::new(other),
    };

    ToolCallError {
        description,
        internal_error,
    }
}

/// What the user may do with a database, as the model sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolGrant {
    /// Read rows and run read-only SQL.
    View,
    /// View, plus commenting. Still read-only for SQL.
    Comment,
    /// Write rows and change the schema.
    Edit,
    /// Everything, including sharing and deletion.
    Owner,
}

impl From<AccessGrant> for ToolGrant {
    fn from(grant: AccessGrant) -> Self {
        match grant {
            AccessGrant::View => ToolGrant::View,
            AccessGrant::Comment => ToolGrant::Comment,
            AccessGrant::Edit => ToolGrant::Edit,
            AccessGrant::Owner => ToolGrant::Owner,
        }
    }
}

/// The value type of a column, as the model names it.
///
/// A deliberate mirror of [`DataType`] rather than a re-export: the property
/// system's names are internal, and the tool vocabulary has to stay stable
/// independently of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ColumnType {
    /// Free text.
    Text,
    /// A number, stored as SQLite REAL.
    Number,
    /// True/false, stored as 0/1.
    Boolean,
    /// An ISO-8601 date-time, stored as TEXT.
    Date,
    /// A URL.
    Link,
    /// One of a fixed set of text labels. SQL reads and writes the label.
    Select,
    /// One of a fixed set of numeric options.
    SelectNumber,
    /// A user- or team-scoped colored label. Always multi-valued.
    Tag,
    /// A reference to a Macro entity, stored as a typed id.
    Entity,
}

impl From<ColumnType> for DataType {
    fn from(value: ColumnType) -> Self {
        match value {
            ColumnType::Text => DataType::String,
            ColumnType::Number => DataType::Number,
            ColumnType::Boolean => DataType::Boolean,
            ColumnType::Date => DataType::Date,
            ColumnType::Link => DataType::Link,
            ColumnType::Select => DataType::SelectString,
            ColumnType::SelectNumber => DataType::SelectNumber,
            ColumnType::Tag => DataType::Tag,
            ColumnType::Entity => DataType::Entity,
        }
    }
}

impl From<DataType> for ColumnType {
    fn from(value: DataType) -> Self {
        match value {
            DataType::String => ColumnType::Text,
            DataType::Number => ColumnType::Number,
            DataType::Boolean => ColumnType::Boolean,
            DataType::Date => ColumnType::Date,
            DataType::Link => ColumnType::Link,
            DataType::SelectString => ColumnType::Select,
            DataType::SelectNumber => ColumnType::SelectNumber,
            DataType::Tag => ColumnType::Tag,
            DataType::Entity => ColumnType::Entity,
        }
    }
}

/// A database as the list tool shows it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolDatabase {
    /// The database's id. Pass this to DescribeDatabase, CreateTable, or
    /// AddColumn.
    pub id: Uuid,
    /// Display name, as the user knows it.
    pub name: String,
    /// What the user may do with it.
    pub grant: ToolGrant,
    /// Tables inside this database. Match a requested table against these
    /// names, even when the database has a different name.
    pub tables: Vec<ToolTableSummary>,
}

/// A discoverable table without loading its columns or records.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTableSummary {
    /// Table id, used with the containing database id for schema operations.
    pub id: Uuid,
    /// Display name shown on the table tab.
    pub name: String,
    /// Stable read-only SQL identifier. DescribeDatabase returns the writable name.
    pub read_sql_name: String,
}

impl From<ListedDatabase> for ToolDatabase {
    fn from(listed: ListedDatabase) -> Self {
        Self {
            id: listed.database.id,
            name: listed.database.name,
            grant: listed.grant.into(),
            tables: listed
                .tables
                .into_iter()
                .map(|table| ToolTableSummary {
                    id: table.id,
                    name: table.name,
                    read_sql_name: read_table_name(table.id),
                })
                .collect(),
        }
    }
}

/// One column of a table, as the model sees it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolColumn {
    /// The column placement's id.
    pub id: Uuid,
    /// The name to use in SQL.
    pub sql_name: String,
    /// The name the user sees.
    pub name: String,
    /// The value type.
    pub data_type: ColumnType,
    /// Required entity kind for an entity column, such as `USER` or `DOCUMENT`.
    /// Resolve ids from the matching magic table; never invent an id.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub specific_entity_type: Option<models_properties::shared::EntityType>,
    /// Whether the column holds several values. Multi-valued columns are JSON
    /// arrays in SQL, with a companion `table__column` junction table.
    pub is_multi_select: bool,
    /// For a select or tag column, the labels SQL accepts. Writing anything
    /// else is rejected by the statement.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// Whether SQL may write to this column.
    pub writable: bool,
    /// A database-row relationship; distinct from a Macro entity reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation: Option<ToolRelation>,
}

/// The target and exact SQL entry points for a database-row relationship.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRelation {
    /// Database containing the target rows.
    pub database_id: Uuid,
    /// Table whose row_id values are stored by this relation.
    pub table_id: Uuid,
    /// Exact current junction name for authorized link edits.
    pub junction_sql_name: Option<String>,
    /// Stable junction alias for saved reads, if available.
    pub read_junction_sql_name: Option<String>,
    /// Whether this viewer may insert/delete relationship edges.
    pub writable: bool,
}

/// One table of a database, as the model sees it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTable {
    /// The table's id. Pass this to AddColumn.
    pub id: Uuid,
    /// The name to use in SQL (`FROM guests`).
    pub sql_name: String,
    /// Immutable read-only SQL name; use this for stored queries and charts.
    pub read_sql_name: String,
    /// Version at which this schema was described. A new SELECT supplies the
    /// read version for conditional row edits.
    pub version: i64,
    /// The name the user sees.
    pub name: String,
    /// Whether SQL may write to this table at all.
    pub writable: bool,
    /// Columns in display order. `row_id` is implicit and is not listed.
    pub columns: Vec<ToolColumn>,
}

/// Everything a model needs to write SQL against one database.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolDatabaseSchema {
    /// The database's id.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// What the user may do with it.
    pub grant: ToolGrant,
    /// Tables in tab order.
    pub tables: Vec<ToolTable>,
    /// The platform tables this SQL can also join against.
    pub magic_tables: String,
    /// How the SQL dialect differs from plain SQLite.
    pub sql_guide: String,
}

impl From<DatabaseDetail> for ToolDatabaseSchema {
    fn from(detail: DatabaseDetail) -> Self {
        let writable = detail.grant.can_write();
        Self {
            id: detail.database.id,
            name: detail.database.name,
            grant: detail.grant.into(),
            tables: detail
                .tables
                .into_iter()
                .map(|table| ToolTable {
                    id: table.table.id,
                    sql_name: table.sql_name,
                    read_sql_name: table.read_sql_name,
                    version: table.table.version.0,
                    name: table.table.name,
                    writable,
                    columns: table
                        .columns
                        .into_iter()
                        .map(|column| ToolColumn {
                            id: column.column.id,
                            sql_name: column.sql_name,
                            // The catalog's labels, not the raw option text:
                            // duplicates are disambiguated there, and a label
                            // that does not round-trip is one SQL rejects.
                            options: option_labels(&column.definition)
                                .into_iter()
                                .map(|(_, label)| label)
                                .collect(),
                            name: column
                                .column
                                .display_name
                                .unwrap_or(column.definition.definition.display_name),
                            data_type: column.definition.definition.data_type.into(),
                            specific_entity_type: if matches!(
                                column.column.config,
                                Some(ColumnConfig::Link { .. })
                            ) {
                                None
                            } else {
                                column.definition.definition.specific_entity_type
                            },
                            is_multi_select: column.definition.definition.is_multi_select
                                || matches!(column.column.config, Some(ColumnConfig::Link { .. })),
                            writable: column.writable,
                            relation: match column.column.config {
                                Some(ColumnConfig::Link {
                                    database_id,
                                    table_id,
                                }) => Some(ToolRelation {
                                    database_id,
                                    table_id,
                                    junction_sql_name: column.junction_sql_name,
                                    read_junction_sql_name: column.read_junction_sql_name,
                                    writable: column.junction_writable,
                                }),
                                _ => None,
                            },
                        })
                        .collect(),
                })
                .collect(),
            magic_tables: magic_tables_note!().to_string(),
            sql_guide: sql_guide!().to_string(),
        }
    }
}
