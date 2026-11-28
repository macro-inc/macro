//! Attachment facts of Mail threads (`mail-attachment`). The Mail projection
//! writes them from a thread's attachment records; a cache written before they
//! existed gets them here, once, from the records it already holds, so the
//! Mail lists an attachment kind filters answer locally with its other facts
//! and its records and queued mutations stay.
//!
//! The rule is the projection's (`soup_filter_cache_adapter`'s Mail module): a
//! thread's `attachments` field names its attachment records, and each record's
//! `mimeType` gives the kinds `item_filter_index::mail::attachment_kinds`
//! reads. A record the cache does not hold, or holds without a type, gives none.

use super::*;
use cache_core::value::CacheValue;
use derived_sorts::{AUTHORITATIVE, OPTIMISTIC, Tables};
use item_filter_index::mail;

const VERSION_KEY: &str = "mail_attachment_facts";
const VERSION: &str = "1";
const META_SELECT: &str = "SELECT value FROM meta WHERE key = ?1";
const META_UPSERT: &str = "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value";
/// Threads read per statement.
const BATCH_SIZE: usize = 256;

pub(super) fn save_version(connection: &Db) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        META_UPSERT,
        vec![text(VERSION_KEY), text(VERSION)],
    )?;
    Ok(())
}

/// Writes the attachment facts of every complete Mail document once, from
/// the thread and attachment records the cache holds. An optimistic document
/// takes them from the authoritative thread record: no queued Mail write
/// changes a thread's attachments, and its reply re-projects the thread.
pub(super) fn ensure_version(connection: &Db) -> Result<(), TursoStorageError> {
    let versions = driver::query(connection, META_SELECT, vec![text(VERSION_KEY)])?;
    if let [row] = versions.as_slice()
        && required_text(row, 0)? == VERSION
    {
        return Ok(());
    }
    driver::write_transaction(connection, || {
        for tables in [AUTHORITATIVE, OPTIMISTIC] {
            for profile in mail::DOCUMENT_PROFILES {
                backfill(connection, &tables, profile)?;
            }
            derived_sorts::mark_over_limit_incomplete(
                connection,
                &tables,
                tables.exact,
                mail::ATTACHMENT_ATTRIBUTE,
            )?;
        }
        save_version(connection)
    })
}

fn backfill(connection: &Db, tables: &Tables, profile: &str) -> Result<(), TursoStorageError> {
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
    let insert = format!(
        "INSERT INTO {exact} (document_id, attribute, value) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING"
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
            .collect::<Vec<_>>();
        let keys = threads
            .iter()
            .flat_map(|(_, keys)| keys.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let record_keys = keys
            .iter()
            .map(RecordKey::from_entity)
            .collect::<Result<Vec<_>, _>>()?;
        let attachments = record_batch::read(connection, &record_keys)?;
        let mime_types = keys
            .into_iter()
            .zip(attachments)
            .filter_map(|(key, record)| Some((key, mime_type(&record?)?)))
            .collect::<BTreeMap<_, _>>();
        for (document_id, keys) in &threads {
            let kinds = mail::attachment_kinds(
                keys.iter()
                    .filter_map(|key| mime_types.get(key).map(String::as_str)),
            );
            for kind in kinds {
                driver::execute(
                    connection,
                    &insert,
                    vec![
                        Value::from_i64(*document_id),
                        text(mail::ATTACHMENT_ATTRIBUTE),
                        Value::from_blob(mail::attachment_value(kind).as_bytes().to_vec()),
                    ],
                )?;
            }
        }
        match document_ids.last() {
            Some(last) if rows.len() == BATCH_SIZE => after = *last,
            _ => return Ok(()),
        }
    }
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
