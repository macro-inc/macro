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
use crate::domain::pipelines::Pipeline;

/// Resolve denominations by stable field identities, including renamed amounts.
pub(super) fn currencies(
    pipeline: &Pipeline,
    fields: &[PipelineField],
    cells: &HashMap<ColumnId, PropertyValue>,
) -> BTreeMap<String, String> {
    pipeline
        .commercial_fields
        .money
        .iter()
        .filter_map(|pair| {
            let amount = fields.iter().find(|field| field.id == pair.amount)?;
            let currency = fields.iter().find(|field| field.id == pair.currency)?;
            let code = match cells
                .get(&currency.id)
                .and_then(|value| fields::field_value(currency, value))
            {
                Some(FieldValue::Labels(labels)) => labels.into_iter().next(),
                _ => None,
            }
            .unwrap_or_else(|| "USD".into());
            Some((amount.name.clone(), code))
        })
        .collect()
}

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
        currencies: currencies(&overview.pipeline.pipeline, &overview.fields, &row.cells),
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

/// Sum monetary values only within the same currency.
pub(super) fn totals(
    overview: &PipelineOverview,
    entries: &[PipelineEntryView],
) -> Vec<super::models::FieldTotal> {
    overview
        .fields
        .iter()
        .filter(|field| field.kind == FieldKind::Number)
        .flat_map(|field| {
            let currency_field = overview
                .pipeline
                .pipeline
                .commercial_fields
                .money
                .iter()
                .find(|pair| pair.amount == field.id)
                .and_then(|pair| {
                    overview
                        .fields
                        .iter()
                        .find(|candidate| candidate.id == pair.currency)
                });
            let mut sums = BTreeMap::<Option<String>, f64>::new();
            if currency_field.is_none() {
                sums.insert(None, 0.0);
            }
            for entry in entries {
                let Some(FieldValue::Number(value)) = value_of(entry, &field.name) else {
                    continue;
                };
                let currency =
                    currency_field.map(|currency| match value_of(entry, &currency.name) {
                        Some(FieldValue::Labels(labels)) => {
                            labels.first().cloned().unwrap_or_else(|| "USD".into())
                        }
                        _ => "USD".into(),
                    });
                *sums.entry(currency).or_default() += value;
            }
            sums.into_iter()
                .map(|(currency, sum)| super::models::FieldTotal {
                    field: field.name.clone(),
                    currency,
                    sum,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}
