//! CreateDatabase tool: make a new database with one starter table.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::Deserialize;

use super::{DatabasesToolContext, ToolDatabaseSchema, database_error, viewer_of};
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
The response is the new database's full schema, including the starter table's `id`, so you can \
go straight to AddColumn without describing it again. The usual shape of the work is: \
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

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for CreateDatabase
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = ToolDatabaseSchema;

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
        let receipt = service_context.view_receipt(user_id, database.id).await?;
        let detail = service_context
            .service
            .get_database(receipt, viewer_of(user_id))
            .await
            .map_err(database_error)?;

        Ok(detail.into())
    }
}
