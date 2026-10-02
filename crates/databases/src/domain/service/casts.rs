//! The dry run of a type change: what changing a column to each type of the
//! type menu would do to its values, read in one pass over its cells.

use super::column_types::{ConvertedCell as Converted, Converter, is_empty};
use super::views::views_without_tests_of;
use super::*;
use crate::domain::catalog::PropertyType;
use crate::domain::catalog::entity_kind;
use crate::domain::models::{CastVerdict, ConvertedCell};
use models_databases::cast::{Cast, Contents, TARGETS, cast};
use models_databases::{CellValue, ColumnKind, EntityRef, OptionRef};

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// Why a column's type cannot change at all, whatever it holds: a board
    /// groups by it.
    async fn retype_blocker(
        &self,
        table_id: TableId,
        detail: &ColumnDetail,
    ) -> Result<Option<SchemaError>, DatabaseError> {
        let views = self
            .repository
            .views_for_tables(&[table_id])
            .await
            .map_err(repository_error)?;
        Ok(views_without_tests_of(
            &views,
            detail.column.id,
            models_databases::views::written_at(),
        )
        .err())
    }

    pub(super) async fn preview_casts(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<Vec<ColumnCast>, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let grant = receipt_grant(&receipt, AccessLevel::View);
        let detail = self
            .column_detail(database_id, grant, table_id, column_id)
            .await?;
        let targets = TARGETS
            .into_iter()
            .map(PropertyType::from_column_kind)
            .chain([PropertyType::RELATION]);
        if let Some(reason) = self.retype_blocker(table_id, &detail).await? {
            let reason = reason.to_string();
            return Ok(targets.map(|target| never(target, &reason)).collect());
        }

        let rows = self.rows_with_cells(table_id).await?;
        let definition_id = detail.definition.definition.id;
        let contents = if rows.iter().any(|(_, cells)| {
            cells
                .get(&definition_id)
                .is_some_and(|value| !is_empty(value))
        }) {
            Contents::Filled
        } else {
            Contents::Empty
        };
        let current = PropertyType::of(&detail.column, &detail.definition);
        let from = current.cast_kind();

        let verdicts: Vec<(PropertyType, Cast)> = targets
            .map(|target| {
                let verdict = if target == current {
                    Cast::Safe
                } else {
                    cast(from, target.cast_kind(), contents)
                };
                (target, verdict)
            })
            .collect();
        let mut converters: Vec<(usize, Converter)> = verdicts
            .iter()
            .enumerate()
            .filter(|(_, (_, verdict))| *verdict == Cast::Checked)
            .map(|(index, (target, _))| (index, Converter::new(&detail.definition, *target)))
            .collect();
        for (row, cells) in &rows {
            if let Some(value) = cells.get(&definition_id) {
                for (_, converter) in &mut converters {
                    converter.push(row.id, value);
                }
            }
        }

        let mut casts: Vec<ColumnCast> = verdicts
            .iter()
            .map(|(target, verdict)| match verdict {
                Cast::Safe => cast_of(*target, CastVerdict::Safe),
                Cast::Checked => cast_of(*target, CastVerdict::Checked),
                Cast::Never(reason) => never(*target, reason),
            })
            .collect();
        for (index, converter) in converters {
            casts[index].failures = converter.failures();
            casts[index].summary = converter.summary();
            casts[index].examples = converter.examples();
        }
        Ok(casts)
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// The values of a column that convert to `to`, by the same cast rule
    /// and converter a type change uses.
    pub(super) async fn convert_values(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        to: ColumnKind,
    ) -> Result<ColumnConversion, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let grant = receipt_grant(&receipt, AccessLevel::View);
        let entry = self
            .entries_for(&HashMap::from([(database_id, grant)]))
            .await?
            .into_iter()
            .find(|entry| entry.table.id == table_id)
            .ok_or(DatabaseError::NotFound)?;
        let column = entry
            .columns
            .iter()
            .find(|column| column.column.id == column_id)
            .ok_or(DatabaseError::NotFound)?;
        let rows = self.rows_with_cells(table_id).await?;
        if rows.len() > MAX_CONVERTED_ROWS {
            return Err(SchemaError::TooManyRowsToRetype.into());
        }
        let definition_id = column.definition.definition.id;
        let current = PropertyType::of(&column.column, &column.definition);
        let target = PropertyType::from_column_kind(to);
        let contents = if rows.iter().any(|(_, cells)| {
            cells
                .get(&definition_id)
                .is_some_and(|value| !is_empty(value))
        }) {
            Contents::Filled
        } else {
            Contents::Empty
        };
        if let Cast::Never(reason) = cast(current.cast_kind(), target.cast_kind(), contents) {
            return Err(SchemaError::NeverCasts(reason).into());
        }
        let mut converter = Converter::new(&column.definition, target);
        for (row, cells) in &rows {
            if let Some(value) = cells.get(&definition_id) {
                converter.push(row.id, value);
            }
        }
        let options = validate_option_labels(target.data_type, &converter.labels, &[])?
            .iter()
            .map(catalog::option_display)
            .collect();
        let failures = converter.failures();
        let converted = converter.cells.len();
        let cells: Vec<ConvertedCell> = converter
            .cells
            .into_iter()
            .filter_map(|(row, value)| cell_value(value).map(|value| ConvertedCell { row, value }))
            .collect();
        // A value no op can write counts as one that did not convert.
        let misfits = u32::try_from(failures + converted - cells.len()).unwrap_or(u32::MAX);
        Ok(ColumnConversion {
            table_version: entry.table.version,
            options,
            cells,
            misfits,
        })
    }
}

/// A converted value as an op writes it, options by label.
fn cell_value(converted: Converted) -> Option<CellValue> {
    Some(match converted {
        Converted::Options(labels) => {
            CellValue::Options(labels.into_iter().map(OptionRef::Label).collect())
        }
        Converted::Value(PropertyValue::Str(text)) => CellValue::Text(text),
        Converted::Value(PropertyValue::Num(number)) => CellValue::Number(number),
        Converted::Value(PropertyValue::Bool(checked)) => CellValue::Boolean(checked),
        Converted::Value(PropertyValue::Date(date)) => CellValue::Date(date),
        Converted::Value(PropertyValue::Link(urls)) => CellValue::Link(urls),
        Converted::Value(PropertyValue::EntityRef(references)) => CellValue::Entities(
            references
                .into_iter()
                .map(|reference| {
                    Some(EntityRef {
                        entity_type: entity_kind(reference.entity_type)?,
                        entity_id: reference.entity_id,
                    })
                })
                .collect::<Option<_>>()?,
        ),
        Converted::Value(PropertyValue::SelectOption(_)) => return None,
    })
}

fn cast_of(target: PropertyType, cast: CastVerdict) -> ColumnCast {
    ColumnCast {
        data_type: target.data_type,
        is_multi_select: target.is_multi_select,
        specific_entity_type: target.specific_entity_type,
        relation: target.relation,
        cast,
        reason: None,
        failures: 0,
        summary: None,
        examples: Vec::new(),
    }
}

fn never(target: PropertyType, reason: &str) -> ColumnCast {
    ColumnCast {
        reason: Some(reason.to_owned()),
        ..cast_of(target, CastVerdict::Never)
    }
}
