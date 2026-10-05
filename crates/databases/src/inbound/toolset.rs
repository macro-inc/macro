//! Agent tools over the same [`DatabasesService`] port and receipts as the
//! HTTP routes, so a tool reaches exactly what the API can.

mod delete_database_view;
mod describe_database;
mod list_databases;
mod save_database_view;

#[cfg(test)]
mod test;

use models_databases::{ColumnId, DatabaseId, OpResult, OptionId, TableId};
use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use bot_id::BotId;
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, EditAccessLevel, EntityAccessReceipt, RequiredPermission,
        ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::cast::SpelledColumnType;
use models_properties::shared::DataType;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::catalog::{cast_targets, option_labels, sql_table_name};
use crate::domain::models::{
    ColumnConfig, ColumnDetail, DatabaseDetail, DatabaseError, DatabaseView, ListedDatabase,
    OpBatch, TableDetail, Viewer,
};
use crate::domain::ports::DatabasesService;
use crate::domain::receipt::database_receipt;

pub use delete_database_view::{DeleteDatabaseView, DeletedDatabaseView};
pub use describe_database::DescribeDatabase;
pub use list_databases::{ListDatabases, ListDatabasesResponse};
pub use save_database_view::{SaveDatabaseView, SavedDatabaseView};

/// Service context for the databases AI tools.
pub struct DatabasesToolContext<Service: DatabasesService, EntityAccess: EntityAccessService> {
    /// The databases service instance.
    pub service: Arc<Service>,
    /// Mints the access receipts the schema operations are gated on.
    pub entity_access_service: Arc<EntityAccess>,
    /// The agent the tools act as, for the requesting user.
    pub actor: BotId,
}

impl<Service: DatabasesService, EntityAccess: EntityAccessService> Clone
    for DatabasesToolContext<Service, EntityAccess>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            actor: self.actor,
        }
    }
}

impl<Service: DatabasesService, EntityAccess: EntityAccessService>
    DatabasesToolContext<Service, EntityAccess>
{
    /// Create a new databases tool context.
    pub fn new(service: Service, entity_access_service: Arc<EntityAccess>) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service,
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Run the tools as `actor`, delegated for the requesting user, instead
    /// of the default Macro AI bot.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }

    /// The requesting user, as the service's query surface understands them,
    /// with this context's agent acting for them.
    pub(crate) fn viewer(&self, user_id: &MacroUserIdStr<'static>) -> Viewer {
        Viewer {
            user_id: user_id.clone(),
            acting_bot: Some(self.actor),
        }
    }

    /// Prove the caller may read `database_id`.
    pub(crate) async fn view_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<EntityAccessReceipt<ViewAccessLevel>, ToolCallError> {
        self.receipt::<ViewAccessLevel>(user_id, database_id, "read")
            .await
    }

    /// Prove the caller may change `database_id`'s schema.
    pub(crate) async fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<EntityAccessReceipt<EditAccessLevel>, ToolCallError> {
        self.receipt::<EditAccessLevel>(user_id, database_id, "edit")
            .await
    }

    /// The database as the caller sees it now, for tools that must name the
    /// current table version or label rather than asking the model for it.
    pub(crate) async fn current_schema(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<DatabaseDetail, ToolCallError> {
        let receipt = self.view_receipt(user_id, database_id).await?;
        self.service
            .get_database(receipt)
            .await
            .map_err(database_error)
    }

    /// Apply ops to one database as the requesting user: every schema and
    /// data write of the tools goes through here.
    pub(crate) async fn apply(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
        batch: OpBatch,
    ) -> Result<Vec<OpResult>, ToolCallError> {
        let receipt = self.edit_receipt(user_id, database_id).await?;
        self.service
            .apply_ops(receipt, self.viewer(user_id), batch)
            .await
            .map_err(database_error)
    }

    /// Mint a receipt, saying what actually went wrong: a wrong id, a
    /// missing grant, and a failed check each send the model somewhere else.
    async fn receipt<Permission: RequiredPermission>(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
        verb: &str,
    ) -> Result<EntityAccessReceipt<Permission>, ToolCallError> {
        database_receipt::<Permission, _>(
            self.entity_access_service.as_ref(),
            &self.viewer(user_id),
            database_id,
        )
        .await
        .map_err(|error| {
            let description = match &error {
                AccessError::NotFound(_) => format!(
                    "No database with id {database_id} exists. Call ListDatabases to see \
                     the user's databases and their ids."
                ),
                AccessError::BadRequest(message) => message.to_string(),
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
                    format!("The user does not have permission to {verb} database {database_id}.")
                }
                AccessError::Unavailable(_) => format!(
                    "Access to database {database_id} could not be checked right now. Retry \
                     the call."
                ),
                AccessError::Internal(_) => {
                    format!("Access to database {database_id} could not be checked.")
                }
            };
            ToolCallError {
                description,
                internal_error: error.into(),
            }
        })
    }
}

