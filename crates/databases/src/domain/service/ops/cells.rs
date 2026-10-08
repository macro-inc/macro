//! Turning one row's cell writes into stored values, checked against each
//! column's type and options as the ops before them leave those.

use models_databases::{CellValue, CellWrite, OptionId, OptionRef};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityReference};

use super::super::column_types::is_complete_url;
use super::super::{option_label_key, takes_options};
use super::{Place, Planner, RelatedRow};
use crate::domain::catalog::{self, ColumnEntry, StorageTable, entity_type};
use crate::domain::models::{CellChanges, ColumnConfig, DatabaseError};

impl Planner {
    /// One row's cells as stored values; `None` empties a cell.
    pub(super) fn cells(
        &mut self,
        entry: &StorageTable,
        op: usize,
        row: Option<usize>,
        cells: &[CellWrite],
    ) -> Result<CellChanges, DatabaseError> {
        let mut stored = Vec::with_capacity(cells.len());
        for (index, cell) in cells.iter().enumerate() {
            let place = Place {
                op,
                row,
                column: cell.column,
            };
            if cells[..index]
                .iter()
                .any(|earlier| earlier.column == cell.column)
            {
                return Err(place.refuse("the column is written twice"));
            }
            let column = entry
                .columns
                .iter()
                .find(|column| column.column.id == cell.column)
                .ok_or_else(|| place.refuse("no such column in this table"))?;
            let value = self.value(place, column, &cell.value)?;
            if !column.column.nullable
                && !value
                    .as_ref()
                    .is_some_and(crate::domain::models::cell_has_value)
            {
                return Err(place.refuse(format!("\"{}\" requires a value", column.name())));
            }
            stored.push((column.definition.definition.id, value));
        }
        Ok(stored)
    }

