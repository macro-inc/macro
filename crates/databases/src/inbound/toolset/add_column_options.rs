//! AddColumnOptions tool: extend what a select column accepts.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DatabasesToolContext, ToolDatabaseSchema, database_error, viewer_of};
use crate::domain::catalog::option_labels;
use crate::domain::models::AddColumnOptions as AddColumnOptionsCommand;
use crate::domain::ports::DatabasesService;

/// Add options to a select column.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "AddColumnOptions",
    description = "\
Add allowed labels to a select, select_number, or tag column. A select column's options are \
explicit schema: SQL accepts exactly the labels the column carries and rejects everything else, \
so a value that does not exist yet has to be added here before it can be written.\n\
\n\
Use this when an INSERT or UPDATE was rejected for an unknown option, or when the user names a \
new status, stage, or category. Labels the column already has are ignored, so it is safe to \
send the whole set. A select_number column's labels must be numbers.\n\
\n\
This is add-only — options are never renamed or removed here, because both would change what \
rows already holding them mean. Requires edit access. The response is the column after the \
change, with the labels SQL now accepts, plus the database's refreshed schema."
)]
pub struct AddColumnOptions {
    /// The database the column belongs to.
    #[schemars(description = "Id of the database the column belongs to, from ListDatabases.")]
    pub database_id: Uuid,

    /// The table the column belongs to.
    #[schemars(
        description = "Id of the table the column belongs to, from DescribeDatabase. It must \
                       belong to databaseId."
    )]
    pub table_id: Uuid,

    /// The column to extend.
    #[schemars(
        description = "Id of the column to add options to, from DescribeDatabase. It must be a \
                       select, select_number, or tag column."
    )]
    pub column_id: Uuid,

    /// The labels to add.
    #[schemars(
        description = "The labels to add, as SQL will write them — e.g. [\"Waitlisted\"]. \
                       Labels the column already has are ignored."
    )]
    pub labels: Vec<String>,
}

impl ToolAnnotated for AddColumnOptions {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::additive("Add column options");
}

/// Response from the AddColumnOptions tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddColumnOptionsResponse {
    /// The column's id.
    pub column_id: Uuid,
    /// Every label the column now accepts, in display order.
    pub options: Vec<String>,
    /// The database's schema after the change.
    pub database: ToolDatabaseSchema,
}

#[async_trait]
impl<S, E> AsyncTool<DatabasesToolContext<S, E>> for AddColumnOptions
where
    S: DatabasesService,
    E: EntityAccessService,
{
    type Output = AddColumnOptionsResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
        table_id = %self.table_id,
        column_id = %self.column_id,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<S, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!("Add column options");

        let user_id = &request_context.user_id;
        let receipt = service_context
            .edit_receipt(user_id, self.database_id)
            .await?;

        let column = service_context
            .service
            .add_column_options(
                receipt,
                viewer_of(user_id),
                AddColumnOptionsCommand {
                    table_id: self.table_id,
                    column_id: self.column_id,
                    labels: self.labels.clone(),
                },
            )
            .await
            .map_err(database_error)?;

        // The catalog's labels, not the raw option text: duplicates are
        // disambiguated there, and a label that does not round-trip is one SQL
        // would reject.
        let options = option_labels(&column.definition)
            .into_iter()
            .map(|(_, label)| label)
            .collect();

        let view = service_context
            .view_receipt(user_id, self.database_id)
            .await?;
        let detail = service_context
            .service
            .get_database(view, viewer_of(user_id))
            .await
            .map_err(database_error)?;

        Ok(AddColumnOptionsResponse {
            column_id: column.column.id,
            options,
            database: detail.into(),
        })
    }
}
