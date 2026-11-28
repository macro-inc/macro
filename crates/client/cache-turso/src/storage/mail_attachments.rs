//! Attachment facts of Mail threads (`mail-attachment`). The Mail projection
//! writes them from a thread's attachment records; a cache written before they
//! existed gets them here, from the records it already holds, so the Mail lists
//! an attachment kind filters answer locally with its other facts and its
//! records and queued mutations stay. `derived_sorts` decides when: its
//! versioned list names these facts, and a build without them drops the entry.
//!
//! The rule is the projection's (`soup_filter_cache_adapter`'s Mail module): a
//! thread's `attachments` field names its attachment records, and each record's
//! `mimeType` gives the kinds `item_filter_index::mail::attachment_kinds`
//! reads. A record the cache does not hold, or holds without a type, gives none.

use super::*;
use cache_core::value::CacheValue;
use derived_sorts::{AUTHORITATIVE, OPTIMISTIC, Tables};
use item_filter_index::mail;

/// Threads read per statement.
const BATCH_SIZE: usize = 256;
/// Attachment records decoded at a time; only their types are kept.
const ATTACHMENT_BATCH_SIZE: usize = 512;
/// Facts written per statement.
const INSERT_BATCH_SIZE: usize = 128;

/// Writes the attachment facts of every complete Mail document, from the
/// thread and attachment records the cache holds, inside the caller's write
/// transaction. An optimistic document takes them from the authoritative
/// thread record: no queued Mail write changes a thread's attachments, and its
/// reply re-projects the thread.
pub(super) fn backfill(connection: &Db) -> Result<(), TursoStorageError> {
    for tables in [AUTHORITATIVE, OPTIMISTIC] {
        for profile in mail::DOCUMENT_PROFILES {
            backfill_profile(connection, &tables, profile)?;
        }
        derived_sorts::mark_over_limit_incomplete(
            connection,
            &tables,
            tables.exact,
            mail::ATTACHMENT_ATTRIBUTE,
        )?;
    }
    Ok(())
}

fn backfill_profile(
    connection: &Db,
    tables: &Tables,
    profile: &str,
) -> Result<(), TursoStorageError> {
    let Tables {
        documents, exact, ..
    } = tables;
    // Seeks the scope index (profile, partition, state, id). The thread
    // records are then read by their primary key, a batch at a time: joining
    // them in this statement let the planner scan every thread record for
    // each batch.
    let documents = format!(
        "SELECT id, record_key FROM {documents} WHERE profile = ?1 AND partition = ?2 AND state = 0 AND id > ?3 ORDER BY id LIMIT ?4"
    );
    let batch_size = i64::try_from(BATCH_SIZE).map_err(|_| invariant())?;
    let mut after = 0;
    loop {
        let rows = driver::query(
            connection,
            &documents,
            vec![
                text(profile),
                text(mail::PARTITION),
                Value::from_i64(after),
                Value::from_i64(batch_size),
            ],
        )?;
        let mut document_ids = Vec::with_capacity(rows.len());
        let mut thread_keys = Vec::with_capacity(rows.len());
        for row in &rows {
            document_ids.push(required_i64(row, 0)?);
            let key = EntityKey(required_text(row, 1)?.into());
            thread_keys.push(RecordKey::from_entity(&key)?);
        }
        let threads = document_ids
            .iter()
            .zip(record_batch::read(connection, &thread_keys)?)
            .filter_map(|(document_id, record)| Some((*document_id, attachment_keys(&record?))))
            .filter(|(_, keys)| !keys.is_empty())
            .collect::<Vec<_>>();
        let mime_types = mime_types(
            connection,
            threads
                .iter()
                .flat_map(|(_, keys)| keys.iter().cloned())
                .collect::<BTreeSet<_>>(),
        )?;
        let mut facts = Vec::new();
        for (document_id, keys) in &threads {
            let kinds = mail::attachment_kinds(
                keys.iter()
                    .filter_map(|key| mime_types.get(key).map(String::as_str)),
            );
            facts.extend(kinds.into_iter().map(|kind| (*document_id, kind)));
        }
        insert(connection, exact, &facts)?;
        match document_ids.last() {
            Some(last) if rows.len() == BATCH_SIZE => after = *last,
            _ => return Ok(()),
        }
    }
}

/// The type of each of these attachment records the cache holds with one.
fn mime_types(
    connection: &Db,
    keys: BTreeSet<EntityKey<'static>>,
) -> Result<BTreeMap<EntityKey<'static>, String>, TursoStorageError> {
    let keys = keys.into_iter().collect::<Vec<_>>();
    let mut mime_types = BTreeMap::new();
    for chunk in keys.chunks(ATTACHMENT_BATCH_SIZE) {
        let record_keys = chunk
            .iter()
            .map(RecordKey::from_entity)
            .collect::<Result<Vec<_>, _>>()?;
        for (key, record) in chunk
            .iter()
            .zip(record_batch::read(connection, &record_keys)?)
        {
            if let Some(mime_type) = record.as_ref().and_then(mime_type) {
                mime_types.insert(key.clone(), mime_type);
            }
        }
    }
    Ok(mime_types)
}

/// Writes `facts`, a statement per [`INSERT_BATCH_SIZE`] of them.
fn insert(
    connection: &Db,
    exact: &str,
    facts: &[(i64, mail::AttachmentKind)],
) -> Result<(), TursoStorageError> {
    for chunk in facts.chunks(INSERT_BATCH_SIZE) {
        let rows = (0..chunk.len())
            .map(|index| format!("(?{}, ?1, ?{})", index * 2 + 2, index * 2 + 3))
            .collect::<Vec<_>>()
            .join(", ");
        let mut parameters = Vec::with_capacity(chunk.len() * 2 + 1);
        parameters.push(text(mail::ATTACHMENT_ATTRIBUTE));
        for (document_id, kind) in chunk {
            parameters.push(Value::from_i64(*document_id));
            parameters.push(Value::from_blob(
                mail::attachment_value(*kind).as_bytes().to_vec(),
            ));
        }
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {exact} (document_id, attribute, value) VALUES {rows} ON CONFLICT DO NOTHING"
            ),
            parameters,
        )?;
    }
    Ok(())
}

/// The records a thread's `attachments` field names.
fn attachment_keys(thread: &Record) -> Vec<EntityKey<'static>> {
    let Some(CacheValue::List(attachments)) = thread.fields.get("attachments") else {
        return Vec::new();
    };
    attachments
        .iter()
        .filter_map(|value| match value {
            CacheValue::Ref(key) => Some(key.clone()),
            _ => None,
        })
        .collect()
}

fn mime_type(attachment: &Record) -> Option<String> {
    match attachment.fields.get("mimeType")? {
        CacheValue::String(value) => Some(value.clone()),
        _ => None,
    }
}
