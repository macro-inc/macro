//! Translating SQLite changeset rows back into typed domain commands.
//!
//! SQLite already enforced types, options, and keys through the compiled
//! schema; this layer handles the *representational* gap — display strings
//! back to option ids, ISO text back to dates, JSON arrays back to
//! multi-values — and refuses anything it cannot express.

#[cfg(test)]
mod test;

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use models_properties::api::requests::SetPropertyValue;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::shared::{DataType, EntityReference};
use uuid::Uuid;

use crate::domain::catalog::{
    ColumnEntry, JunctionKind, LINKED_ID, ROW_ID, TableEntry, option_display,
};
use crate::domain::models::{QueryError, RawOp, RawRowChange, RowChange, SqlValue};

/// Which catalog object a SQL table name resolves to.
enum Target<'a> {
    Table(&'a TableEntry),
    Junction {
        column_id: crate::domain::models::ColumnId,
        kind: JunctionKind,
    },
}

fn resolve<'a>(entries: &'a [TableEntry], sql_name: &str) -> Option<Target<'a>> {
    for entry in entries {
        if crate::domain::catalog::entry_answers_to(entry, sql_name) {
            return Some(Target::Table(entry));
        }
        for junction in &entry.junctions {
            if crate::domain::catalog::junction_answers_to(junction, sql_name) {
                return Some(Target::Junction {
                    column_id: junction.column_id,
                    kind: junction.kind,
                });
            }
        }
    }
    None
}

fn untranslatable(msg: impl Into<String>) -> QueryError {
    QueryError::UntranslatableChange(msg.into())
}

/// Prefix of the placeholder ids SQLite assigns to inserted rows; the server
/// mints the real id when applying the insert.
pub const NEW_ROW_PREFIX: &str = "new:";

fn parse_row_id(value: &SqlValue, what: &str) -> Result<Uuid, QueryError> {
    match value {
        SqlValue::Text(t) if t.starts_with(NEW_ROW_PREFIX) => Err(untranslatable(format!(
            "{what} refers to a row inserted in the same statement; insert first, then reference its id in a second statement"
        ))),
        SqlValue::Text(t) => {
            Uuid::parse_str(t).map_err(|_| untranslatable(format!("{what} `{t}` is not a row id")))
        }
        other => Err(untranslatable(format!(
            "{what} must be a row id, got {other:?}"
        ))),
    }
}

fn option_id(
    definition: &PropertyDefinitionWithOptions,
    display: &str,
) -> Result<Uuid, QueryError> {
    definition
        .property_options
        .iter()
        .find(|o| option_display(&o.value) == display)
        .map(|o| o.id)
        .ok_or_else(|| {
            untranslatable(format!(
                "`{display}` is not an option of {}",
                definition.definition.display_name
            ))
        })
}

fn text_of(value: &SqlValue, column: &str) -> Result<String, QueryError> {
    match value {
        SqlValue::Text(t) => Ok(t.clone()),
        SqlValue::Integer(i) => Ok(i.to_string()),
        SqlValue::Real(f) => Ok(crate::domain::catalog::format_number(*f)),
        SqlValue::Null => Err(untranslatable(format!("{column}: unexpected NULL"))),
    }
}

fn json_texts(value: &SqlValue, column: &str) -> Result<Vec<String>, QueryError> {
    let raw = text_of(value, column)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|_| {
        untranslatable(format!(
            "{column} is multi-valued: write a JSON array of values, e.g. '[\"a\",\"b\"]'"
        ))
    })?;
    match parsed {
        serde_json::Value::Array(items) => items
            .into_iter()
            .map(|item| match item {
                serde_json::Value::String(s) => Ok(s),
                serde_json::Value::Number(n) => Ok(n.to_string()),
                other => Err(untranslatable(format!(
                    "{column}: unsupported array element {other}"
                ))),
            })
            .collect(),
        _ => Err(untranslatable(format!(
            "{column} is multi-valued: write a JSON array"
        ))),
    }
}

fn parse_date(text: &str, column: &str) -> Result<DateTime<Utc>, QueryError> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        return Ok(dt.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        return Ok(date.and_hms_opt(0, 0, 0).expect("midnight").and_utc());
    }
    Err(untranslatable(format!(
        "{column}: `{text}` is not a date (use YYYY-MM-DD or RFC 3339)"
    )))
}

