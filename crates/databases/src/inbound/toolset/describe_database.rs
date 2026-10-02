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
    description = "\
Read one database's schema: its tables with their quoted `sqlName`, version and saved views, \
and each table's columns with their SQL names, types (with the kind of an entity column, \
`USER` for a person column), whether they hold several values, the labels a select column \
accepts, the target table of a relation, and the types the column can change to.\n\
\n\
**Call this before writing SQL for a database you have not already described in this \
conversation.** Guessing table or column names is the single most common way a query fails, \
and the schema is small. Get the `databaseId` from ListDatabases. QueryDatabase describes the \
SQL dialect."
)]
pub struct DescribeDatabase {
    /// The database to describe.
    #[schemars(description = "Id of the database to describe, as returned by ListDatabases.")]
    pub database_id: DatabaseId,
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

        Ok(detail.into())
    }
}
