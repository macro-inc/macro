//! ChangeColumnType tool: retype a column, converting its values.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use std::collections::HashMap;

use models_databases::{
    ColumnChange, ColumnId, DatabaseId, DatabaseOp, NewOption, OptionId, TableId,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    ColumnType, DatabasesToolContext, SchemaAfterWrite, ToolDatabaseSchema, ToolEntityType,
    WriteWarnings, column_kind, column_of, table_of,
};
use crate::domain::models::OpBatch;
use crate::domain::ports::DatabasesService;

/// Change a column's type.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ChangeColumnType",
    description = "\
Change a column's type, converting every existing value. The column keeps its id and name.\n\
\n\
DescribeDatabase lists each column's `safeTypes` (every value converts) and `checkedTypes` \
(each value is checked first). Any other type is refused while the column holds values; an \
empty column takes any type. If a value does not fit (\"soon\" as a number), or a \
multi-valued cell would lose values to a single-valued type, nothing changes and the error \
counts the misfits and quotes a few: fix them with UPDATE and retry, or add a new column. \
Clear values only when the user asked for that.\n\
\n\
- `entity` needs `specificEntityType`: `USER` makes a person column; `DOCUMENT`, `TASK` \
and the rest reference other Macro items.\n\
- `linkToTableId` (with `dataType: entity`) makes a relation to rows of another table of \
this database. Relations are always multi-valued, and the column must be empty.\n\
- Converting to `select` or `tag` turns the distinct existing values into options; `options` \
adds labels no row has yet. `tag` columns are always multi-valued.\n\
\n\
Requires edit access. The response is the schema after the change."
)]
pub struct ChangeColumnType {
    /// The database containing the column.
    #[schemars(description = "Id of the database containing the column, from ListDatabases.")]
    pub database_id: DatabaseId,
    /// The table containing the column.
    #[schemars(description = "Id of the table containing the column, from DescribeDatabase.")]
    pub table_id: TableId,
    /// The column to change.
    #[schemars(description = "Id of the column to change, from DescribeDatabase.")]
    pub column_id: ColumnId,
    /// The new value type.
    #[schemars(
        description = "The new type: text, number, boolean, date, link (a URL), select, \
                       select_number, tag, or entity."
    )]
    pub data_type: ColumnType,
    /// Whether a cell may hold several values.
    #[schemars(
        description = "True if a cell can hold several values (select, select_number, entity, \
                       link). Defaults to false."
    )]
    #[serde(default)]
    pub is_multi_select: bool,
    /// Extra labels for a select or tag column.
    #[schemars(
        description = "For select, select_number, or tag: labels to accept beyond the values \
                       the rows already have. Omit for other types."
    )]
    #[serde(default)]
    pub options: Option<Vec<String>>,
    /// Entity kind for an entity column.
    #[schemars(
        description = "Required for dataType entity without linkToTableId: what the ids \
                       reference, e.g. USER or DOCUMENT."
    )]
    #[serde(default)]
    pub specific_entity_type: Option<ToolEntityType>,
    /// Relation target.
    #[schemars(
        description = "Id of a table of this database to relate to; makes the column a \
                       relation holding row ids. Requires dataType entity."
    )]
    #[serde(default)]
    pub link_to_table_id: Option<TableId>,
}

impl ToolAnnotated for ChangeColumnType {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Change column type");
}

/// Response from the ChangeColumnType tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeColumnTypeResponse {
    /// Database containing the column.
    pub database_id: DatabaseId,
    /// Table containing the column.
    pub table_id: TableId,
    /// The changed column's id, unchanged by the conversion.
    pub column_id: ColumnId,
    /// The database's schema after the change.
    pub database: Option<ToolDatabaseSchema>,
    /// Follow-up guidance if part of the change or the schema refresh failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(with = "Option<String>")]
    pub warning: Option<WriteWarnings>,
}

#[async_trait]
impl<Service, EntityAccess> AsyncTool<DatabasesToolContext<Service, EntityAccess>>
    for ChangeColumnType
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
{
    type Output = ChangeColumnTypeResponse;

    #[tracing::instrument(skip_all, fields(
        user_id = ?request_context.user_id,
        database_id = %self.database_id,
        table_id = %self.table_id,
        column_id = %self.column_id,
        data_type = ?self.data_type,
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<DatabasesToolContext<Service, EntityAccess>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user_id = &request_context.user_id;
        let detail = service_context
            .current_schema(user_id, self.database_id)
            .await?;
        let table = table_of(&detail, self.table_id)?;
        column_of(table, self.column_id)?;
        let base_version = table.table.version;
        let to = column_kind(
            self.data_type,
            self.is_multi_select,
            self.specific_entity_type,
            self.link_to_table_id
                .map(|table_id| (self.database_id, table_id)),
        )?;

        // The labels no row has yet join the new type's options in the same
        // request, so the change and its options commit together.
        let mut ops = vec![DatabaseOp::Column {
            table: self.table_id,
            column: self.column_id,
            change: ColumnChange::ChangeType { to },
        }];
        if let Some(labels) = self.options.as_ref().filter(|labels| !labels.is_empty()) {
            ops.push(DatabaseOp::Column {
                table: self.table_id,
                column: self.column_id,
                change: ColumnChange::AddOptions {
                    options: labels
                        .iter()
                        .map(|label| NewOption {
                            id: OptionId::new(),
                            label: label.clone(),
                        })
                        .collect(),
                },
            });
        }
        service_context
            .apply(
                user_id,
                self.database_id,
                OpBatch {
                    ops,
                    base_versions: HashMap::from([(self.table_id, base_version)]),
                },
            )
            .await?;
        let SchemaAfterWrite { database, warning } = service_context
            .schema_after_write(user_id, self.database_id)
            .await;
        Ok(ChangeColumnTypeResponse {
            database_id: self.database_id,
            table_id: self.table_id,
            column_id: self.column_id,
            database,
            warning,
        })
    }
}