/// Compact schema/discovery tools; row operations are exposed by the SQL toolset.
pub fn databases_toolset<Service: DatabasesService, EntityAccess: EntityAccessService>()
-> AsyncToolCollection<DatabasesToolContext<Service, EntityAccess>> {
    databases_read_only_toolset()
        .add_tool::<SaveDatabaseView, DatabasesToolContext<Service, EntityAccess>>()
        .add_tool::<DeleteDatabaseView, DatabasesToolContext<Service, EntityAccess>>()
}

/// Discovery for live document answers. No mutation tools.
pub fn databases_read_only_toolset<Service, EntityAccess>()
-> AsyncToolCollection<DatabasesToolContext<Service, EntityAccess>>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<ListDatabases, DatabasesToolContext<Service, EntityAccess>>()
        .add_tool::<DescribeDatabase, DatabasesToolContext<Service, EntityAccess>>()
}

/// One table of a described database, or an error pointing at DescribeDatabase.
pub(crate) fn table_of(
    detail: &DatabaseDetail,
    table_id: TableId,
) -> Result<&TableDetail, ToolCallError> {
    detail
        .tables
        .iter()
        .find(|table| table.table.id == table_id)
        .ok_or_else(|| ToolCallError {
            description: format!(
                "Database {} has no table with id {table_id}. Call DescribeDatabase for its tables.",
                detail.database.id
            ),
            internal_error: anyhow::anyhow!("table not found in database"),
        })
}

/// Turn a service error into something the model can act on; a refused
/// schema operation's reason passes through verbatim so the model can retry.
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
        DatabaseError::InvalidSchemaOperation(reason) => reason.to_string(),
        DatabaseError::InvalidSharing(reason) => reason.to_string(),
        DatabaseError::VersionConflict => {
            "The table changed since it was described. Call DescribeDatabase for its current \
             schema and version, then retry."
                .to_string()
        }
        DatabaseError::InvalidOp(_) | DatabaseError::OptionInUse | DatabaseError::RowInUse => {
            error.to_string()
        }
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

/// What the user may do with a database, as the model sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolGrant {
    /// Read rows.
    View,
    /// View, plus commenting. Still read-only.
    Comment,
    /// Write rows and change the schema.
    Edit,
    /// Everything, including sharing and deletion.
    Owner,
}

