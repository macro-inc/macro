//! Reads every row of every table of a closed cache file, so two builds can be
//! compared on what they left on disk, not only on what they answer.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use turso_core::{Database, IO, OpenOptions, PlatformIO, SqliteDialect, Statement, StepResult};

/// Table name to its rows, each row as text, sorted.
pub fn tables(path: &Path) -> Result<BTreeMap<String, Vec<String>>, String> {
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
        // Names are text, which rows() tags `t:`.
        if let Some(name) = values.first().and_then(|name| name.strip_prefix("t:")) {
            names.push(name.to_owned());
        }
    })?;
    let mut out = BTreeMap::new();
    for name in names {
        let name = name.trim_matches('"').to_owned();
        let mut statement = connection
            .prepare(format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))
            .map_err(|error| format!("{name}: {error}"))?;
        let mut table = Vec::new();
        // A JSON array, so no value can run into the next one.
        rows(&mut statement, |values| {
            table.push(serde_json::to_string(&values).unwrap_or_default());
        })?;
        table.sort();
        out.insert(name, table);
    }
    connection.close().map_err(|error| error.to_string())?;
    Ok(out)
}

fn rows(statement: &mut Statement, mut visit: impl FnMut(Vec<String>)) -> Result<(), String> {
    loop {
        match statement.step().map_err(|error| error.to_string())? {
            StepResult::Done => return Ok(()),
            StepResult::Row => {
                let row = statement.row().ok_or("row without values")?;
                let values = row
                    .get_values()
                    .map(|value| match value {
                        // Tagged with the storage class: text and a printable blob differ.
                        turso_core::Value::Text(text) => format!("t:{}", text.as_str()),
                        // Printable bytes as they are, so ids inside encoded records stay
                        // visible to normalization.
                        turso_core::Value::Blob(blob) => std::iter::once("b:".to_owned())
                            .chain(blob.iter().map(|byte| match byte {
                                0x20..=0x7e if *byte != b'\\' => char::from(*byte).to_string(),
                                _ => format!("\\x{byte:02x}"),
                            }))
                            .collect(),
                        other => format!("{other:?}"),
                    })
                    .collect();
                visit(values);
            }
            StepResult::IO | StepResult::Yield => {
                statement._io().step().map_err(|error| error.to_string())?;
            }
            StepResult::Busy | StepResult::Interrupt => return Err("busy".into()),
        }
    }
}
