//! Keeping a synced table's columns in step with its source: the columns
//! the source wants, the ones someone deleted or retyped, new select
//! options.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use import_notion::domain::macro_cells::MAX_NAME;
use models_databases::{
    ColumnChange, ColumnId, ColumnKind, DatabaseOp, NewColumn, NewOption, OptionId, TableId,
};

use crate::domain::models::{DetachReason, DetachedColumn, SyncField, SyncedColumn};

/// A column of the table as it stands.
#[derive(Debug, Clone, PartialEq)]
pub struct TableColumn {
    /// The column.
    pub id: ColumnId,
    /// Its name.
    pub name: String,
    /// Its type; `None` for one no op can name.
    pub kind: Option<ColumnKind>,
    /// A select's options, by id and label.
    pub options: Vec<(OptionId, String)>,
}

/// A column the source wants for one of its fields.
#[derive(Debug, Clone, PartialEq)]
pub struct WantedColumn {
    /// The field.
    pub field: SyncField,
    /// The id the column is created under, derived from the sync and the
    /// field so a retried create names the same column.
    pub id: ColumnId,
    /// Its name.
    pub name: String,
    /// Its type.
    pub kind: ColumnKind,
    /// A select's options, under ids derived the same way.
    pub options: Vec<NewOption>,
}

/// What a run does to the table's columns before writing rows.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ColumnChanges {
    /// The columns the sync writes once `ops` apply.
    pub columns: Vec<SyncedColumn>,
    /// The columns it stopped writing.
    pub detached: Vec<DetachedColumn>,
    /// Column creations and option additions, in order.
    pub ops: Vec<DatabaseOp>,
    /// For each wanted option, the id of the column's option with its label,
    /// where that differs from the wanted id.
    pub option_ids: HashMap<OptionId, OptionId>,
}

/// Reconcile the table's columns with the ones the source wants. A synced
/// column someone deleted, or whose type no longer fits its field, stops
/// syncing for good; a field never synced before gets a column; a select
/// gains the options it lacks.
pub fn reconcile(
    table: TableId,
    synced: &[SyncedColumn],
    detached: &[DetachedColumn],
    schema: &[TableColumn],
    wanted: &[WantedColumn],
) -> ColumnChanges {
    let by_id: HashMap<ColumnId, &TableColumn> =
        schema.iter().map(|column| (column.id, column)).collect();
    let wanted_by_field: HashMap<&SyncField, &WantedColumn> = wanted
        .iter()
        .map(|column| (&column.field, column))
        .collect();
    let mut taken_names: HashSet<String> = schema
        .iter()
        .map(|column| column.name.to_lowercase())
        .collect();
    let mut changes = ColumnChanges {
        detached: detached.to_vec(),
        ..ColumnChanges::default()
    };

    for synced_column in synced {
        let wanted_column = wanted_by_field.get(&synced_column.field).copied();
        let Some(column) = by_id.get(&synced_column.column) else {
            changes.detached.push(DetachedColumn {
                field: synced_column.field.clone(),
                column: synced_column.column,
                reason: DetachReason::Deleted,
            });
            continue;
        };

        if let Some(wanted_column) = wanted_column {
            if column.kind != Some(wanted_column.kind) {
                changes.detached.push(DetachedColumn {
                    field: synced_column.field.clone(),
                    column: synced_column.column,
                    reason: DetachReason::TypeChanged,
                });
                continue;
            }
            add_missing_options(table, column, wanted_column, &mut changes);
        }
        changes.columns.push(synced_column.clone());
    }

    let handled: HashSet<SyncField> = synced
        .iter()
        .map(|column| column.field.clone())
        .chain(changes.detached.iter().map(|column| column.field.clone()))
        .collect();

    for wanted_column in wanted {
        if handled.contains(&wanted_column.field) {
            continue;
        }

        match by_id.get(&wanted_column.id) {
            Some(column) if column.kind == Some(wanted_column.kind) => {
                add_missing_options(table, column, wanted_column, &mut changes);
            }
            Some(_) => {
                changes.detached.push(DetachedColumn {
                    field: wanted_column.field.clone(),
                    column: wanted_column.id,
                    reason: DetachReason::TypeChanged,
                });
                continue;
            }
            None => {
                let name = unique_name(&wanted_column.name, &taken_names);
                taken_names.insert(name.to_lowercase());
                changes.ops.push(DatabaseOp::Column {
                    table,
                    column: wanted_column.id,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name,
                            kind: wanted_column.kind,
                            options: wanted_column.options.clone(),
                            infer_type: false,
                        },
                        after: None,
                    },
                });
            }
        }
        changes.columns.push(SyncedColumn {
            field: wanted_column.field.clone(),
            column: wanted_column.id,
        });
    }

    changes
}

/// Add the wanted options `column` has neither by id nor by label, and
/// remember which existing option stands in for a wanted one.
fn add_missing_options(
    table: TableId,
    column: &TableColumn,
    wanted: &WantedColumn,
    changes: &mut ColumnChanges,
) {
    let ids: HashSet<OptionId> = column.options.iter().map(|(id, _)| *id).collect();
    let labels: HashMap<String, OptionId> = column
        .options
        .iter()
        .map(|(id, label)| (label.to_lowercase(), *id))
        .collect();
    let mut missing = Vec::new();

    for option in &wanted.options {
        if ids.contains(&option.id) {
            continue;
        }
        match labels.get(&option.label.to_lowercase()) {
            Some(existing) => {
                changes.option_ids.insert(option.id, *existing);
            }
            None => missing.push(option.clone()),
        }
    }

    if !missing.is_empty() {
        changes.ops.push(DatabaseOp::Column {
            table,
            column: column.id,
            change: ColumnChange::AddOptions { options: missing },
        });
    }
}

/// `name`, or `name 2`, `name 3`, ... whichever no column has yet,
/// ignoring case.
pub fn unique_name(name: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(&name.to_lowercase()) {
        return name.to_string();
    }

    let mut index = 2;
    loop {
        // Shorten the name so the suffix still fits the name limit.
        let suffix = format!(" {index}");
        let base: String = name
            .chars()
            .take(MAX_NAME.saturating_sub(suffix.chars().count()))
            .collect();
        let candidate = format!("{base}{suffix}");
        if !taken.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        index += 1;
    }
}