/// Convert one SQL cell value into a typed property write for `column`.
/// `None` means "clear the cell".
pub fn cell_write(
    column: &ColumnEntry,
    value: &SqlValue,
) -> Result<Option<SetPropertyValue>, QueryError> {
    if matches!(value, SqlValue::Null) {
        return Ok(None);
    }
    let def = &column.definition.definition;
    let name = &column.sql_name;
    let write = match (def.data_type, def.is_multi_select) {
        (DataType::Boolean, false) => match value {
            SqlValue::Integer(i) => SetPropertyValue::Boolean { value: *i != 0 },
            other => {
                return Err(untranslatable(format!(
                    "{name}: expected 0/1, got {other:?}"
                )));
            }
        },
        (DataType::Number, false) => match value {
            SqlValue::Integer(i) => SetPropertyValue::Number { value: *i as f64 },
            SqlValue::Real(f) => SetPropertyValue::Number { value: *f },
            other => {
                return Err(untranslatable(format!(
                    "{name}: expected a number, got {other:?}"
                )));
            }
        },
        (DataType::String | DataType::Date | DataType::Boolean | DataType::Number, true) => {
            return Err(untranslatable(format!(
                "{name}: multi-valued {:?} columns cannot be written from SQL",
                def.data_type
            )));
        }
        (DataType::String, false) => SetPropertyValue::String {
            value: text_of(value, name)?,
        },
        (DataType::Date, false) => SetPropertyValue::Date {
            value: parse_date(&text_of(value, name)?, name)?,
        },
        (DataType::Link, false) => SetPropertyValue::Link {
            url: text_of(value, name)?,
        },
        (DataType::Link, true) => SetPropertyValue::MultiLink {
            urls: json_texts(value, name)?,
        },
        (DataType::SelectString | DataType::SelectNumber | DataType::Tag, false) => {
            SetPropertyValue::SelectOption {
                option_id: option_id(&column.definition, &text_of(value, name)?)?,
            }
        }
        (DataType::SelectString | DataType::SelectNumber | DataType::Tag, true) => {
            SetPropertyValue::MultiSelectOption {
                option_ids: json_texts(value, name)?
                    .iter()
                    .map(|d| option_id(&column.definition, d))
                    .collect::<Result<Vec<_>, _>>()?,
            }
        }
        (DataType::Entity, multi) => {
            let entity_type = def.specific_entity_type.ok_or_else(|| {
                untranslatable(format!(
                    "{name}: entity column has no entity type configured"
                ))
            })?;
            if multi {
                SetPropertyValue::MultiEntityReference {
                    references: json_texts(value, name)?
                        .into_iter()
                        .map(|id| EntityReference::new(id, entity_type))
                        .collect(),
                }
            } else {
                SetPropertyValue::EntityReference {
                    reference: EntityReference::new(text_of(value, name)?, entity_type),
                }
            }
        }
    };
    write
        .validate_compatibility(&def.data_type, def.is_multi_select)
        .map_err(|e| untranslatable(format!("{name}: {e:?}")))?;
    Ok(Some(write))
}

fn cells_for<'a>(
    table: &TableEntry,
    values: impl Iterator<Item = &'a (String, SqlValue)>,
    allow_clear: bool,
) -> Result<HashMap<Uuid, Option<SetPropertyValue>>, QueryError> {
    let mut cells = HashMap::new();
    for (name, value) in values {
        if name == ROW_ID {
            continue;
        }
        let column = table
            .columns
            .iter()
            .find(|c| &c.sql_name == name)
            .ok_or_else(|| untranslatable(format!("unknown column {name}")))?;
        // An inserted row reports every column; an unset one is not a write.
        if matches!(value, SqlValue::Null) && !allow_clear {
            continue;
        }
        if !column.writable {
            return Err(QueryError::ReadOnly(format!(
                "column {}.{name} is read-only",
                table.schema.sql_name
            )));
        }
        let write = cell_write(column, value)?;
        if write.is_none() && !allow_clear {
            continue;
        }
        cells.insert(column.definition.definition.id, write);
    }
    Ok(cells)
}

fn pk_value<'a>(change: &'a RawRowChange, column: &str) -> Result<&'a SqlValue, QueryError> {
    change
        .primary_key
        .iter()
        .find(|(name, _)| name == column)
        .map(|(_, v)| v)
        .ok_or_else(|| untranslatable(format!("change on {} lacks {column}", change.table)))
}

/// Translate raw changeset rows into typed [`RowChange`]s against the
/// catalog entries the statement was executed over.
pub fn translate(
    changes: Vec<RawRowChange>,
    entries: &[TableEntry],
) -> Result<Vec<RowChange>, QueryError> {
    changes
        .into_iter()
        .map(|change| {
            let target = resolve(entries, &change.table).ok_or_else(|| {
                untranslatable(format!("change on unknown table {}", change.table))
            })?;
            match target {
                Target::Table(table) => {
                    let table_id = table.table.id;
                    match change.op {
                        RawOp::Insert => {
                            if let Some((_, SqlValue::Text(id))) =
                                change.new_values.iter().find(|(name, _)| name == ROW_ID)
                                && !id.starts_with(NEW_ROW_PREFIX)
                            {
                                return Err(untranslatable(
                                    "row_id is assigned by the server; omit it from INSERT",
                                ));
                            }
                            Ok(RowChange::Insert {
                                table_id,
                                cells: cells_for(table, change.new_values.iter(), false)?
                                    .into_iter()
                                    .filter_map(|(k, v)| v.map(|v| (k, v)))
                                    .collect(),
                            })
                        }
                        RawOp::Update => Ok(RowChange::Update {
                            table_id,
                            row_id: parse_row_id(pk_value(&change, ROW_ID)?, "row_id")?,
                            cells: cells_for(table, change.new_values.iter(), true)?,
                        }),
                        RawOp::Delete => Ok(RowChange::Delete {
                            table_id,
                            row_id: parse_row_id(pk_value(&change, ROW_ID)?, "row_id")?,
                        }),
                    }
                }
                Target::Junction { column_id, kind } => {
                    if kind != JunctionKind::Link {
                        return Err(QueryError::ReadOnly(format!(
                            "{} mirrors a multi-valued column; write the JSON array column instead",
                            change.table
                        )));
                    }
                    let source_row_id = parse_row_id(pk_value(&change, ROW_ID)?, ROW_ID)?;
                    let target_row_id = parse_row_id(pk_value(&change, LINKED_ID)?, LINKED_ID)?;
                    match change.op {
                        RawOp::Insert => Ok(RowChange::Link {
                            column_id,
                            source_row_id,
                            target_row_id,
                        }),
                        RawOp::Delete => Ok(RowChange::Unlink {
                            column_id,
                            source_row_id,
                            target_row_id,
                        }),
                        RawOp::Update => Err(untranslatable(
                            "links cannot be updated in place; delete and insert the edge",
                        )),
                    }
                }
            }
        })
        .collect()
}
