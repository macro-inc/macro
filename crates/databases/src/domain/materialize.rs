//! Projecting rows into the scratch SQLite: cells become storage-class
//! values, option ids become display strings, multi-valued cells become JSON
//! arrays plus junction rows. Pure functions over catalog entries.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_value::PropertyValue;

use crate::domain::catalog::option_labels;
use crate::domain::catalog::{ColumnEntry, JunctionEntry, JunctionKind, TableEntry};
use crate::domain::models::{ColumnConfig, ColumnId, MaterializedTable, Row, RowId, SqlValue};

fn option_label(definition: &PropertyDefinitionWithOptions, option_id: uuid::Uuid) -> String {
    option_labels(definition)
        .into_iter()
        .find(|(id, _)| *id == option_id)
        .map(|(_, label)| label)
        // An option deleted after being set: keep the id visible rather than
        // silently blanking the cell.
        .unwrap_or_else(|| option_id.to_string())
}

/// The scalar elements of a cell, in display form (one for single-valued
/// cells, any number for multi-valued ones).
pub fn cell_elements(
    value: &PropertyValue,
    definition: &PropertyDefinitionWithOptions,
) -> Vec<SqlValue> {
    match value {
        PropertyValue::Bool(b) => vec![SqlValue::Integer(i64::from(*b))],
        PropertyValue::Num(n) => vec![SqlValue::Real(*n)],
        PropertyValue::Str(s) => vec![SqlValue::Text(s.clone())],
        PropertyValue::Date(d) => vec![SqlValue::Text(d.to_rfc3339())],
        PropertyValue::SelectOption(ids) => ids
            .iter()
            .map(|id| SqlValue::Text(option_label(definition, *id)))
            .collect(),
        PropertyValue::EntityRef(refs) => refs
            .iter()
            .map(|r| SqlValue::Text(r.entity_id.clone()))
            .collect(),
        PropertyValue::Link(urls) => urls.iter().map(|u| SqlValue::Text(u.clone())).collect(),
    }
}

fn json_array(elements: &[SqlValue]) -> SqlValue {
    let items: Vec<serde_json::Value> = elements
        .iter()
        .map(|e| match e {
            SqlValue::Null => serde_json::Value::Null,
            SqlValue::Integer(i) => serde_json::Value::from(*i),
            SqlValue::Real(f) => serde_json::Value::from(*f),
            SqlValue::Text(t) => serde_json::Value::from(t.as_str()),
        })
        .collect();
    SqlValue::Text(serde_json::Value::Array(items).to_string())
}

/// One cell as a single SQLite value: scalars directly, multi-valued cells
/// as a JSON array of display values, link columns as a JSON array of linked
/// row ids.
pub fn cell_value(column: &ColumnEntry, row: &Row, links: Option<&Vec<RowId>>) -> SqlValue {
    if let Some(linked) = links {
        return json_array(
            &linked
                .iter()
                .map(|id| SqlValue::Text(id.to_string()))
                .collect::<Vec<_>>(),
        );
    }
    let Some(value) = row.cells.get(&column.definition.definition.id) else {
        return SqlValue::Null;
    };
    let elements = cell_elements(value, &column.definition);
    if column.definition.definition.is_multi_select {
        json_array(&elements)
    } else {
        elements.into_iter().next().unwrap_or(SqlValue::Null)
    }
}

/// Materialize a user table's main relation.
///
/// `links` maps link column ids to their edges (`source_row → targets`).
pub fn user_table(
    entry: &TableEntry,
    rows: &[Row],
    links: &HashMap<ColumnId, HashMap<RowId, Vec<RowId>>>,
) -> MaterializedTable {
    let rows = rows
        .iter()
        .map(|row| {
            let mut values = Vec::with_capacity(entry.schema.columns.len());
            values.push(SqlValue::Text(row.id.to_string()));
            for column in &entry.columns {
                let is_link = matches!(column.column.config, Some(ColumnConfig::Link { .. }));
                let row_links = is_link.then(|| {
                    links
                        .get(&column.column.id)
                        .and_then(|by_row| by_row.get(&row.id))
                        .cloned()
                        .unwrap_or_default()
                });
                values.push(cell_value(column, row, row_links.as_ref()));
            }
            values
        })
        .collect();
    MaterializedTable {
        schema: entry.schema.clone(),
        rows,
    }
}

/// Materialize one junction view of a user table.
pub fn junction(
    entry: &TableEntry,
    junction: &JunctionEntry,
    rows: &[Row],
    links: &HashMap<ColumnId, HashMap<RowId, Vec<RowId>>>,
) -> MaterializedTable {
    let pairs: Vec<Vec<SqlValue>> = match junction.kind {
        JunctionKind::Link => links
            .get(&junction.column_id)
            .into_iter()
            .flat_map(|by_row| by_row.iter())
            .flat_map(|(source, targets)| {
                targets.iter().map(move |target| {
                    vec![
                        SqlValue::Text(source.to_string()),
                        SqlValue::Text(target.to_string()),
                    ]
                })
            })
            .collect(),
        JunctionKind::MultiValue => {
            let Some(column) = entry
                .columns
                .iter()
                .find(|c| c.column.id == junction.column_id)
            else {
                return MaterializedTable {
                    schema: junction.schema.clone(),
                    rows: vec![],
                };
            };
            rows.iter()
                .flat_map(|row| {
                    let mut elements = row
                        .cells
                        .get(&column.definition.definition.id)
                        .map(|v| cell_elements(v, &column.definition))
                        .unwrap_or_default();
                    // `(row_id, linked_id)` is the junction's primary key; a
                    // cell repeating an element must not break the load.
                    let mut seen = Vec::with_capacity(elements.len());
                    elements.retain(|e| {
                        let fresh = !seen.contains(e);
                        if fresh {
                            seen.push(e.clone());
                        }
                        fresh
                    });
                    elements
                        .into_iter()
                        .map(move |element| vec![SqlValue::Text(row.id.to_string()), element])
                })
                .collect()
        }
    };
    MaterializedTable {
        schema: junction.schema.clone(),
        rows: pairs,
    }
}
