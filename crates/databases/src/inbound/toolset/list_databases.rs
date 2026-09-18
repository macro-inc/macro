//! ListDatabases tool: the databases the current user can reach.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{DatabasesToolContext, ToolDatabase, database_error, viewer_of};
use crate::domain::ports::DatabasesService;

/// List the databases the current user can reach.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListDatabases",
    description = "\
List the Macro databases the current user can reach, their own and ones shared with them. A \
database is a table the user built — a guest list, an applicant tracker, a vendor list — made \
of one or more tabs.\n\
\n\
Start here whenever the user refers to \"my table\", \"the tracker\", or any named list of \
theirs: this is the only way to turn that name into the `databaseId` every other database tool \
needs. Each entry comes back with its `id`, `name`, and `grant` (view, comment, edit, or \
owner) — `view` and `comment` mean QueryDatabase can read it but not write to it.\n\
\n\
Takes no arguments and returns every database, so there is no filter to get wrong. Follow it \
with DescribeDatabase to see one database's tables and columns before writing SQL."
)]
pub struct ListDatabases {}

impl ToolAnnotated for ListDatabases {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("List databases");
}

/// Response from the ListDatabases tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDatabasesResponse {
    /// The databases, oldest first.
    pub databases: Vec<ToolDatabase>,
    /// A human-readable summary of what came back.
    pub summary: String,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for ListDatabases
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = ListDatabasesResponse;

    #[tracing::instrument(skip_all, fields(user_id = ?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("List databases");

        let databases = service_context
            .service
            .list_databases(viewer_of(&request_context.user_id))
            .await
            .map_err(database_error)?;

        let databases: Vec<ToolDatabase> = databases.into_iter().map(ToolDatabase::from).collect();
        let summary = summarize(&databases);
        Ok(ListDatabasesResponse { databases, summary })
    }
}

/// Say what came back, including the empty case, which a model otherwise
/// reports as a failure rather than as "you have no databases yet".
pub(super) fn summarize(databases: &[ToolDatabase]) -> String {
    match databases.len() {
        0 => "The user has no databases yet. CreateDatabase makes one.".to_string(),
        1 => "Found 1 database.".to_string(),
        n => format!("Found {n} databases."),
    }
}
