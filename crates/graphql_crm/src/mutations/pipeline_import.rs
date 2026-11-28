use std::{collections::HashSet, sync::Arc};

use async_graphql::{ID, InputObject, OneofObject, SimpleObject};
use chrono::{DateTime, Utc};
use crm::domain::pipelines::{PipelineError, PipelineService};
use databases::domain::{
    models::{DatabaseError, OpBatch},
    storage::StorageRow,
};
use entity_access::domain::{
    models::{EditAccessLevel, ViewAccessLevel},
    ports::EntityAccessService,
};
use graphql_common::GraphqlPropertyEntityType;
use graphql_properties::GraphqlPropertyValue;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, DatabaseOp, DateRange, EntityKind, EntityRef,
    NewOption, OpResult, OptionId, OptionRef, RowId, RowsChange, RowsResult, TableId,
};

use super::{WriteFuture, access_error, coded_error, parse_id, write_error};

/// Bound each write and the primary read of its committed rows.
const MAX_IMPORT_ROWS: usize = 500;

/// Append imported records and add any missing options in the same transaction.
#[derive(InputObject)]
pub(super) struct InsertCrmPipelineRowsInput {
    /// The pipeline the caller is editing.
    pub(super) pipeline_id: ID,
    /// The pipeline's table.
    table_id: ID,
    /// The rows to append, at most 500 per request.
    pub(super) rows: Vec<CrmPipelineImportRowInput>,
    /// New options to add before inserting the rows.
    option_groups: Vec<CrmPipelineImportOptionGroupInput>,
}

/// A row from a pipeline import.
#[derive(InputObject)]
pub(super) struct CrmPipelineImportRowInput {
    /// Client-minted row UUID, retained on delivery retries.
    id: ID,
    /// Initial cell values, by column identifier.
    cells: Vec<CrmPipelineImportCellInput>,
}

/// New options on one imported column.
#[derive(InputObject)]
struct CrmPipelineImportOptionGroupInput {
    /// Column receiving the options.
    column_id: ID,
    /// Options to add.
    options: Vec<CrmPipelineImportOptionInput>,
}

/// One option introduced by a pipeline import.
#[derive(InputObject)]
struct CrmPipelineImportOptionInput {
    /// A client-minted option identifier.
    id: ID,
    /// The label displayed for the option.
    label: String,
}

/// A cell to write in an imported row.
#[derive(InputObject)]
struct CrmPipelineImportCellInput {
    /// The column receiving the value.
    column_id: ID,
    /// The imported value. A missing value leaves the cell empty.
    value: Option<CrmPipelineImportCellValue>,
}

/// The typed value of an imported pipeline cell.
#[derive(OneofObject)]
enum CrmPipelineImportCellValue {
    /// Plain text.
    Text(String),
    /// A numeric value.
    Number(f64),
    /// A checkbox value.
    Boolean(bool),
    /// An RFC 3339 timestamp.
    Date(String),
    /// A pair of RFC 3339 timestamps.
    DateRange(CrmPipelineImportDateRangeInput),
    /// URLs assigned to the cell.
    Links(Vec<String>),
    /// Option IDs or labels assigned to the cell.
    Options(Vec<CrmPipelineImportOptionRef>),
    /// Macro records assigned to the cell.
    Entities(Vec<CrmPipelineImportEntityInput>),
    /// Related database rows assigned to the cell.
    RowIds(Vec<ID>),
}

/// The inclusive start and end of an imported date range.
#[derive(InputObject)]
struct CrmPipelineImportDateRangeInput {
    /// First timestamp.
    start: String,
    /// Last timestamp.
    end: String,
}

/// An option named by its ID or its label.
#[derive(OneofObject)]
enum CrmPipelineImportOptionRef {
    /// The option's identifier.
    Id(ID),
    /// The option's label.
    Label(String),
}

/// A Macro record referenced by an imported cell.
#[derive(InputObject)]
struct CrmPipelineImportEntityInput {
    /// The kind of record.
    entity_type: GraphqlPropertyEntityType,
    /// The record's identifier.
    entity_id: String,
}

