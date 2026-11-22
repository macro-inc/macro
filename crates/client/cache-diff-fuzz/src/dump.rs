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
///
/// With `facts`, `meta`'s `storage_schema_version` is masked and
/// `index_document_facts` holds each complete document's facts, decoded from its
/// blob (storage schema 13 and later) or gathered from the fact tables (before),
/// so builds on both sides of that schema change compare.
///
/// Each `(column, value)` in `ignore` leaves out the rows whose `column` holds
/// `value` as text, in every table that has that column, everywhere above too.
/// Each name in `json_facts` drops every fact `{"attribute":NAME,"value":N}`
/// from stored text, as optimistic layers keep the index documents they project.
pub fn tables(
    path: &Path,
    decoded: bool,
    facts: bool,
    ignore: &[(String, String)],
    json_facts: &[String],
) -> Result<BTreeMap<String, Vec<String>>, String> {
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
        rows(&mut select(&connection, ignore, &name, "*")?, |values| {
            table.push(row_text(
                values
                    .iter()
                    .map(|value| without_json_facts(render(value), json_facts)),
            ));
        })?;
        out.insert(name, table);
    }
    if decoded {
        decode_records(&connection, ignore, &mut out)?;
    }
    if facts {
        decode_facts(&connection, ignore, &mut out)?;
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
    ignore: &[(String, String)],
    out: &mut BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    if !out.contains_key("records") {
        return Ok(());
    }
    let mut hashes = HashMap::new();
    let mut records = Vec::new();
    rows(
        &mut select(connection, ignore, "records", "__typename, id, value")?,
        |values| {
            let value = match &values[2] {
                Value::Blob(bytes) => {
                    let hash: String = Sha256::digest(bytes)[..8]
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect();
                    hashes.insert((render(&values[0]), render(&values[1])), hash);
                    // A record that doesn't decode keeps its bytes, so two different ones differ.
                    match cache_core::codec::decode_record(bytes) {
                        Ok(record) => match serde_json::to_string(&record) {
                            Ok(json) => format!("r:{json}"),
                            Err(error) => format!("r!{error} {}", opaque_bytes(bytes)),
                        },
                        Err(error) => format!("r!{error} {}", opaque_bytes(bytes)),
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
            ignore,
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

/// Rewrites `meta` and `index_document_facts` as [`tables`] describes for `facts`.
fn decode_facts(
    connection: &Arc<Connection>,
    ignore: &[(String, String)],
    out: &mut BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    if out.contains_key("meta") {
        let mut meta = Vec::new();
        rows(
            &mut select(connection, ignore, "meta", "key, value")?,
            |values| {
                let schema = matches!(&values[0], Value::Text(key) if key.as_str() == "storage_schema_version");
                meta.push(row_text(values.iter().enumerate().map(
                    |(index, value)| match index == 1 && schema {
                        true => "schema".to_owned(),
                        false => render(value),
                    },
                )));
            },
        )?;
        out.insert("meta".into(), meta);
    }
    let mut documents = BTreeMap::new();
    if out.contains_key("index_document_facts") {
        rows(
            &mut select(
                connection,
                ignore,
                "index_document_facts",
                "document_id, facts",
            )?,
            |values| {
                // Undecodable values keep their bytes, so two different ones differ.
                let facts = match &values[1] {
                    Value::Blob(blob) => facts_blob::decode(blob).ok_or_else(|| opaque_bytes(blob)),
                    other => Err(render(other)),
                };
                documents.insert(render(&values[0]), facts);
            },
        )?;
    } else if out.contains_key("index_documents") {
        // The facts of each complete document, from the fact tables.
        rows(
            &mut select(connection, ignore, "index_documents", "id, state")?,
            |values| {
                if render(&values[1]) == render(&Value::from_i64(0)) {
                    documents.insert(render(&values[0]), Ok::<Vec<String>, String>(Vec::new()));
                }
            },
        )?;
        for (table, tag) in [
            ("exact_facts", "e"),
            ("integer_facts", "i"),
            ("sort_facts", "s"),
        ] {
            rows(
                &mut select(connection, ignore, table, "document_id, attribute, value")?,
                |values| {
                    if let Some(Ok(facts)) = documents.get_mut(&render(&values[0])) {
                        let attribute = match &values[1] {
                            Value::Text(text) => text.as_str().to_owned(),
                            other => render(other),
                        };
                        facts.push(format!("{tag} {attribute} {}", render(&values[2])));
                    }
                },
            )?;
        }
    } else {
        return Ok(());
    }
    let table = documents
        .into_iter()
        .map(|(id, facts)| {
            let facts = match facts {
                Ok(mut facts) => {
                    facts.sort();
                    serde_json::to_string(&facts).unwrap_or_default()
                }
                Err(value) => format!("invalid {value}"),
            };
            row_text([id, facts].into_iter())
        })
        .collect();
    out.insert("index_document_facts".into(), table);
    Ok(())
}

/// The facts blob of storage schema 13 (`cache-turso`'s `storage/facts_blob.rs`),
/// read back as one `tag attribute value` line per fact, rendered as the fact
/// tables' rows are.
mod facts_blob {
    use super::{render, render_bytes};
    use turso_core::Value;

    pub fn decode(blob: &[u8]) -> Option<Vec<String>> {
        let mut reader = Reader { blob, at: 0 };
        if reader.byte()? != 1 {
            return None;
        }
        let mut facts = Vec::new();
        let count = reader.varint()?;
        let mut previous = None;
        for _ in 0..count {
            let attribute = reader.attribute(&mut previous)?;
            let length = usize::try_from(reader.varint()?).ok()?;
            let value = render_bytes(reader.bytes(length)?);
            facts.push(format!("e {attribute} {value}"));
        }
        for tag in ["i", "s"] {
            let count = reader.varint()?;
            let mut previous = None;
            for _ in 0..count {
                let attribute = reader.attribute(&mut previous)?;
                let raw = reader.varint()?;
                let value = ((raw >> 1) as i64) ^ -((raw & 1) as i64);
                facts.push(format!(
                    "{tag} {attribute} {}",
                    render(&Value::from_i64(value))
                ));
            }
        }
        (reader.at == blob.len()).then_some(facts)
    }

    struct Reader<'a> {
        blob: &'a [u8],
        at: usize,
    }

    impl<'a> Reader<'a> {
        fn byte(&mut self) -> Option<u8> {
            let byte = *self.blob.get(self.at)?;
            self.at += 1;
            Some(byte)
        }

        fn varint(&mut self) -> Option<u64> {
            let mut value = 0u64;
            for shift in (0..64).step_by(7) {
                let byte = self.byte()?;
                // The tenth byte holds bit 63 only; more would overflow.
                if shift == 63 && byte & 0x7f > 1 {
                    return None;
                }
                value |= u64::from(byte & 0x7f) << shift;
                if byte & 0x80 == 0 {
                    return Some(value);
                }
            }
            None
        }

        fn bytes(&mut self, length: usize) -> Option<&'a [u8]> {
            let bytes = self.blob.get(self.at..self.at.checked_add(length)?)?;
            self.at += length;
            Some(bytes)
        }

        fn attribute(&mut self, previous: &mut Option<&'a str>) -> Option<&'a str> {
            let length = usize::try_from(self.varint()?).ok()?;
            if length == 0 {
                return *previous;
            }
            let attribute = std::str::from_utf8(self.bytes(length)?).ok()?;
            *previous = Some(attribute);
            Some(attribute)
        }
    }
}

fn select(
    connection: &Arc<Connection>,
    ignore: &[(String, String)],
    table: &str,
    columns: &str,
) -> Result<Statement, String> {
    let name = quoted(table, '"');
    let mut clause = String::new();
    for (column, value) in ignore {
        let column = quoted(column, '"');
        // Only in tables that have the column.
        if connection
            .prepare(format!("SELECT {column} FROM {name} LIMIT 0"))
            .is_ok()
        {
            let word = if clause.is_empty() { "WHERE" } else { "AND" };
            clause.push_str(&format!(" {word} {column} IS NOT {}", quoted(value, '\'')));
        }
    }
    connection
        .prepare(format!("SELECT {columns} FROM {name}{clause}"))
        .map_err(|error| format!("{table}: {error}"))
}

/// Drops each `{"attribute":NAME,"value":N}` object, and a comma beside it, for
/// each name in `names`.
fn without_json_facts(mut text: String, names: &[String]) -> String {
    for name in names {
        let needle = format!(
            "{{\"attribute\":{},\"value\":",
            serde_json::Value::from(name.as_str())
        );
        while let Some(start) = text.find(&needle) {
            let Some(length) = text[start..].find('}') else {
                break;
            };
            let (mut from, mut to) = (start, start + length + 1);
            if text[..from].ends_with(',') {
                from -= 1;
            } else if text[to..].starts_with(',') {
                to += 1;
            }
            text.replace_range(from..to, "");
        }
    }
    text
}

fn quoted(name: &str, quote: char) -> String {
    let doubled = name.replace(quote, &format!("{quote}{quote}"));
    format!("{quote}{doubled}{quote}")
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
        Value::Blob(blob) => render_bytes(blob),
        other => format!("{other:?}"),
    }
}

fn render_bytes(blob: &[u8]) -> String {
    std::iter::once("b:".to_owned())
        .chain(blob.iter().map(|byte| match byte {
            0x20..=0x7e if *byte != b'\\' => char::from(*byte).to_string(),
            _ => format!("\\x{byte:02x}"),
        }))
        .collect()
}

/// Bytes that didn't decode, every byte escaped: normalization rewrites ids
/// and digests it finds in printable text, which could make two different
/// broken values equal.
fn opaque_bytes(blob: &[u8]) -> String {
    std::iter::once("x:".to_owned())
        .chain(blob.iter().map(|byte| format!("\\x{byte:02x}")))
        .collect()
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
