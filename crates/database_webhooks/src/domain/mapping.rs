//! A webhook payload as rows of a table: a JSON object per row, its keys
//! naming columns, its values loosely typed as JSON can carry them. The
//! mapping only shapes values into cells; the databases service still checks
//! every cell against its column, as it does for any insert.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveDate, Utc};
use models_databases::{
    CellValue, CellWrite, ColumnId, ColumnKind, EntityKind, EntityRef, OptionRef, RowId,
};
use serde_json::{Map, Value};

use crate::domain::models::PayloadProblem;

/// The most rows one call may insert.
pub const MAX_ROWS: usize = 100;

/// A column a payload key may name.
#[derive(Debug, Clone, PartialEq)]
pub struct WebhookColumn {
    /// The column placement.
    pub id: ColumnId,
    /// Its name, matched without regard to case or surrounding spaces.
    pub name: String,
    /// Its type; `None` for a type no op can write.
    pub kind: Option<ColumnKind>,
}

/// The rows a payload inserts: an object is one row, an array of objects is
/// a row each. A key names a column by its name or its id; `null` leaves the
/// cell empty. Every problem is reported, not just the first.
pub fn rows_from_payload(
    columns: &[WebhookColumn],
    payload: &Value,
) -> Result<Vec<Vec<CellWrite>>, Vec<PayloadProblem>> {
    let objects: Vec<(Option<usize>, &Value)> = match payload {
        Value::Object(_) => vec![(None, payload)],
        Value::Array(rows) if rows.is_empty() => {
            return Err(vec![problem(None, None, "expected at least one row")]);
        }
        Value::Array(rows) if rows.len() > MAX_ROWS => {
            return Err(vec![problem(
                None,
                None,
                &format!("at most {MAX_ROWS} rows per call"),
            )]);
        }
        Value::Array(rows) => rows
            .iter()
            .enumerate()
            .map(|(i, row)| (Some(i), row))
            .collect(),
        _ => {
            return Err(vec![problem(
                None,
                None,
                "expected a JSON object, or an array of objects, one per row",
            )]);
        }
    };

    let mut rows = Vec::with_capacity(objects.len());
    let mut problems = Vec::new();
    for (index, object) in objects {
        let Value::Object(object) = object else {
            problems.push(problem(index, None, "expected a JSON object"));
            continue;
        };
        match row(columns, object) {
            Ok(cells) => rows.push(cells),
            Err(found) => {
                problems.extend(found.into_iter().map(|(field, message)| PayloadProblem {
                    row: index,
                    field: Some(field),
                    message,
                }))
            }
        }
    }
    if problems.is_empty() {
        Ok(rows)
    } else {
        Err(problems)
    }
}

fn problem(row: Option<usize>, field: Option<String>, message: &str) -> PayloadProblem {
    PayloadProblem {
        row,
        field,
        message: message.to_string(),
    }
}

/// One object's cells, in the order its keys came; or each key's problem.
fn row(
    columns: &[WebhookColumn],
    object: &Map<String, Value>,
) -> Result<Vec<CellWrite>, Vec<(String, String)>> {
    let mut cells = Vec::new();
    let mut named: Vec<ColumnId> = Vec::new();
    let mut problems = Vec::new();
    for (key, value) in object {
        let column = match column_for(columns, key) {
            Ok(column) => column,
            Err(message) => {
                problems.push((key.clone(), message));
                continue;
            }
        };
        if named.contains(&column.id) {
            problems.push((key.clone(), format!("\"{}\" is named twice", column.name)));
            continue;
        }
        named.push(column.id);
        match cell(column, value) {
            Ok(Some(value)) => cells.push(CellWrite {
                column: column.id,
                value,
            }),
            Ok(None) => {}
            Err(message) => problems.push((key.clone(), message.to_string())),
        }
    }
    if problems.is_empty() {
        Ok(cells)
    } else {
        Err(problems)
    }
}