impl InsertCrmPipelineRowsInput {
    fn into_batch(self) -> async_graphql::Result<(Vec<RowId>, OpBatch)> {
        if !(1..=MAX_IMPORT_ROWS).contains(&self.rows.len()) {
            return Err(coded_error(
                "A pipeline import write accepts 1 to 500 rows",
                "BAD_REQUEST",
            ));
        }
        let table = TableId::from_uuid(parse_id(&self.table_id, "tableId")?);
        let mut ops = Vec::with_capacity(self.option_groups.len() + 1);
        for group in self.option_groups {
            let column = ColumnId::from_uuid(parse_id(&group.column_id, "columnId")?);
            let mut options = Vec::with_capacity(group.options.len());
            for option in group.options {
                options.push(NewOption {
                    id: OptionId::from_uuid(parse_id(&option.id, "optionId")?),
                    label: option.label,
                });
            }
            ops.push(DatabaseOp::Column {
                table,
                column,
                change: ColumnChange::AddOptions { options },
            });
        }
        let mut ids = Vec::with_capacity(self.rows.len());
        let mut seen = HashSet::with_capacity(self.rows.len());
        let mut rows = Vec::with_capacity(self.rows.len());
        for row in self.rows {
            let id = RowId::from_uuid(parse_id(&row.id, "rowId")?);
            if !seen.insert(id) {
                return Err(coded_error("Duplicate pipeline row ID", "BAD_REQUEST"));
            }
            ids.push(id);
            let mut cells = Vec::with_capacity(row.cells.len());
            for cell in row.cells {
                cells.push(CellWrite {
                    column: ColumnId::from_uuid(parse_id(&cell.column_id, "columnId")?),
                    value: cell
                        .value
                        .map(CrmPipelineImportCellValue::into_model)
                        .transpose()?
                        .unwrap_or(CellValue::Clear),
                });
            }
            rows.push(cells);
        }
        ops.push(DatabaseOp::Rows {
            table,
            change: RowsChange::Insert {
                rows,
                ids: Some(ids.clone()),
            },
        });
        Ok((ids, ops.into()))
    }
}

impl CrmPipelineImportCellValue {
    fn into_model(self) -> async_graphql::Result<CellValue> {
        Ok(match self {
            Self::Text(value) => CellValue::Text(value),
            Self::Number(value) => CellValue::Number(value),
            Self::Boolean(value) => CellValue::Boolean(value),
            Self::Date(value) => CellValue::Date(parse_date(&value)?),
            Self::DateRange(range) => CellValue::DateRange(DateRange {
                start: parse_date(&range.start)?,
                end: parse_date(&range.end)?,
            }),
            Self::Links(value) => CellValue::Link(value),
            Self::Options(values) => CellValue::Options(
                values
                    .into_iter()
                    .map(|option| match option {
                        CrmPipelineImportOptionRef::Id(id) => Ok(OptionRef::Id(
                            OptionId::from_uuid(parse_id(&id, "optionId")?),
                        )),
                        CrmPipelineImportOptionRef::Label(label) => Ok(OptionRef::Label(label)),
                    })
                    .collect::<async_graphql::Result<_>>()?,
            ),
            Self::Entities(values) => CellValue::Entities(
                values
                    .into_iter()
                    .map(entity_ref)
                    .collect::<async_graphql::Result<_>>()?,
            ),
            Self::RowIds(ids) => CellValue::Rows(
                ids.iter()
                    .map(|id| parse_id(id, "rowId").map(RowId::from_uuid))
                    .collect::<async_graphql::Result<_>>()?,
            ),
        })
    }
}

fn entity_ref(input: CrmPipelineImportEntityInput) -> async_graphql::Result<EntityRef> {
    use GraphqlPropertyEntityType as Kind;
    let entity_type = match input.entity_type {
        Kind::User => EntityKind::User,
        Kind::Document => EntityKind::Document,
        Kind::Task => EntityKind::Task,
        Kind::Company => EntityKind::Company,
        Kind::Contact => EntityKind::Contact,
        Kind::CallRecord => EntityKind::CallRecord,
        Kind::Channel => EntityKind::Channel,
        Kind::Chat => EntityKind::Chat,
        Kind::Project => EntityKind::Project,
        Kind::Thread => EntityKind::Thread,
        Kind::CalendarEvent => EntityKind::CalendarEvent,
        Kind::Initiative => EntityKind::Initiative,
        Kind::DatabaseRow => {
            return Err(coded_error(
                "Use rowIds for a record in a related table",
                "BAD_REQUEST",
            ));
        }
    };
    Ok(EntityRef {
        entity_type,
        entity_id: input.entity_id,
    })
}

