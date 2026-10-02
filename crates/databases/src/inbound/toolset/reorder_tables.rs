//! ReorderTables tool: set the order a database's tabs appear in.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::{DatabaseId, DatabaseOp, TableId};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Reorder a database's tables.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReorderTables",
    description = "\
Set the order a database's tables — what the user sees as tabs — appear in, left to right. \
Records, columns and names are untouched.\n\
\n\
Use it when the user asks to move a tab, put tables in a particular order, or when tables you \
created should read in a sensible sequence (e.g. \"Projects\" before \"Tasks\"). Pass every \
table id of the database exactly once, in the new order; call DescribeDatabase first for the \
current ids, since a list that misses or adds a table is refused.\n\
\n\
Requires edit access to the database. The response is the schema after the change. If \
`database` is null, the reorder still succeeded; call DescribeDatabase using databaseId \
before continuing."
)]
pub struct ReorderTables {
    /// The database whose tables to reorder.
    #[schemars(description = "Id of the database, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// Every table id, in the new order.
    #[schemars(
        description = "Every table id of the database, exactly once, in the new left-to-right \
                       order, from DescribeDatabase."
    )]
    pub table_ids: Vec<TableId>,
}

impl ToolAnnotated for ReorderTables {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Reorder tables").with_idempotent();
}

/// Response from the ReorderTables tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReorderTablesResponse {
    /// Database whose tables were reordered.
    pub database_id: DatabaseId,
    /// The table ids in their new order.
    pub table_ids: Vec<TableId>,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed order.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>> for ReorderTables
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = ReorderTablesResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
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
                OpBatch::from(vec![DatabaseOp::ReorderTables {
                    order: self.table_ids.clone(),
                }]),
            )
            .await?;

        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(ReorderTablesResponse {
            database_id: self.database_id,
            table_ids: self.table_ids.clone(),
            database,
            warning,
        })
    }
}
