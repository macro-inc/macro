//! Reads every row of every table of a closed cache file, so two builds can be
//! compared on what they left on disk, not only on what they answer.

use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;
use turso_core::{
    Connection, Database, IO, OpenOptions, PlatformIO, SqliteDialect, Statement, StepResult, Value,
};

/// Table name to its rows, each row as text, sorted.
///
/// With `decoded`, `records.value` is compared as the record it decodes to (with
/// this build's own codec) instead of its bytes, and a `search_documents.source_hash`
/// that is the hash of its record's stored bytes is written as `h:record`. For
/// builds whose record encoding differs on purpose.
pub fn tables(path: &Path, decoded: bool) -> Result<BTreeMap<String, Vec<String>>, String> {
    let io: Arc<dyn IO> = Arc::new(PlatformIO::new().map_err(|error| error.to_string())?);
    let path = path.to_str().ok_or("path is not UTF-8")?;
    let database = Database::open(io, path, OpenOptions::new(Arc::new(SqliteDialect)))
        .map_err(|error| error.to_string())?;
    let connection = database.connect().map_err(|error| error.to_string())?;
    let mut names = Vec::new();
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .map_err(|error| error.to_string())?;
    rows(&mut statement, |values| {
        if let Some(Value::Text(name)) = values.first() {
            names.push(name.as_str().to_owned());
        }
    })?;
    let mut out = BTreeMap::new();
    for name in names {
        let name = name.trim_matches('"').to_owned();
        let mut table = Vec::new();
        // A JSON array, so no value can run into the next one.
        rows(&mut select(&connection, &name, "*")?, |values| {
            table.push(row_text(values.iter().map(render)));
        })?;
        out.insert(name, table);
    }
    if decoded {
        decode_records(&connection, &mut out)?;
    }
    for table in out.values_mut() {
        table.sort();
    }
    connection.close().map_err(|error| error.to_string())?;
    Ok(out)
}

/// Rewrites `records` and `search_documents` as [`tables`] describes for `decoded`.
fn decode_records(
    connection: &Arc<Connection>,
    out: &mut BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    if !out.contains_key("records") {
        return Ok(());
    }
    let mut hashes = HashMap::new();
    let mut records = Vec::new();
    rows(
        &mut select(connection, "records", "__typename, id, value")?,
        |values| {
            let value = match &values[2] {
                Value::Blob(bytes) => {
                    let hash: String = Sha256::digest(bytes)[..8]
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect();
                    hashes.insert((render(&values[0]), render(&values[1])), hash);
                    match cache_core::codec::decode_record(bytes) {
                        Ok(record) => match serde_json::to_string(&record) {
                            Ok(json) => format!("r:{json}"),
                            Err(error) => format!("r!{error}"),
                        },
                        Err(error) => format!("r!{error}"),
                    }
                }
                other => render(other),
            };
            records.push(row_text(values[..2].iter().map(render).chain([value])));
        },
    )?;
    out.insert("records".into(), records);
    if !out.contains_key("search_documents") {
        return Ok(());
    }
    let mut documents = Vec::new();
    rows(
        &mut select(
            connection,
            "search_documents",
            "profile, __typename, id, bucket, search_text, timestamp_ms, source_hash",
        )?,
        |values| {
            let key = (render(&values[1]), render(&values[2]));
            let ours = matches!((&values[6], hashes.get(&key)),
                (Value::Text(text), Some(hash)) if text.as_str() == hash);
            documents.push(row_text(values.iter().enumerate().map(
                |(index, value)| match index == 6 && ours {
                    true => "h:record".to_owned(),
                    false => render(value),
                },
            )));
        },
    )?;
    out.insert("search_documents".into(), documents);
    Ok(())
}

fn select(connection: &Arc<Connection>, table: &str, columns: &str) -> Result<Statement, String> {
    connection
        .prepare(format!(
            "SELECT {columns} FROM \"{}\"",
            table.replace('"', "\"\"")
        ))
        .map_err(|error| format!("{table}: {error}"))
}

fn row_text(values: impl Iterator<Item = String>) -> String {
    serde_json::to_string(&values.collect::<Vec<_>>()).unwrap_or_default()
}

fn render(value: &Value) -> String {
    match value {
        // Tagged with the storage class: text and a printable blob differ.
        Value::Text(text) => format!("t:{}", text.as_str()),
        // Printable bytes as they are, so ids inside encoded records stay
        // visible to normalization.
        Value::Blob(blob) => std::iter::once("b:".to_owned())
            .chain(blob.iter().map(|byte| match byte {
                0x20..=0x7e if *byte != b'\\' => char::from(*byte).to_string(),
                _ => format!("\\x{byte:02x}"),
            }))
            .collect(),
        other => format!("{other:?}"),
    }
}

fn rows(statement: &mut Statement, mut visit: impl FnMut(Vec<Value>)) -> Result<(), String> {
    loop {
        match statement.step().map_err(|error| error.to_string())? {
            StepResult::Done => return Ok(()),
            StepResult::Row => {
                let row = statement.row().ok_or("row without values")?;
                visit(row.get_values().cloned().collect());
            }
            StepResult::IO | StepResult::Yield => {
                statement._io().step().map_err(|error| error.to_string())?;
            }
            StepResult::Busy | StepResult::Interrupt => return Err("busy".into()),
        }
    }
}
