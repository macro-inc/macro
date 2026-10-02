//! AddColumnOptions tool: extend what a select column accepts.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use models_databases::{
    ColumnChange, ColumnId, DatabaseId, DatabaseOp, NewOption, OptionId, TableId,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, WriteWarnings};
use crate::domain::models::OpBatch;
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
Use this when the user names a new status, stage, or category, or when a write they asked for \
was refused for an unknown option. Labels the column already has are ignored, so it is safe to \
send the whole set. A select_number column's labels must be numbers.\n\
\n\
This is add-only — options are never renamed or removed here, because both would change what \
rows already holding them mean. Requires edit access. The response is the column after the \
change, with the labels SQL now accepts, plus the database's refreshed schema. If `database` \
is null, the option change was still saved; heed warning and DescribeDatabase before \
continuing. Do not treat a failed follow-up read as a rejected mutation."
)]
pub struct AddColumnOptions {
    /// The database the column belongs to.
    #[schemars(description = "Id of the database the column belongs to, from ListDatabases.")]
    pub database_id: DatabaseId,

    /// The table the column belongs to.
    #[schemars(
        description = "Id of the table the column belongs to, from DescribeDatabase. It must \
                       belong to databaseId."
    )]
    pub table_id: TableId,

    /// The column to extend.
    #[schemars(
        description = "Id of the column to add options to, from DescribeDatabase. It must be a \
                       select, select_number, or tag column."
    )]
    pub column_id: ColumnId,

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
    /// Database containing the committed option change.
    pub database_id: DatabaseId,
    /// Table containing the committed option change.
    pub table_id: TableId,
    /// The column's id.
    pub column_id: ColumnId,
    /// Every label the column now accepts, in display order.
    pub options: Vec<String>,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// Follow-up guidance if schema refresh failed after options were saved.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for AddColumnOptions
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
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
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch::from(vec![DatabaseOp::Column {
                    table: self.table_id,
                    column: self.column_id,
                    change: ColumnChange::AddOptions {
                        options: self
                            .labels
                            .iter()
                            .map(|label| NewOption {
                                id: OptionId::new(),
                                label: label.clone(),
                            })
                            .collect(),
                    },
                }]),
            )
            .await?;

        // The catalog's labels, not the raw option text: duplicates are
        // disambiguated there, and a label that does not round-trip is one SQL
        // would reject.
        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        let options = database
            .as_ref()
            .and_then(|schema| schema.column_options(self.table_id, self.column_id))
            .unwrap_or_default();

        Ok(AddColumnOptionsResponse {
            column_id: self.column_id,
            options,
            database_id: self.database_id,
            table_id: self.table_id,
            database,
            warning,
        })
    }
}
