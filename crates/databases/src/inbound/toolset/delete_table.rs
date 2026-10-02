//! DeleteTable tool: remove a table with its rows and columns.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::{DatabaseId, DatabaseOp, TableChange, TableId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Delete a table.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteTable",
    description = "\
Delete a table — a tab of a database — with every row and column in it. This cannot be \
undone, so only do it when the user asked for that table to go.\n\
\n\
A database keeps at least one table, so its last table cannot be deleted. A table that a \
relation column of another table points at cannot be deleted until that column is.\n\
\n\
Requires edit access. The response is the schema after the change."
)]
pub struct DeleteTable {
    /// The database containing the table.
    #[schemars(description = "Id of the database containing the table, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// The table to delete.
    #[schemars(description = "Id of the table to delete, from DescribeDatabase.")]
    pub table_id: TableId,
}

impl ToolAnnotated for DeleteTable {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete table");
}

/// Response from the DeleteTable tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTableResponse {
    /// Database the table was deleted from.
    pub database_id: DatabaseId,
    /// The deleted table's id.
    pub table_id: TableId,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed delete.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>> for DeleteTable
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = DeleteTableResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
        table_id = %self.table_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch::from(vec![DatabaseOp::Table {
                    table: self.table_id,
                    change: TableChange::Delete,
                }]),
            )
            .await?;

        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(DeleteTableResponse {
            database_id: self.database_id,
            table_id: self.table_id,
            database,
            warning,
        })
    }
}