impl From<AccessLevel> for ToolGrant {
    fn from(level: AccessLevel) -> Self {
        match level {
            AccessLevel::View => ToolGrant::View,
            AccessLevel::Comment => ToolGrant::Comment,
            AccessLevel::Edit => ToolGrant::Edit,
            AccessLevel::Owner => ToolGrant::Owner,
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
    /// A number.
    Number,
    /// True/false.
    Boolean,
    /// An ISO-8601 date-time.
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
    /// The database's id. Pass this to DescribeDatabase or QueryDatabase.
    pub id: DatabaseId,
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
    pub id: TableId,
    /// Display name shown on the table tab.
    pub name: String,
    /// The name to use in SQL, quoted.
    pub sql_name: String,
}

impl From<ListedDatabase> for ToolDatabase {
    fn from(listed: ListedDatabase) -> Self {
        Self {
            id: listed.database.id,
            name: listed.database.name.clone(),
            grant: listed.grant.into(),
            tables: listed
                .tables
                .into_iter()
                .map(|table| ToolTableSummary {
                    id: table.id,
                    sql_name: sql_table_name(&listed.database.name, &table.name),
                    name: table.name,
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
    pub id: ColumnId,
    /// The name to use in SQL.
    pub sql_name: String,
    /// The name the user sees.
    pub name: String,
    /// The value type.
    pub data_type: ColumnType,
    /// Required entity kind for an entity column, such as `USER` or `DOCUMENT`.
    /// Never invent an id.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub specific_entity_type: Option<models_properties::shared::EntityType>,
    /// Whether the column holds several values. Multi-valued cells are written
    /// as lists (`['a', 'b']`) and tested with `HAS`.
    pub is_multi_select: bool,
    /// For a select or tag column, its options: the labels SQL accepts
    /// (writing anything else is rejected by the statement), and the ids a
    /// view names them by.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ToolOption>,
    /// Whether SQL may write to this column.
    pub writable: bool,
    /// A database-row relationship; distinct from a Macro entity reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relation: Option<ToolRelation>,
    /// Types ALTER COLUMN TYPE converts every value to, spelled as SQL types
    /// (`select[]` is a multi-valued select, `entity(USER)` a person).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub safe_types: Vec<SpelledColumnType>,
    /// Types whose conversion checks each value first and refuses if any does
    /// not fit. Any type in neither list is refused while the column holds
    /// values.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checked_types: Vec<SpelledColumnType>,
}

/// One option of a select or tag column.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolOption {
    /// The id views name it by.
    pub id: OptionId,
    /// The label SQL reads and writes.
    pub label: String,
}

/// The target of a database-row relationship.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRelation {
    /// Database containing the target rows.
    pub database_id: DatabaseId,
    /// Table whose row ids this relation stores.
    pub table_id: TableId,
}

/// One table of a database, as the model sees it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolTable {
    /// The table's id, used by saved views and version guards.
    pub id: TableId,
    /// The name to use in SQL, quoted (`FROM "Guests"`).
    pub sql_name: String,
    /// Version at which this schema was described. A new SELECT supplies the
    /// read version for conditional row edits.
    pub version: i64,
    /// The name the user sees.
    pub name: String,
    /// Whether SQL may write to this table at all.
    pub writable: bool,
    /// Columns in display order. `row_id` is implicit and is not listed.
    pub columns: Vec<ToolColumn>,
    /// The table's saved views, in their order. SaveDatabaseView under one
    /// of these names replaces that view.
    // Opaque: the filter tree is recursive, which the web's tool-type generator cannot follow.
    #[schemars(with = "Vec<serde_json::Value>")]
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<DatabaseView>,
}

/// Everything a model needs to write SQL against one database.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolDatabaseSchema {
    /// The database's id.
    pub id: DatabaseId,
    /// Display name.
    pub name: String,
    /// What the user may do with it.
    pub grant: ToolGrant,
    /// Tables in tab order.
    pub tables: Vec<ToolTable>,
}

impl From<DatabaseDetail> for ToolDatabaseSchema {
    fn from(detail: DatabaseDetail) -> Self {
        let writable = detail.writable();
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
                    version: table.table.version.0,
                    name: table.table.name,
                    writable,
                    columns: table.columns.into_iter().map(ToolColumn::from).collect(),
                    views: table.views,
                })
                .collect(),
        }
    }
}

impl From<ColumnDetail> for ToolColumn {
    fn from(column: ColumnDetail) -> Self {
        let (safe_types, checked_types) = cast_targets(&column.column, &column.definition);
        Self {
            safe_types: safe_types.into_iter().map(SpelledColumnType).collect(),
            checked_types: checked_types.into_iter().map(SpelledColumnType).collect(),
            id: column.column.id,
            name: column.name().to_string(),
            data_type: column.definition.definition.data_type.into(),
            specific_entity_type: column.entity_type(),
            is_multi_select: column.is_multi_valued(),
            writable: column.writable,
            // The catalog's labels, not the raw option text: duplicates are
            // disambiguated there, and a label that does not round-trip is
            // one SQL rejects.
            options: option_labels(&column.definition)
                .into_iter()
                .map(|(id, label)| ToolOption { id, label })
                .collect(),
            relation: match column.column.config {
                Some(ColumnConfig::Link {
                    database_id,
                    table_id,
                }) => Some(ToolRelation {
                    database_id,
                    table_id,
                }),
                _ => None,
            },
            sql_name: column.sql_name,
        }
    }
}
