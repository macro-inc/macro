//! CreateTable tool: add a tab to an existing database.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DatabasesToolContext, ToolDatabaseSchema, database_error, viewer_of};
use crate::domain::models::CreateTable as CreateTableCommand;
use crate::domain::ports::DatabasesService;

/// Add a table to a database.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateTable",
    description = "\
Add a table — what the user sees as a tab — to an existing database. The new table starts \
empty, with no columns of its own beyond the implicit `row_id`.\n\
\n\
Use this for a genuinely separate list that belongs with the others (\"add a Sessions tab to \
the offsite tracker\"), not for more columns on an existing one — that is AddColumn. Two \
tables in the same database can be joined in one query, and a link column between them \
(AddColumn with `linkToTableId`) is how rows on one side point at rows on the other.\n\
\n\
Requires edit access to the database. The response is the database's refreshed schema, so the \
new table's `id` and its exact `sqlName` are there without a second call — SQL names are \
derived from display names and disambiguated against the ones already taken, so read the \
`sqlName` rather than deriving it yourself."
)]
pub struct CreateTable {
    /// The database to add the table to.
    #[schemars(description = "Id of the database to add the table to, from ListDatabases.")]
    pub database_id: Uuid,

    /// Display name of the new table.
    #[schemars(
        description = "Display name of the table, as the user would title the tab — e.g. \
                       \"Sessions\". The SQL name is derived from it."
    )]
    pub name: String,
}

impl ToolAnnotated for CreateTable {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create table");
}

/// Response from the CreateTable tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableResponse {
    /// The new table's id. Pass this to AddColumn.
    pub table_id: Uuid,
    /// The database's schema after the change.
    pub database: ToolDatabaseSchema,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for CreateTable
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = CreateTableResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create table");

        let user_id = &request_context.user_id;
        let receipt = service_context
            .edit_receipt(user_id, self.database_id)
            .await?;

        let table = service_context
            .service
            .create_table(
                receipt,
                CreateTableCommand {
                    database_id: self.database_id,
                    name: self.name.clone(),
                },
            )
            .await
            .map_err(database_error)?;

        // Read the schema back rather than deriving the SQL name here: the
        // catalog disambiguates names against the ones already taken, so a
        // locally computed one would be wrong exactly when it matters.
        let view = service_context
            .view_receipt(user_id, self.database_id)
            .await?;
        let detail = service_context
            .service
            .get_database(view, viewer_of(user_id))
            .await
            .map_err(database_error)?;

        Ok(CreateTableResponse {
            table_id: table.id,
            database: detail.into(),
        })
    }
}
