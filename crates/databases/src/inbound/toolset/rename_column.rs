//! RenameColumn tool: relabel a column, keeping its values and id.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::{ColumnChange, ColumnId, DatabaseId, DatabaseOp, TableId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings, column_of, table_of,
};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Rename a column.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RenameColumn",
    description = "\
Rename a column, keeping its id, type, and values. SQL refers to the column by its new name \
afterwards, so use the refreshed schema in the response for later statements.\n\
\n\
Requires edit access to the database. If `database` is null, the rename still succeeded; \
call DescribeDatabase using databaseId before continuing."
)]
pub struct RenameColumn {
    /// The database containing the column.
    #[schemars(description = "Id of the database containing the column, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// The table containing the column.
    #[schemars(description = "Id of the table containing the column, from DescribeDatabase.")]
    pub table_id: TableId,
    /// The column to rename.
    #[schemars(description = "Id of the column to rename, from DescribeDatabase.")]
    pub column_id: ColumnId,
    /// New display name.
    #[schemars(description = "New display name of the column, e.g. \"Dietary Needs\".")]
    pub name: String,
}

impl ToolAnnotated for RenameColumn {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Rename column").with_idempotent();
}

/// Response from the RenameColumn tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameColumnResponse {
    /// Database containing the column.
    pub database_id: DatabaseId,
    /// Table containing the column.
    pub table_id: TableId,
    /// The renamed column's id, unchanged by the rename.
    pub column_id: ColumnId,
    /// The column's display name after the rename.
    pub name: String,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed rename.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>> for RenameColumn
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = RenameColumnResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
        table_id = %self.table_id,
        column_id = %self.column_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        // The service renames only if the label it replaces is still current.
        let detail = service_context
            .current_schema(user_id, self.database_id)
            .await?;
        let previous_name = column_of(table_of(&detail, self.table_id)?, self.column_id)?
            .name()
            .to_string();

        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch::from(vec![DatabaseOp::Column {
                    table: self.table_id,
                    column: self.column_id,
                    change: ColumnChange::Rename {
                        name: self.name.clone(),
                        previous_name: Some(previous_name),
                    },
                }]),
            )
            .await?;

        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(RenameColumnResponse {
            database_id: self.database_id,
            table_id: self.table_id,
            column_id: self.column_id,
            name: self.name.trim().to_owned(),
            database,
            warning,
        })
    }
}
