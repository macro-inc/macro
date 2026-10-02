//! DeleteColumn tool: remove a column and its values.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use std::collections::HashMap;

use models_databases::{ColumnChange, ColumnId, DatabaseId, DatabaseOp, TableId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings, column_of, table_of,
};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Delete a column.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteColumn",
    description = "\
Delete a column and every value in it. This cannot be undone, so only do it when the user \
asked for that column to go. Deleting a relation column also removes the relationships it \
held.\n\
\n\
Requires edit access. The response is the schema after the change."
)]
pub struct DeleteColumn {
    /// The database containing the column.
    #[schemars(description = "Id of the database containing the column, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// The table containing the column.
    #[schemars(description = "Id of the table containing the column, from DescribeDatabase.")]
    pub table_id: TableId,
    /// The column to delete.
    #[schemars(description = "Id of the column to delete, from DescribeDatabase.")]
    pub column_id: ColumnId,
}

impl ToolAnnotated for DeleteColumn {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete column");
}

/// Response from the DeleteColumn tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteColumnResponse {
    /// Database the column was deleted from.
    pub database_id: DatabaseId,
    /// Table the column was deleted from.
    pub table_id: TableId,
    /// The deleted column's id.
    pub column_id: ColumnId,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed delete.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>> for DeleteColumn
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = DeleteColumnResponse;

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
        let detail = service_context
            .current_schema(user_id, self.database_id)
            .await?;
        let table = table_of(&detail, self.table_id)?;
        column_of(table, self.column_id)?;
        let base_version = table.table.version;

        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch {
                    ops: vec![DatabaseOp::Column {
                        table: self.table_id,
                        column: self.column_id,
                        change: ColumnChange::Delete,
                    }],
                    base_versions: HashMap::from([(self.table_id, base_version)]),
                },
            )
            .await?;

        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(DeleteColumnResponse {
            database_id: self.database_id,
            table_id: self.table_id,
            column_id: self.column_id,
            database,
            warning,
        })
    }
}