    /// A value as the properties system stores it in `column`, checked to
    /// fit the column's type the way a property value is.
    pub(super) fn value(
        &mut self,
        place: Place,
        column: &ColumnEntry,
        value: &CellValue,
    ) -> Result<Option<PropertyValue>, DatabaseError> {
        let data_type = column.definition.definition.data_type;
        let misfit = || {
            place.refuse(format!(
                "\"{}\" is a {} column; {} does not fit it",
                column.name(),
                column_kind_name(column),
                value_kind_name(value)
            ))
        };
        let single = |values: usize| {
            if values > 1 && !column.is_multi() {
                Err(place.refuse(format!(
                    "\"{}\" holds one value; {values} were given",
                    column.name()
                )))
            } else {
                Ok(())
            }
        };
        match value {
            CellValue::Clear => Ok(None),
            CellValue::Text(text) if data_type == DataType::String => {
                Ok(Some(PropertyValue::Str(text.clone())))
            }
            CellValue::Number(number) if data_type == DataType::Number => {
                if !number.is_finite() {
                    return Err(place.refuse("a number must be finite"));
                }
                Ok(Some(PropertyValue::Num(*number)))
            }
            CellValue::Boolean(checked) if data_type == DataType::Boolean => {
                Ok(Some(PropertyValue::Bool(*checked)))
            }
            CellValue::Date(date) if data_type == DataType::Date => {
                Ok(Some(PropertyValue::Date(*date)))
            }
            CellValue::Link(urls) if data_type == DataType::Link => {
                single(urls.len())?;
                if let Some(bad) = urls.iter().find(|url| !is_complete_url(url)) {
                    return Err(
                        place.refuse(format!("`{bad}` is not a complete http or https URL"))
                    );
                }
                Ok((!urls.is_empty()).then(|| PropertyValue::Link(urls.clone())))
            }
            CellValue::Options(options) if takes_options(data_type) => {
                single(options.len())?;
                let mut ids: Vec<OptionId> = Vec::with_capacity(options.len());
                for option in options {
                    let id = self.option(place, column, option)?;
                    if !ids.contains(&id) {
                        ids.push(id);
                    }
                }
                Ok((!ids.is_empty()).then(|| {
                    PropertyValue::SelectOption(ids.into_iter().map(OptionId::into_uuid).collect())
                }))
            }
            CellValue::Entities(references)
                if data_type == DataType::Entity && !column.is_relation() =>
            {
                single(references.len())?;
                let expected = column.definition.definition.specific_entity_type;
                let references = references
                    .iter()
                    .map(|reference| {
                        let stored = entity_type(reference.entity_type);
                        if Some(stored) != expected {
                            return Err(place.refuse(format!(
                                "\"{}\" points at {}; a {stored} reference does not fit it",
                                column.name(),
                                expected
                                    .map_or_else(|| "nothing".to_string(), |kind| kind.to_string())
                            )));
                        }
                        if reference.entity_id.trim().is_empty() {
                            return Err(place.refuse("an entity id must not be empty"));
                        }
                        Ok(EntityReference {
                            entity_id: reference.entity_id.clone(),
                            entity_type: stored,
                            specific_message_id: None,
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok((!references.is_empty()).then_some(PropertyValue::EntityRef(references)))
            }
            CellValue::Rows(rows) => {
                let Some(ColumnConfig::Link {
                    table_id: target, ..
                }) = column.column.config
                else {
                    return Err(misfit());
                };
                let mut references = Vec::with_capacity(rows.len());
                for row in rows {
                    self.related.push(RelatedRow {
                        table: target,
                        row: *row,
                        op: place.op,
                        row_index: place.row,
                        column: place.column,
                    });
                    references.push(EntityReference {
                        entity_id: row.to_string(),
                        entity_type: models_properties::EntityType::DatabaseRow,
                        specific_message_id: None,
                    });
                }
                Ok((!references.is_empty()).then_some(PropertyValue::EntityRef(references)))
            }
            _ => Err(misfit()),
        }
    }

    /// The id of the option a reference names: one the column has, as the
    /// ops so far leave it. An unknown label is refused; options are only
    /// created by an op that adds them.
    fn option(
        &mut self,
        place: Place,
        column: &ColumnEntry,
        option: &OptionRef,
    ) -> Result<OptionId, DatabaseError> {
        let definition = &column.definition;
        let data_type = definition.definition.data_type;
        let label = match option {
            OptionRef::Id(id) => {
                return if self
                    .labels_of(definition)
                    .iter()
                    .any(|(option, _)| option == id)
                {
                    Ok(*id)
                } else {
                    Err(place.refuse(format!("no option {id} on \"{}\"", column.name())))
                };
            }
            OptionRef::Label(label) => label,
        };
        let key = option_label_key(data_type, label);
        self.labels_of(definition)
            .iter()
            .find(|(_, existing)| option_label_key(data_type, existing) == key)
            .map(|(id, _)| *id)
            .ok_or_else(|| {
                place.refuse(format!(
                    "`{label}` is not an option of \"{}\"",
                    column.name()
                ))
            })
    }
}

impl Planner {
    /// The options of a definition as the ops planned so far leave them.
    pub(super) fn labels_of(
        &mut self,
        definition: &PropertyDefinitionWithOptions,
    ) -> &mut Vec<(OptionId, String)> {
        self.labels
            .entry(definition.definition.id)
            .or_insert_with(|| catalog::option_labels(definition))
    }
}

pub(super) fn column_kind_name(column: &ColumnEntry) -> &'static str {
    match column.definition.definition.data_type {
        DataType::String => "text",
        DataType::Number => "number",
        DataType::Boolean => "checkbox",
        DataType::Date => "date",
        DataType::Link => "link",
        DataType::SelectString => "select",
        DataType::SelectNumber => "numeric select",
        DataType::Tag => "tag",
        DataType::Entity if column.is_relation() => "relation",
        DataType::Entity => "reference",
    }
}

fn value_kind_name(value: &CellValue) -> &'static str {
    match value {
        CellValue::Text(_) => "text",
        CellValue::Number(_) => "a number",
        CellValue::Boolean(_) => "true or false",
        CellValue::Date(_) => "a date",
        CellValue::Link(_) => "a link",
        CellValue::Options(_) => "an option",
        CellValue::Entities(_) => "a reference",
        CellValue::Rows(_) => "a row",
        CellValue::Clear => "nothing",
    }
}
