//! DescribeDatabase tool: the schema a model needs before it writes SQL.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::DatabaseId;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{DatabasesToolContext, ToolDatabaseSchema, database_error};
use crate::domain::ports::DatabasesService;

/// Read one database's schema.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DescribeDatabase",
    description = "Read a database's tables, versions and columns before writing SQL: IDs, exact SQL names, types, select labels, and relation targets. Pass includeEditingMetadata only when editing views or changing column types to include saved views and conversion targets. Get databaseId from ListDatabases."
)]
pub struct DescribeDatabase {
    /// The database to describe.
    #[schemars(description = "Id of the database to describe, as returned by ListDatabases.")]
    pub database_id: DatabaseId,
    /// Include saved views and per-column type conversion targets. Omit for queries.
    #[serde(default)]
    pub include_editing_metadata: bool,
}

impl ToolAnnotated for DescribeDatabase {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Describe database");
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for DescribeDatabase
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = ToolDatabaseSchema;

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
        let receipt = service_context
            .view_receipt(user_id, self.database_id)
            .await?;

        let detail = service_context
            .service
            .get_database(receipt)
            .await
            .map_err(database_error)?;

        let mut schema = ToolDatabaseSchema::from(detail);
        if !self.include_editing_metadata {
            for table in &mut schema.tables {
                table.views.clear();
                for column in &mut table.columns {
                    column.safe_types.clear();
                    column.checked_types.clear();
                }
            }
        }
        Ok(schema)
    }
}
