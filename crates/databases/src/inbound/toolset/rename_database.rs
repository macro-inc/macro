//! RenameDatabase tool: retitle a database.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::DatabaseId;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings, database_error,
};
use crate::domain::ports::DatabasesService;

/// Rename a database.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "RenameDatabase",
    description = "\
Rename a database, keeping its id, tables, and rows. Its tables' qualified SQL names \
(`\"Database\".\"Table\"`) change with it, so use the refreshed schema in the response for \
later statements.\n\
\n\
Requires edit access."
)]
pub struct RenameDatabase {
    /// The database to rename.
    #[schemars(description = "Id of the database to rename, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// New display name.
    #[schemars(description = "New display name, as the user would title it.")]
    pub name: String,
}

impl ToolAnnotated for RenameDatabase {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Rename database").with_idempotent();
}

/// Response from the RenameDatabase tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RenameDatabaseResponse {
    /// The renamed database's id.
    pub database_id: DatabaseId,
    /// Its display name after the rename.
    pub name: String,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// A failed follow-up read does not undo the committed rename.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for RenameDatabase
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = RenameDatabaseResponse;

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
            .edit_receipt(user_id, self.database_id)
            .await?;
        let renamed = service_context
            .service
            .rename_database(receipt, self.name.clone())
            .await
            .map_err(database_error)?;

        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(RenameDatabaseResponse {
            database_id: renamed.id,
            name: renamed.name,
            database,
            warning,
        })
    }
}
