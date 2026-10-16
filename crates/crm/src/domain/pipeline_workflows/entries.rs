//! Entries as read back: the record each tracks, its fields by name, and the
//! counts and totals over a set of them.

use std::collections::{BTreeMap, HashMap};

use databases::domain::storage::StorageRow;
use models_databases::ColumnId;
use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::{
    FieldKind, FieldValue, OptionCounts, PipelineEntryView, PipelineField, PipelineOverview,
    PipelineRecord, fields,
};

/// The record a primary cell references.
pub(super) fn record_id(cell: Option<&PropertyValue>) -> Option<Uuid> {
    match cell {
        Some(PropertyValue::EntityRef(references)) => references
            .first()
            .and_then(|reference| reference.entity_id.parse().ok()),
        _ => None,
    }
}

/// The filled-in fields of `cells`, other than the record, in column order.
pub(super) fn field_values(
    fields: &[PipelineField],
    cells: &HashMap<ColumnId, PropertyValue>,
) -> Vec<(String, FieldValue)> {
    fields
        .iter()
        .filter(|field| !field.is_record())
        .filter_map(|field| {
            let value = fields::field_value(field, cells.get(&field.id)?)?;
            Some((field.name.clone(), value))
        })
        .collect()
}

pub(super) fn entry_view(
    overview: &PipelineOverview,
    row: &StorageRow,
    records: &HashMap<Uuid, PipelineRecord>,
) -> PipelineEntryView {
    let record = record_id(row.cells.get(&overview.record_field().id))
        .map(|id| {
            records
                .get(&id)
                .cloned()
                .unwrap_or_else(|| PipelineRecord::unnamed(id))
        })
        .unwrap_or_else(|| PipelineRecord::unnamed(Uuid::nil()));
    PipelineEntryView {
        entry_id: row.row_id,
        record,
        fields: field_values(&overview.fields, &row.cells),
    }
}

pub(super) fn value_of<'a>(entry: &'a PipelineEntryView, field: &str) -> Option<&'a FieldValue> {
    entry
        .fields
        .iter()
        .find(|(name, _)| name == field)
        .map(|(_, value)| value)
}

/// Matched entries per option of every single-select field.
pub(super) fn option_counts(
    overview: &PipelineOverview,
    entries: &[PipelineEntryView],
) -> Vec<OptionCounts> {
    overview
        .fields
        .iter()
        .filter(|field| field.kind == FieldKind::Select && !field.multiple)
        .map(|field| {
            let mut counts: BTreeMap<usize, usize> = BTreeMap::new();
            let mut empty = 0;
            for entry in entries {
                match value_of(entry, &field.name) {
                    Some(FieldValue::Labels(labels)) => {
                        if let Some(position) = labels
                            .first()
                            .and_then(|label| field.options.iter().position(|(_, l)| l == label))
                        {
                            *counts.entry(position).or_default() += 1;
                        }
                    }
                    _ => empty += 1,
                }
            }
            OptionCounts {
                field: field.name.clone(),
                counts: field
                    .options
                    .iter()
                    .enumerate()
                    .map(|(position, (_, label))| {
                        (label.clone(), counts.get(&position).copied().unwrap_or(0))
                    })
                    .collect(),
                empty,
            }
        })
        .collect()
}

/// The sum of every number field over `entries`.
pub(super) fn totals(
    overview: &PipelineOverview,
    entries: &[PipelineEntryView],
) -> Vec<(String, f64)> {
    overview
        .fields
        .iter()
        .filter(|field| field.kind == FieldKind::Number)
        .map(|field| {
            let sum = entries
                .iter()
                .filter_map(|entry| match value_of(entry, &field.name) {
                    Some(FieldValue::Number(number)) => Some(*number),
                    _ => None,
                })
                .sum();
            (field.name.clone(), sum)
        })
        .collect()
}
