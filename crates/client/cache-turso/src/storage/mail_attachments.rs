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
use cache_core::queue::{decode_optimistic_source, encode_optimistic_source};
use cache_core::value::CacheValue;
use derived_sorts::{AUTHORITATIVE, OPTIMISTIC, Tables};
use item_filter_index::mail;
use predicate_index::{ExactFact, IndexDocument, OptimisticProjectionMutation};

/// Threads read per statement.
const BATCH_SIZE: usize = 256;
/// Attachment records decoded at a time; only their types are kept.
const ATTACHMENT_BATCH_SIZE: usize = 512;
/// Facts written per statement.
const INSERT_BATCH_SIZE: usize = 128;

/// Writes the attachment facts of every complete Mail document, and of the
/// Mail documents queued writes hold, from the thread and attachment records
/// the cache holds, inside the caller's write transaction. An optimistic
/// document takes them from the authoritative thread record: no queued Mail
/// write changes a thread's attachments, and its reply re-projects the thread.
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
    conform_queue(connection)
}

/// Gives the Mail documents of queued writes their threads' attachment facts.
/// Each later push for a thread composes its shadow from them again, and a
/// write queued by a build without the facts holds none.
fn conform_queue(connection: &Db) -> Result<(), TursoStorageError> {
    let layer_update =
        "UPDATE optimistic_layers SET optimistic_data_json = ?2 WHERE mutation_id = ?1";
    for row in driver::query(connection, QUEUE_SELECT, Vec::new())? {
        let row = parse_queue_row(&row)?;
        let layer = row.optimistic.ok_or_else(invariant)?;
        let mut source =
            decode_optimistic_source(&layer.optimistic_data_json).map_err(|_| invariant())?;
        let mut documents = source
            .projection_mutations
            .iter_mut()
            .filter_map(|mutation| match mutation {
                OptimisticProjectionMutation::Replace(document) if is_mail(document) => {
                    Some(document)
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        if documents.is_empty() {
            continue;
        }
        let threads = documents
            .iter()
            .map(|document| {
                RecordKey::from_entity(&EntityKey(document.record_key.as_str().to_owned().into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let kinds = kinds_of(connection, &record_batch::read(connection, &threads)?)?;
        let mut changed = false;
        for (document, kinds) in documents.iter_mut().zip(kinds) {
            let before = document.exact_facts.clone();
            document
                .exact_facts
                .retain(|fact| fact.attribute.as_str() != mail::ATTACHMENT_ATTRIBUTE);
            document
                .exact_facts
                .extend(kinds.into_iter().map(|kind| ExactFact {
                    attribute: mail::token(mail::ATTACHMENT_ATTRIBUTE),
                    value: mail::attachment_value(kind),
                }));
            document.canonicalize();
            changed |= document.exact_facts != before;
        }
        if !changed {
            continue;
        }
        require_changed(
            driver::execute(
                connection,
                layer_update,
                vec![
                    Value::from_i64(mutation_id_to_sql(row.id)?),
                    text(&encode_optimistic_source(&source)),
                ],
            )?,
            1,
        )?;
    }
    Ok(())
}

fn is_mail(document: &IndexDocument) -> bool {
    mail::DOCUMENT_PROFILES.contains(&document.profile.token().as_str())
        && document.partition.as_str() == mail::PARTITION
}

/// The attachment kinds of each of `threads`: none for a thread the cache
/// does not hold.
fn kinds_of(
    connection: &Db,
    threads: &[Option<Record>],
) -> Result<Vec<Vec<mail::AttachmentKind>>, TursoStorageError> {
    let keys = threads
        .iter()
        .map(|thread| thread.as_ref().map(attachment_keys).unwrap_or_default())
        .collect::<Vec<_>>();
    let mime_types = mime_types(connection, keys.iter().flatten().cloned().collect())?;
    Ok(keys
        .iter()
        .map(|keys| {
            mail::attachment_kinds(
                keys.iter()
                    .filter_map(|key| mime_types.get(key).map(String::as_str)),
            )
        })
        .collect())
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
        let kinds = kinds_of(connection, &record_batch::read(connection, &thread_keys)?)?;
        let facts = document_ids
            .iter()
            .zip(kinds)
            .flat_map(|(document_id, kinds)| {
                kinds.into_iter().map(move |kind| (*document_id, kind))
            })
            .collect::<Vec<_>>();
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
