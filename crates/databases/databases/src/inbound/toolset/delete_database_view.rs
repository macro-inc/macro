//! DeleteDatabaseView: remove a saved view of a table through the view ops.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::views::ViewId;
use models_databases::{DatabaseId, DatabaseOp, TableId, ViewChange};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DatabasesToolContext;
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Delete a saved view.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteDatabaseView",
    description = "\
Delete a saved table or board view of a Macro database by its id, from DescribeDatabase. \
Views are shared with everyone who can open the database, so deleting one needs edit access \
and removes it for everyone. The table and its records stay; a board's hand-arranged card \
order goes with it. Only do it when the user asked for that view to go."
)]
pub struct DeleteDatabaseView {
    /// Database id from ListDatabases.
    pub database_id: DatabaseId,
    /// View id from DescribeDatabase.
    pub view_id: ViewId,
}

impl ToolAnnotated for DeleteDatabaseView {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Delete database view");
}

/// The view deleted.
#[derive(Debug, Serialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeletedDatabaseView {
    /// The database it belonged to.
    pub database_id: DatabaseId,
    /// The table it showed.
    pub table_id: TableId,
    /// The deleted view's id.
    pub view_id: ViewId,
    /// The name it went by.
    pub name: String,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for DeleteDatabaseView
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = DeletedDatabaseView;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id, database_id = %self.database_id, view_id = %self.view_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        let schema = service_context
            .current_schema(user_id, self.database_id)
            .await?;
        let view = schema
            .tables
            .iter()
            .flat_map(|table| &table.views)
            .find(|view| view.id == self.view_id)
            .ok_or_else(|| ToolCallError {
                description: format!(
                    "Database {} has no view with id {}. Call DescribeDatabase for its tables' \
                     views.",
                    self.database_id, self.view_id
                ),
                internal_error: anyhow::anyhow!("view not found in database"),
            })?;
        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch::from(vec![DatabaseOp::View {
                    table: view.table_id,
                    view: view.id,
                    change: ViewChange::Delete,
                }]),
            )
            .await?;
        Ok(DeletedDatabaseView {
            database_id: self.database_id,
            table_id: view.table_id,
            view_id: view.id,
            name: view.name.clone(),
        })
    }
}
