//! CreateDatabase tool: make a new database with one starter table.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DatabasesToolContext, ToolDatabaseSchema, database_error};
use crate::domain::models::CreateDatabase as CreateDatabaseCommand;
use crate::domain::ports::DatabasesService;

/// Create a database owned by the current user.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateDatabase",
    description = "\
Create a new Macro database owned by the current user — the thing they see as a table. It \
starts with one empty table and no columns of its own beyond the implicit `row_id`.\n\
\n\
Use this when the user asks for a new tracker, list, or table (\"make me a table of \
applicants\"). Check ListDatabases first if there is any chance one already exists under that \
name — a second database with the same name is confusing and there is no merge.\n\
\n\
The response acknowledges the new database `id` and `name`, with its full schema in `database` \
including the starter table's id. If `database` is null, creation still succeeded: heed the \
warning and call DescribeDatabase with the returned id; never repeat CreateDatabase just \
because schema refresh failed. The usual shape of the work is: \
CreateDatabase, then one AddColumn per column the user described, then QueryDatabase with \
INSERTs for the rows."
)]
pub struct CreateDatabase {
    /// Display name of the new database.
    #[schemars(
        description = "Display name, as the user would title it — e.g. \"Offsite Guests\". The \
                       SQL name is derived from this, so prefer what the user actually called \
                       it over a SQL-looking identifier."
    )]
    pub name: String,
}

impl ToolAnnotated for CreateDatabase {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Create database");
}

/// A committed database creation, independent of its subsequent schema read.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseResponse {
    /// Id of the database that was created, even if schema refresh failed.
    pub id: Uuid,
    /// Its persisted display name.
    pub name: String,
    /// Refreshed schema and starter table, when available.
    pub database: Option<ToolDatabaseSchema>,
    /// Follow-up instructions if the change committed but schema refresh failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for CreateDatabase
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = CreateDatabaseResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Create database");

        let user_id = &request_context.user_id;
        let database = service_context
            .service
            .create_database(CreateDatabaseCommand {
                name: self.name.clone(),
                owner_id: user_id.clone(),
            })
            .await
            .map_err(database_error)?;

        // Read it straight back rather than reporting only the id: the model's
        // next call is almost always AddColumn, which needs the starter
        // table's id, and that is not in the create response.
        let (schema, warning) = service_context
            .schema_after_write(user_id, database.id)
            .await;
        Ok(CreateDatabaseResponse {
            id: database.id,
            name: database.name,
            database: schema,
            warning,
        })
    }
}
