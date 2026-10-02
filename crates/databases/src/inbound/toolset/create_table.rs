//! CreateTable tool: add a tab to an existing database.

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

/// Add a table to a database.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateTable",
    description = "\
Add a table — what the user sees as a tab — to an existing database. The new table starts \
empty, with no columns beyond the implicit `row_id`; the first column you add is each row's \
title.\n\
\n\
Use this for a genuinely separate list that belongs with the others (\"add a Sessions tab to \
the offsite tracker\"), not for more columns on an existing one — that is AddColumn. Tables \
of one database can be joined in one query, and a relation (AddColumn with \
`linkToTableId`) is how rows of one point at rows of the other.\n\
\n\
Requires edit access to the database. The response is the database's refreshed schema, so the \
new table's `id` and its exact `sqlName` are there without a second call — SQL names are \
derived from display names and disambiguated against the ones already taken, so read the \
`sqlName` rather than deriving it yourself. If `database` is null, creation still succeeded; \
call DescribeDatabase using databaseId before continuing. Do not repeat the create."
)]
pub struct CreateTable {
    /// The database to add the table to.
    #[schemars(description = "Id of the database to add the table to, from ListDatabases.")]
    pub database_id: DatabaseId,

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
    /// Database containing the committed table.
    pub database_id: DatabaseId,
    /// The new table's id. Pass this to AddColumn.
    pub table_id: TableId,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed table.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>> for CreateTable
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = CreateTableResponse;

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
        let id = TableId::new();
        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch::from(vec![DatabaseOp::Table {
                    table: id,
                    change: TableChange::Create {
                        name: self.name.clone(),
                    },
                }]),
            )
            .await?;

        // Read the schema back rather than deriving the SQL name here: the
        // catalog disambiguates names against the ones already taken, so a
        // locally computed one would be wrong exactly when it matters.
        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;

        Ok(CreateTableResponse {
            table_id: id,
            database_id: self.database_id,
            database,
            warning,
        })
    }
}
