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
/// With `search`, the search index of storage schema 14 and later (`search_slots`,
/// and `search_rows` clustered by slot) is written as the `search_documents` rows
/// the schemas before it hold: its slot numbers and row ids, which depend on the
/// order buckets and rows were first written, are left out.
///
/// Each `(column, value)` in `ignore` leaves out the rows whose `column` holds
/// the text `value`, in every table declaring that column, everywhere above too;
/// `attribute` also leaves out the facts of that attribute in a decoded facts
/// blob (not in one compared as bytes). Each name in `json_facts` is dropped
/// from optimistic layers' stored projections as [`without_json_facts`] says;
/// with any name given, layer text is compared re-serialized.
pub fn tables(
    path: &Path,
    decoded: bool,
    facts: bool,
    search: bool,
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
        // Only optimistic layers keep projections; other text is compared as it is.
        let layer_facts: &[String] = if name == "optimistic_layers" {
            json_facts
        } else {
            &[]
        };
        // A JSON array, so no value can run into the next one.
        rows(&mut select(&connection, ignore, &name, "*")?, |values| {
            table.push(row_text(
                values.iter().map(|value| render_text(value, layer_facts)),
            ));
        })?;
        out.insert(name, table);
    }
    if search {
        decode_search(&connection, ignore, &mut out)?;
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
    // From the rows already read (or written by `decode_search`), in their column
    // order: profile, __typename, id, bucket, search_text, timestamp_ms, source_hash.
    if let Some(documents) = out.get_mut("search_documents") {
        for row in documents.iter_mut() {
            let Ok(mut values) = serde_json::from_str::<Vec<String>>(row) else {
                continue;
            };
            let ours = values.len() == 7
                && hashes
                    .get(&(values[1].clone(), values[2].clone()))
                    .is_some_and(|hash| values[6] == render(&Value::build_text(hash.clone())));
            if ours {
                values[6] = "h:record".to_owned();
                *row = row_text(values.into_iter());
            }
        }
    }
    Ok(())
}

/// The profile a schema 14 search row's number stands for (`profile_code` in
/// cache-turso); an unknown number is kept as one, so two different ones differ.
fn search_profile(code: &Value) -> Value {
    if render(code) == render(&Value::from_i64(1)) {
        Value::build_text("quick-access-v1")
    } else {
        code.clone()
    }
}