fn parse_date(value: &str) -> async_graphql::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .map_err(|_| coded_error("Invalid pipeline cell date", "BAD_REQUEST"))
}

/// A populated cell read from a committed pipeline row.
#[derive(SimpleObject)]
struct CrmPipelineImportCell {
    /// The column containing the value.
    column_id: ID,
    /// The stored value.
    value: GraphqlPropertyValue,
}

/// A pipeline entry visible through the pipeline's own access receipt.
#[derive(SimpleObject)]
struct GraphqlCrmPipelineRow {
    /// Stable row identity for the normalized cache.
    id: ID,
    /// The pipeline holding this row.
    pipeline_id: ID,
    /// Populated cells, including server defaults.
    cells: Vec<CrmPipelineImportCell>,
}

/// The imported row identifiers and their committed primary data.
#[derive(SimpleObject)]
pub(super) struct CrmPipelineImportPayload {
    /// The inserted row identifiers, in input order.
    row_ids: Vec<ID>,
    /// Inserted records in input order, subject to concurrent deletions.
    /// A missing list means the rows committed but could not be read.
    rows: Option<Vec<GraphqlCrmPipelineRow>>,
}

impl CrmPipelineImportPayload {
    fn new(pipeline: ID, ids: Vec<RowId>, rows: Option<Vec<StorageRow>>) -> Self {
        let row_ids = ids.iter().map(|id| ID(id.to_string())).collect();
        let rows = rows.map(|rows| {
            let mut by_id = rows
                .into_iter()
                .map(|row| (row.row_id, row.cells))
                .collect::<std::collections::HashMap<_, _>>();
            ids.into_iter()
                .filter_map(|id| {
                    let mut cells = by_id
                        .remove(&id)?
                        .into_iter()
                        .map(|(column, value)| CrmPipelineImportCell {
                            column_id: ID(column.to_string()),
                            value: GraphqlPropertyValue::new(&value),
                        })
                        .collect::<Vec<_>>();
                    cells.sort_unstable_by(|a, b| a.column_id.as_str().cmp(b.column_id.as_str()));
                    Some(GraphqlCrmPipelineRow {
                        id: ID(id.to_string()),
                        pipeline_id: pipeline.clone(),
                        cells,
                    })
                })
                .collect()
        });
        Self { row_ids, rows }
    }
}

pub(super) trait CrmPipelineImportApi: Send + Sync {
    fn insert_rows(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: InsertCrmPipelineRowsInput,
    ) -> WriteFuture<'_, CrmPipelineImportPayload>;
}

pub(super) struct CrmPipelineImportAdapter<P, A> {
    pub(super) pipelines: Arc<P>,
    pub(super) access: Arc<A>,
}