/// The column a key names: the one with that id, else the one with that
/// name, ignoring case and surrounding spaces.
fn column_for<'columns>(
    columns: &'columns [WebhookColumn],
    key: &str,
) -> Result<&'columns WebhookColumn, String> {
    if let Some(column) = columns
        .iter()
        .find(|column| column.id.as_uuid().to_string() == key.trim())
    {
        return Ok(column);
    }
    let wanted = name_key(key);
    let mut matches = columns
        .iter()
        .filter(|column| name_key(&column.name) == wanted);
    match (matches.next(), matches.next()) {
        (Some(column), None) => Ok(column),
        (Some(_), Some(_)) => Err(format!(
            "several columns are named \"{}\"; name it by its column id",
            key.trim()
        )),
        (None, _) => Err(format!("no column is named \"{}\"", key.trim())),
    }
}

fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// A value as a cell of its column; `None` leaves the cell empty.
fn cell(column: &WebhookColumn, value: &Value) -> Result<Option<CellValue>, &'static str> {
    if value.is_null() || value.as_array().is_some_and(Vec::is_empty) {
        return Ok(None);
    }
    let Some(kind) = column.kind else {
        return Err("this column's type cannot be written");
    };
    let value = match kind {
        ColumnKind::Text => CellValue::Text(text(value).ok_or("expected text")?),
        ColumnKind::Number => CellValue::Number(number(value).ok_or("expected a number")?),
        ColumnKind::Boolean => CellValue::Boolean(boolean(value).ok_or("expected true or false")?),
        ColumnKind::Date => CellValue::Date(
            date(value)
                .ok_or("expected an ISO 8601 date, like 2026-10-09 or 2026-10-09T15:00:00Z")?,
        ),
        ColumnKind::Link => CellValue::Link(each(value, string).ok_or("expected URLs")?),
        ColumnKind::Select { .. } | ColumnKind::SelectNumber { .. } | ColumnKind::Tag => {
            CellValue::Options(
                each(value, |value| text(value).map(OptionRef::Label))
                    .ok_or("expected option labels")?,
            )
        }
        ColumnKind::Entity { target, .. } => CellValue::Entities(
            each(value, |value| entity(target, value)).ok_or("expected entity ids")?,
        ),
        ColumnKind::Relation { .. } => CellValue::Rows(
            each(value, |value| {
                string(value)?.trim().parse().ok().map(RowId::from_uuid)
            })
            .ok_or("expected row ids")?,
        ),
    };
    Ok(Some(value))
}

/// One value, or each of an array's.
fn each<Item>(value: &Value, item: impl Fn(&Value) -> Option<Item>) -> Option<Vec<Item>> {
    match value {
        Value::Array(values) => values.iter().map(item).collect(),
        value => item(value).map(|item| vec![item]),
    }
}

fn string(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

/// A scalar as text: a string as it is, a number or boolean as JSON writes it.
fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        _ => None,
    }
}

fn number(value: &Value) -> Option<f64> {
    let number = match value {
        Value::Number(number) => number.as_f64()?,
        Value::String(text) => text.trim().parse().ok()?,
        _ => return None,
    };
    number.is_finite().then_some(number)
}

fn boolean(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(boolean) => Some(*boolean),
        Value::String(text) => match text.trim().to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// A date-time with an offset, or a bare date as its midnight in UTC.
fn date(value: &Value) -> Option<DateTime<Utc>> {
    let text = value.as_str()?.trim();
    if let Ok(at) = DateTime::parse_from_rfc3339(text) {
        return Some(at.with_timezone(&Utc));
    }
    let day = NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?;
    Some(day.and_hms_opt(0, 0, 0)?.and_utc())
}

fn entity(target: EntityKind, value: &Value) -> Option<EntityRef> {
    Some(EntityRef {
        entity_type: target,
        entity_id: string(value)?.trim().to_string(),
    })
}
