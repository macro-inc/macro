//! AddColumn tool: add a typed column to a table.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{ColumnType, DatabasesToolContext, ToolDatabaseSchema, database_error, viewer_of};
use crate::domain::models::{ColumnBinding, ColumnConfig, CreateColumn};
use crate::domain::ports::DatabasesService;

/// Add a column to a table.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AddColumn",
    description = "\
Add a column to a table in one of the user's databases. Columns are typed, and the type is \
what makes the data useful later — a `date` column sorts and filters by time, a `number` \
column sums, a `select` column constrains what can be written to it.\n\
\n\
Pick the type from what the values actually are, not from how they were typed at you: \"Going \
/ Maybe / Declined\" is a `select`, not `text`; \"$1,200\" is a `number`; \"Aug 13\" is a \
`date`. Use `text` only when the values really are free-form.\n\
\n\
- `isMultiSelect: true` makes the column hold several values at once. In SQL it reads as a \
JSON array and also gets a companion `table__column(row_id, linkedId)` junction table; \
`col HAS 'x'` tests membership.\n\
- `linkToTableId` makes it a **link column** pointing at another table, so rows on one side \
reference rows on the other. Link columns are many-to-many and junction-backed; join through \
the junction rather than comparing the JSON array.\n\
- `entity` columns hold references to Macro things (people, documents). Their values are typed \
ids, and joining them against the `people` or `documents` magic table is how you get names.\n\
\n\
Select and tag columns are created with **no options**; the options come into existence as \
rows are written. Requires edit access. The response is the table's database schema after the \
change, including the new column's exact `sqlName`."
)]
pub struct AddColumn {
    /// The database the table belongs to.
    #[schemars(description = "Id of the database the table belongs to, from ListDatabases.")]
    pub database_id: Uuid,

    /// The table to add the column to.
    #[schemars(
        description = "Id of the table to add the column to, from DescribeDatabase or \
                       CreateTable. It must belong to databaseId."
    )]
    pub table_id: Uuid,

    /// Display name of the new column.
    #[schemars(
        description = "Display name of the column, as the user would head it — e.g. \"Dietary \
                       Needs\". The SQL name is derived from it."
    )]
    pub name: String,

    /// The value type of the column.
    #[schemars(
        description = "The kind of value the column holds: text, number, boolean, date, link \
                       (a URL), select (a fixed set of text labels), select_number, tag, or \
                       entity (a reference to a Macro person or document)."
    )]
    pub data_type: ColumnType,

    /// Whether the column holds several values at once.
    #[schemars(
        description = "True if a cell can hold several values at once. Defaults to false. \
                       Multi-valued cells read as JSON arrays in SQL and get a junction table; \
                       test membership with `col HAS 'x'`."
    )]
    #[serde(default)]
    pub is_multi_select: bool,

    /// Make this a link column targeting another table.
    #[schemars(
        description = "Id of another table to link to, making this a link column whose rows \
                       reference rows over there. Omit for an ordinary column. The target \
                       table must be one the user can reach."
    )]
    #[serde(default)]
    pub link_to_table_id: Option<Uuid>,
}

impl ToolAnnotated for AddColumn {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Add column");
}

/// Response from the AddColumn tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddColumnResponse {
    /// The new column placement's id.
    pub column_id: Uuid,
    /// The database's schema after the change.
    pub database: ToolDatabaseSchema,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for AddColumn
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = AddColumnResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
        table_id = %self.table_id,
        data_type = ?self.data_type,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Add column");

        let user_id = &request_context.user_id;
        let receipt = service_context
            .edit_receipt(user_id, self.database_id)
            .await?;

        // A link target in another database is expressible but not something
        // this tool takes: the receipt covers one database, so the config
        // names the same one.
        let config = self.link_to_table_id.map(|table_id| ColumnConfig::Link {
            database_id: self.database_id,
            table_id,
        });

        let column_id = service_context
            .service
            .create_column(
                receipt,
                viewer_of(user_id),
                CreateColumn {
                    table_id: self.table_id,
                    binding: ColumnBinding::NewDefinition {
                        name: self.name.clone(),
                        data_type: self.data_type.into(),
                        is_multi_select: self.is_multi_select,
                    },
                    config,
                },
            )
            .await
            .map_err(database_error)?;

        let view = service_context
            .view_receipt(user_id, self.database_id)
            .await?;
        let detail = service_context
            .service
            .get_database(view, viewer_of(user_id))
            .await
            .map_err(database_error)?;

        Ok(AddColumnResponse {
            column_id,
            database: detail.into(),
        })
    }
}
