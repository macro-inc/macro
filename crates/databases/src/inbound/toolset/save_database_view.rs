//! SaveDatabaseView: persist a personal table/board view through the domain use case.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use super::{DatabasesToolContext, database_error, viewer_of};
use crate::domain::ports::DatabasesService;
use crate::domain::views::{DatabaseViewDefinition, SaveDatabaseViewCommand, SavedDatabaseView};

/// Save a named personal view of an existing table.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "SaveDatabaseView",
    description = "Save a personal table or kanban board view in Macro. DescribeDatabase first and use stable column ids for filters, sorts, grouping, visibility, and order. A board requires groupBy pointing to a single-valued select or checkbox column. Filters are ANDed. This changes presentation only, never source records. A same-named view on this table is updated, so inspect the returned created flag. Requires view access to the source database. The result contains the saved viewId and exact persisted configuration. Supports table and board only: it cannot save charts or SQL views."
)]
pub struct SaveDatabaseView {
    /// Database id from ListDatabases.
    pub database_id: Uuid,
    /// Table id from DescribeDatabase.
    pub table_id: Uuid,
    /// Name shown in the table's saved-view menu.
    pub name: String,
    /// Layout and filters/sorts/grouping using column ids, not display names.
    pub view: DatabaseViewDefinition,
}

impl ToolAnnotated for SaveDatabaseView {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Save database view");
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for SaveDatabaseView
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = SavedDatabaseView;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id, database_id = %self.database_id, table_id = %self.table_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = service_context
            .view_receipt(&request_context.user_id, self.database_id)
            .await?;
        service_context
            .views
            .save_view(
                receipt,
                viewer_of(&request_context.user_id),
                SaveDatabaseViewCommand {
                    table_id: self.table_id,
                    name: self.name.clone(),
                    view: self.view.clone(),
                },
            )
            .await
            .map_err(database_error)
    }
}
