//! DescribeDatabase tool: the schema a model needs before it writes SQL.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;
use uuid::Uuid;

use super::{
    DatabasesToolContext, ToolDatabaseSchema, database_error, magic_tables_note, sql_guide,
    viewer_of,
};
use crate::domain::ports::DatabasesService;

/// Read one database's schema.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DescribeDatabase",
    description = concat!(
        "\
Read one database's schema: tables with current writable `sqlName`, stable read-only \
`readSqlName`, and version, and each table's columns \
with their SQL names, value types, whether they hold multiple values, and the exact labels a \
select column accepts, plus specific entity kinds. Use table/column `name` only to match the \
user's language; use exact quoted SQL identifiers when executing.\n\
\n\
**Call this before writing SQL for a database you have not already described in this \
conversation.** Guessing table or column names is the single most common way a query fails, \
and the schema is small. Get the `databaseId` from ListDatabases.\n\
\n\
## The magic tables\n\
\n",
        magic_tables_note!(),
        "\n\
\n\
## Writing SQL against it\n\
\n",
        sql_guide!(),
    )
)]
pub struct DescribeDatabase {
    /// The database to describe.
    #[schemars(description = "Id of the database to describe, as returned by ListDatabases.")]
    pub database_id: Uuid,
}

impl ToolAnnotated for DescribeDatabase {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Describe database");
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for DescribeDatabase
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = ToolDatabaseSchema;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Describe database");

        let user_id = &request_context.user_id;
        let receipt = service_context
            .view_receipt(user_id, self.database_id)
            .await?;

        let detail = service_context
            .service
            .get_database(receipt, viewer_of(user_id))
            .await
            .map_err(database_error)?;

        Ok(detail.into())
    }
}