/// Writes schema 14's `search_slots` and `search_rows` as `search_documents`
/// rows, as [`tables`] describes for `search`. A row whose slot has no
/// `search_slots` row keeps the slot number as its bucket, marked, so it differs.
fn decode_search(
    connection: &Arc<Connection>,
    ignore: &[(String, String)],
    out: &mut BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    if !out.contains_key("search_rows") || !out.contains_key("search_slots") {
        return Ok(());
    }
    let mut slots = HashMap::new();
    rows(
        &mut select(connection, ignore, "search_slots", "slot, profile, bucket")?,
        |values| {
            slots.insert(render(&values[0]), (render(&values[1]), values[2].clone()));
        },
    )?;
    // One slot per profile bucket: a second would split a bucket across two row ranges.
    let mut buckets: BTreeMap<(String, String), usize> = BTreeMap::new();
    for (profile, bucket) in slots.values() {
        *buckets
            .entry((profile.clone(), render(bucket)))
            .or_default() += 1;
    }
    let shared: Vec<String> = buckets
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .map(|((profile, bucket), count)| {
            row_text([profile, bucket, count.to_string()].into_iter())
        })
        .collect();
    if !shared.is_empty() {
        out.insert("search_slots_shared".into(), shared);
    }
    let mut documents = Vec::new();
    rows(
        &mut select(
            connection,
            ignore,
            "search_rows",
            "slot, profile, __typename, id, search_text, timestamp_ms, source_hash",
        )?,
        |values| {
            let slot = render(&values[0]);
            // The bucket a row is in is its slot's; a row naming another profile
            // than its slot does shows as that mismatch.
            let bucket = match slots.get(&slot) {
                Some((profile, bucket)) if *profile == render(&values[1]) => render(bucket),
                Some((profile, bucket)) => format!("slot-profile {profile} {}", render(bucket)),
                None => format!("no-slot {slot}"),
            };
            documents.push(row_text(
                [
                    render(&search_profile(&values[1])),
                    render(&values[2]),
                    render(&values[3]),
                    bucket,
                    render(&values[4]),
                    render(&values[5]),
                    render(&values[6]),
                ]
                .into_iter(),
            ));
        },
    )?;
    out.remove("search_rows");
    out.remove("search_slots");
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
    // The fact tables leave out ignored attributes in `select`; a blob needs the same.
    let ignored: Vec<&str> = ignore
        .iter()
        .filter(|(column, _)| column == "attribute")
        .map(|(_, value)| value.as_str())
        .collect();
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
                    Value::Blob(blob) => {
                        facts_blob::decode(blob, &ignored).ok_or_else(|| opaque_bytes(blob))
                    }
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
/// tables' rows are, without the facts of `ignored` attributes.
mod facts_blob {
    use super::{render, render_bytes};
    use turso_core::Value;

    pub fn decode(blob: &[u8], ignored: &[&str]) -> Option<Vec<String>> {
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
            if !ignored.contains(&attribute) {
                facts.push(format!("e {attribute} {value}"));
            }
        }
        for tag in ["i", "s"] {
            let count = reader.varint()?;
            let mut previous = None;
            for _ in 0..count {
                let attribute = reader.attribute(&mut previous)?;
                let raw = reader.varint()?;
                let value = ((raw >> 1) as i64) ^ -((raw & 1) as i64);
                if !ignored.contains(&attribute) {
                    facts.push(format!(
                        "{tag} {attribute} {}",
                        render(&Value::from_i64(value))
                    ));
                }
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
    // The declared columns: a probe query would accept an unknown
    // double-quoted name as a string literal, and `rowid` in every table.
    let mut declared = Vec::new();
    rows(
        &mut connection
            .prepare(format!("PRAGMA table_info({name})"))
            .map_err(|error| format!("{table}: {error}"))?,
        |values| {
            if let Some(Value::Text(column)) = values.get(1) {
                declared.push(column.as_str().to_owned());
            }
        },
    )?;
    let mut clause = String::new();
    for (column, value) in ignore {
        // Column names match as SQLite matches them, ignoring ASCII case.
        if !declared
            .iter()
            .any(|declared| declared.eq_ignore_ascii_case(column))
        {
            continue;
        }
        let column = quoted(column, '"');
        let word = if clause.is_empty() { "WHERE" } else { "AND" };
        // Text only, byte for byte: `=` would apply the column's affinity (so
        // `07` would match 7) and its collation.
        clause.push_str(&format!(
            " {word} NOT (typeof({column}) = 'text' AND {column} = {} COLLATE BINARY)",
            quoted(value, '\'')
        ));
    }
    connection
        .prepare(format!("SELECT {columns} FROM {name}{clause}"))
        .map_err(|error| format!("{table}: {error}"))
}

/// `value` rendered, with the facts in `names` dropped from an optimistic
/// layer's text as [`without_json_facts`] does.
fn render_text(value: &Value, names: &[String]) -> String {
    match value {
        Value::Text(text) if !names.is_empty() => {
            format!("t:{}", without_json_facts(text.as_str(), names))
        }
        other => render(other),
    }
}

/// The prefix of an optimistic layer's stored source (`cache-core`'s `queue.rs`).
const OPTIMISTIC_SOURCE: &str = "@macro-cache/optimistic-source:";

/// An optimistic layer's source, written again with its `projectionMutations`
/// lacking each `{"attribute":NAME,"value":N}` (N an i64) of a `Patch`'s `sorts` or a
/// `Replace`'s `sort_facts`, and NAME
/// in an `Unknown`'s `affected_attributes` that names another attribute (an
/// empty list means every attribute, so a list of NAME alone stays). Any other
/// text is returned as it is.
fn without_json_facts(text: &str, names: &[String]) -> String {
    let Some(source) = text.strip_prefix(OPTIMISTIC_SOURCE) else {
        return text.to_owned();
    };
    let Ok(mut json) = serde_json::from_str::<serde_json::Value>(source) else {
        return text.to_owned();
    };
    let named = |value: &serde_json::Value| {
        value
            .as_str()
            .is_some_and(|text| names.iter().any(|name| name == text))
    };
    let mutations = json
        .get_mut("projectionMutations")
        .and_then(serde_json::Value::as_array_mut);
    for mutation in mutations.into_iter().flatten() {
        for pointer in ["/Patch/sorts", "/Replace/sort_facts"] {
            if let Some(sorts) = mutation
                .pointer_mut(pointer)
                .and_then(serde_json::Value::as_array_mut)
            {
                sorts.retain(|fact| {
                    !(fact.as_object().is_some_and(|fact| fact.len() == 2)
                        && fact.get("attribute").is_some_and(named)
                        && fact.get("value").is_some_and(serde_json::Value::is_i64))
                });
            }
        }
        if let Some(attributes) = mutation
            .pointer_mut("/Unknown/affected_attributes")
            .and_then(serde_json::Value::as_array_mut)
            && attributes.iter().any(|attribute| !named(attribute))
        {
            attributes.retain(|attribute| !named(attribute));
        }
    }
    format!("{OPTIMISTIC_SOURCE}{json}")
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

#[cfg(test)]
mod test;
