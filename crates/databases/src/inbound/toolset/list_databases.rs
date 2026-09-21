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
List every accessible Macro database AND its table tabs, including owned and shared data. \
A database is a container; its name can differ from a requested table's name. For example, \
the Tickets table might be inside a database named Product. Search every entry's `tables`, \
not just database names.\n\
\n\
Start here whenever the user refers to \"my table\", \"the tracker\", or any named list of \
theirs: this is the only way to turn that name into the `databaseId` every other database tool \
needs. Each entry includes `id`, `name`, `grant`, and nested `tables` with their ids, display \
names, and stable read aliases. `view` and `comment` permit reading, not row/schema edits.\n\
\n\
Takes no arguments and returns every database, so there is no filter to get wrong. Follow it \
with DescribeDatabase for the matching database's columns before writing SQL. Do not claim a \
table is absent until you have checked the returned table names; resolve duplicate names \
using their database context. An empty result means no accessible databases, not proof that \
no such data exists elsewhere."
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
        0 => "No accessible databases were found. CreateDatabase can create one when requested."
            .to_string(),
        1 => "Found 1 database.".to_string(),
        n => format!("Found {n} databases."),
    }
}