impl<P: PipelineService, A: EntityAccessService> CrmPipelineImportApi
    for CrmPipelineImportAdapter<P, A>
{
    fn insert_rows(
        &self,
        viewer: MacroUserIdStr<'static>,
        input: InsertCrmPipelineRowsInput,
    ) -> WriteFuture<'_, CrmPipelineImportPayload> {
        Box::pin(async move {
            let pipeline = parse_id(&input.pipeline_id, "pipelineId")?;
            let receipt = self
                .access
                .generate_entity_access_receipt::<EditAccessLevel>(
                    &viewer,
                    None,
                    &pipeline.to_string(),
                    EntityType::CrmPipeline,
                )
                .await
                .map_err(|error| access_error(error, "FORBIDDEN"))?;
            let read = receipt
                .clone()
                .try_into_requirement::<ViewAccessLevel>()
                .map_err(|error| access_error(error, "FORBIDDEN"))?;
            let (ids, batch) = input.into_batch()?;
            let collision = match self.pipelines.apply_ops(receipt, None, batch).await {
                Ok(applied) => {
                    let Some(OpResult::Rows {
                        change: RowsResult::Inserted { rows },
                        ..
                    }) = applied.results.into_iter().last()
                    else {
                        return Err(coded_error(
                            "The import returned no inserted IDs",
                            "INTERNAL_SERVER_ERROR",
                        ));
                    };
                    if rows != ids {
                        return Err(coded_error(
                            "The import returned different row IDs",
                            "INTERNAL_SERVER_ERROR",
                        ));
                    }
                    None
                }
                Err(error @ PipelineError::Database(DatabaseError::InvalidOp(_))) if matches!(&error, PipelineError::Database(DatabaseError::InvalidOp(refusal)) if refusal.taken.is_some()) => {
                    Some(error)
                }
                Err(error) => return Err(pipeline_error(error)),
            };

            // Keep pipeline rows behind their own receipt. The primary Soup
            // loader cannot see a pipeline's internal backing table.
            let rows = self.pipelines.read_rows(read, &ids).await;
            let rows = match (rows, collision) {
                (Ok(rows), None) => Some(rows),
                (Ok(rows), Some(error)) => {
                    // Reusing the full set of row IDs within this pipeline
                    // acknowledges a committed import after a lost response.
                    // A partial collision still refuses the whole request.
                    if rows.len() != ids.len() {
                        return Err(pipeline_error(error));
                    }
                    Some(rows)
                }
                (Err(error), Some(_)) => return Err(pipeline_error(error)),
                (Err(error), None) => {
                    tracing::warn!(?error, %pipeline, "could not read committed pipeline rows");
                    None
                }
            };
            Ok(CrmPipelineImportPayload::new(
                ID(pipeline.to_string()),
                ids,
                rows,
            ))
        })
    }
}

fn pipeline_error(error: PipelineError) -> async_graphql::Error {
    match error {
        PipelineError::Invalid(message) => coded_error(message, "BAD_REQUEST"),
        PipelineError::NotFound | PipelineError::Database(DatabaseError::NotFound) => {
            coded_error("Pipeline not found", "NOT_FOUND")
        }
        PipelineError::Access(error) => access_error(error, "FORBIDDEN"),
        PipelineError::Crm(error) => write_error(error),
        PipelineError::Database(DatabaseError::InvalidOp(refusal)) => {
            let code = if refusal.taken.is_some() {
                "IMPORT_ID_TAKEN"
            } else {
                "INVALID_OP"
            };
            coded_error(refusal.reason, code)
        }
        PipelineError::Database(DatabaseError::Unauthorized) => {
            coded_error("Pipeline edit is forbidden", "FORBIDDEN")
        }
        error => {
            tracing::error!(?error, "CRM pipeline import failed");
            coded_error("CRM pipeline import failed", "INTERNAL_SERVER_ERROR")
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use uuid::Uuid;

    fn batch_with(ids: impl IntoIterator<Item = Uuid>) -> InsertCrmPipelineRowsInput {
        InsertCrmPipelineRowsInput {
            pipeline_id: ID(Uuid::from_u128(1).to_string()),
            table_id: ID(Uuid::from_u128(2).to_string()),
            rows: ids
                .into_iter()
                .map(|id| CrmPipelineImportRowInput {
                    id: ID(id.to_string()),
                    cells: Vec::new(),
                })
                .collect(),
            option_groups: Vec::new(),
        }
    }

    #[test]
    fn import_batches_preserve_explicit_rows_and_are_bounded() {
        let ids: Vec<_> = (1..=MAX_IMPORT_ROWS as u128).map(Uuid::from_u128).collect();
        let (rows, _) = batch_with(ids.iter().copied()).into_batch().unwrap();
        assert_eq!(
            rows,
            ids.into_iter().map(RowId::from_uuid).collect::<Vec<_>>()
        );
        assert!(batch_with([]).into_batch().is_err());
        assert!(
            batch_with((1..=501).map(Uuid::from_u128))
                .into_batch()
                .is_err()
        );
        assert!(batch_with([Uuid::from_u128(4); 2]).into_batch().is_err());
    }
}
