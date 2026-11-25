//! Carries the mutation queue across a wipe of its database.
//!
//! Records are refetchable, queued writes are not. Before a database is wiped
//! its queue is read into a [`SalvagedQueue`], encoded into the append-only
//! [`SalvageFile`] kept beside the database, and imported into the next one.

use super::{
    LAYER_INSERT, OPTIMISTIC_EXACT_FACT_INSERT, OPTIMISTIC_INDEX_DOCUMENT_INSERT,
    OPTIMISTIC_INTEGER_FACT_INSERT, OPTIMISTIC_SORT_FACT_INSERT, OPTIMISTIC_UNCERTAINTY_INSERT,
    RECORD_GET, TursoStorage, invariant, mutation_retry, nullable_text, required_blob,
    required_i64, required_text, text,
};
use crate::TursoStorageError;
use crate::driver::{self, Db};
use crate::key::RecordKey;
use cache_core::engine::{IDENTITY_META_KEY, STORAGE_GENERATION_META_KEY};
use cache_core::value::EntityKey;
use std::collections::{BTreeMap, HashSet};
use turso_core::Value;
use uuid::Uuid;

mod file;
mod read;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

pub use file::{QueueLoss, SalvageFile};
#[cfg(target_arch = "wasm32")]
pub use read::read_queue;

/// Names the queue a database imported last: its ID, its rounds and when.
const IMPORT_MARKER_KEY: &str = "salvaged-queue";

/// Columns of a `QUEUE_SELECT` row: the queued write's own, then its layer's
/// data and updates and its retry count.
const QUEUE_ROW_COLUMNS: usize = 17;
const IDENTITY_COLUMN: usize = 6;
const LEASE_OWNER_COLUMN: usize = 9;
const LEASE_EXPIRY_COLUMN: usize = 11;
const CREATED_AT_COLUMN: usize = 13;

const QUEUE_IMPORT: &str = "INSERT INTO mutation_queue (id, uuid, superseded, query, operation_name, variables_json, identity, attempt_count, next_attempt_at_ms, lease_owner, lease_generation, lease_expires_at_ms, last_error, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)";
const SEQUENCE_SELECT: &str = "SELECT seq FROM sqlite_sequence WHERE name = 'mutation_queue'";
/// AUTOINCREMENT remembers the highest ID ever inserted, deleted or not.
const SEQUENCE_INSERT: &str = "INSERT INTO mutation_queue (id, uuid, superseded, query, variables_json, created_at_ms) VALUES (?1, '', 1, '', '', 0)";
const SEQUENCE_REMOVE: &str = "DELETE FROM mutation_queue WHERE id = ?1";
const CURRENT_UUID_SELECT: &str =
    "SELECT 1 FROM mutation_queue WHERE uuid = ?1 AND superseded = 0 LIMIT 1";
const QUEUED_AS_SELECT: &str =
    "SELECT 1 FROM mutation_queue WHERE id = ?1 AND uuid = ?2 AND created_at_ms = ?3 LIMIT 1";
const SHADOW_KEY_SELECT: &str =
    "SELECT 1 FROM optimistic_index_documents WHERE record_key = ?1 LIMIT 1";
const SHADOW_FACT_INSERTS: [&str; 4] = [
    OPTIMISTIC_EXACT_FACT_INSERT,
    OPTIMISTIC_INTEGER_FACT_INSERT,
    OPTIMISTIC_SORT_FACT_INSERT,
    OPTIMISTIC_UNCERTAINTY_INSERT,
];
const RECORD_KEEP: &str =
    "INSERT INTO records (__typename, id, value) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING";

/// A mutation queue on its way from a wiped database to the next one.
///
/// Holds queued writes and what they need to run again: their optimistic
/// layers, projections and retry counts, the account and access policy they
/// were made under, and the aliases of the entities they name.
#[derive(Clone, Debug, PartialEq)]
pub struct SalvagedQueue {
    id: Uuid,
    /// Storage generation of the database this was read from.
    source: Option<Vec<u8>>,
    rounds: u32,
    /// Whether this is everything those databases queued.
    complete: bool,
    /// The highest ID that database ever gave a queued mutation.
    sequence: i64,
    rows: Vec<Vec<Value>>,
    shadows: Vec<Shadow>,
    records: Vec<(RecordKey, Vec<u8>)>,
}

/// One optimistic projection document and its facts.
#[derive(Clone, Debug, PartialEq)]
struct Shadow {
    owner: i64,
    /// Every other column, `record_key` first.
    document: Vec<Value>,
    /// Attribute and value per fact, as [`SHADOW_FACT_INSERTS`] orders them.
    facts: [Vec<Vec<Value>>; 4],
}

/// What reading a database's queue found.
#[derive(Debug, Default, PartialEq)]
pub struct QueueRead {
    /// The queue to import, when there is one.
    pub queue: Option<SalvagedQueue>,
    /// Queued writes found and not carried.
    pub dropped: u64,
    /// Whether the whole queue could be read.
    pub complete: bool,
    /// Whether the queue was given up because wipes kept following its import.
    pub abandoned: bool,
    /// Whether the copy of the pending queue must go before the database does:
    /// the database held that queue already, or is another account's.
    pub forget_pending: bool,
}

/// What importing a queue did.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct QueueImport {
    /// Queued writes the database now holds that it did not before.
    pub kept: u64,
    /// Queued writes it could not take.
    pub dropped: u64,
    /// Whether every write is queued again under its own ID.
    pub complete: bool,
}

impl SalvagedQueue {
    /// Returns how many queued writes this holds.
    pub fn len(&self) -> u64 {
        self.rows.len() as u64
    }

    /// Returns whether this holds no queued write.
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    fn account(&self) -> Option<&[u8]> {
        self.record(IDENTITY_META_KEY)
    }

    fn record(&self, key: &str) -> Option<&[u8]> {
        let key = RecordKey::from_entity(&EntityKey(key.into())).ok()?;
        self.records
            .iter()
            .find(|(record, _)| *record == key)
            .map(|(_, value)| value.as_slice())
    }

    /// This queue, once something queued after it was lost unread.
    pub fn after_loss(self) -> Self {
        Self {
            complete: false,
            ..self
        }
    }

    /// Moves every write to an ID above `sequence`, in the same order. A moved
    /// write is nobody's any more, so its lease goes.
    fn renumbered_above(mut self, sequence: i64) -> Result<Self, TursoStorageError> {
        let mut next = sequence.max(self.sequence);
        let mut ids = BTreeMap::new();
        for row in &mut self.rows {
            next = next.checked_add(1).ok_or_else(invariant)?;
            ids.insert(required_i64(row, 0)?, next);
            for (column, value) in [
                (0, Value::from_i64(next)),
                (LEASE_OWNER_COLUMN, Value::Null),
                (LEASE_EXPIRY_COLUMN, Value::Null),
            ] {
                *row.get_mut(column).ok_or_else(invariant)? = value;
            }
        }
        for shadow in &mut self.shadows {
            shadow.owner = *ids.get(&shadow.owner).ok_or_else(invariant)?;
        }
        self.sequence = next;
        Ok(self)
    }
}

fn sequence(connection: &Db) -> Result<i64, TursoStorageError> {
    match driver::query(connection, SEQUENCE_SELECT, Vec::new())?.as_slice() {
        [] => Ok(0),
        [row] => required_i64(row, 0),
        _ => Err(invariant()),
    }
}

fn metadata_record(connection: &Db, key: &str) -> Result<Option<Vec<u8>>, TursoStorageError> {
    record(connection, &RecordKey::from_entity(&EntityKey(key.into()))?)
}

fn record(connection: &Db, key: &RecordKey) -> Result<Option<Vec<u8>>, TursoStorageError> {
    let rows = driver::query(
        connection,
        RECORD_GET,
        vec![text(&key.typename), text(&key.id)],
    )?;
    rows.first().map(|row| required_blob(row, 0)).transpose()
}

/// Whether this is the database `queue` was read from, which may never have
/// been given a generation: it still queues one of those very writes.
fn queues_any_of(connection: &Db, queue: &SalvagedQueue) -> Result<bool, TursoStorageError> {
    for row in &queue.rows {
        let (id, uuid, created_at_ms) = identity_of(row)?;
        let values = vec![
            Value::from_i64(id),
            text(&uuid),
            Value::from_i64(created_at_ms),
        ];
        let found = driver::query(connection, QUEUED_AS_SELECT, values)?;
        if !found.is_empty() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// What no other write has: another database may reuse the ID, and an edit of
/// the same thing the UUID.
fn identity_of(row: &[Value]) -> Result<(i64, String, i64), TursoStorageError> {
    Ok((
        required_i64(row, 0)?,
        required_text(row, 1)?,
        required_i64(row, CREATED_AT_COLUMN)?,
    ))
}

#[derive(Clone, Copy)]
struct ImportMarker {
    id: Uuid,
    rounds: u32,
    imported_at_ms: i64,
    /// Whether the import was: pages may not have heard that it was not.
    complete: bool,
}

impl ImportMarker {
    /// Of a database that imported nothing.
    fn never(now_ms: i64) -> Self {
        Self {
            id: Uuid::nil(),
            rounds: 0,
            imported_at_ms: now_ms,
            complete: true,
        }
    }

    fn save(self, connection: &Db) -> Result<(), TursoStorageError> {
        let Self {
            id,
            rounds,
            imported_at_ms,
            complete,
        } = self;
        driver::execute(
            connection,
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            vec![
                text(IMPORT_MARKER_KEY),
                text(&format!("{id} {rounds} {imported_at_ms} {complete}")),
            ],
        )
        .map(drop)
    }

    fn parse(value: &str) -> Option<Self> {
        let fields: Vec<&str> = value.split(' ').collect();
        let [id, rounds, imported_at_ms, complete] = fields.as_slice() else {
            return None;
        };
        Some(Self {
            id: id.parse().ok()?,
            rounds: rounds.parse().ok()?,
            imported_at_ms: imported_at_ms.parse().ok()?,
            complete: complete.parse().ok()?,
        })
    }
}

fn import_marker(connection: &Db) -> Result<Option<ImportMarker>, TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT value FROM meta WHERE key = ?1",
        vec![text(IMPORT_MARKER_KEY)],
    )?;
    rows.first()
        .map(|row| nullable_text(row, 0))
        .transpose()
        .map(|value| value.flatten().as_deref().and_then(ImportMarker::parse))
}

impl TursoStorage {
    /// Returns whether this database holds that queue, or did before it settled.
    pub fn holds_queue(&self, queue: &SalvagedQueue) -> Result<bool, TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        holds(&connection, queue, import_marker(&connection)?)
    }

    /// Adds a salvaged queue to this database, all of it or nothing, unless
    /// this database already holds it. Run it before anything else writes.
    pub fn import_queue(
        &mut self,
        queue: &SalvagedQueue,
        now_ms: i64,
    ) -> Result<QueueImport, TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::write_transaction(&connection, || import(&connection, queue, now_ms));
        self.latch_result(result)
    }
}

fn holds(
    connection: &Db,
    queue: &SalvagedQueue,
    marker: Option<ImportMarker>,
) -> Result<bool, TursoStorageError> {
    Ok(marker.is_some_and(|marker| marker.id == queue.id)
        || (queue.source.is_some()
            && queue.source == metadata_record(connection, STORAGE_GENERATION_META_KEY)?)
        || queues_any_of(connection, queue)?)
}

fn import(
    connection: &Db,
    queue: &SalvagedQueue,
    now_ms: i64,
) -> Result<QueueImport, TursoStorageError> {
    let marker = import_marker(connection)?;
    if holds(connection, queue, marker)? {
        if marker.is_none_or(|marker| marker.id != queue.id) {
            // Still known when every write of it is settled.
            ImportMarker {
                id: queue.id,
                ..marker.unwrap_or(ImportMarker::never(now_ms))
            }
            .save(connection)?;
        }
        return Ok(QueueImport {
            complete: queue.complete,
            ..QueueImport::default()
        });
    }
    let account = metadata_record(connection, IDENTITY_META_KEY)?;
    if account.is_some() && account.as_deref() != queue.account() {
        return Ok(QueueImport {
            dropped: queue.len(),
            ..QueueImport::default()
        });
    }
    let highest = sequence(connection)?;
    let queue = if highest == 0 {
        queue.clone()
    } else {
        queue.clone().renumbered_above(highest)?
    };
    let mut imported = QueueImport::default();
    let mut owners = HashSet::new();
    for row in &queue.rows {
        if import_row(connection, row)? {
            owners.insert(required_i64(row, 0)?);
        }
    }
    imported.kept = owners.len() as u64;
    imported.dropped = queue.len() - imported.kept;
    imported.complete = queue.complete && imported.dropped == 0 && highest == 0;
    restore_sequence(connection, queue.sequence)?;
    for shadow in queue
        .shadows
        .iter()
        .filter(|shadow| owners.contains(&shadow.owner))
    {
        import_shadow(connection, shadow)?;
    }
    for (key, value) in &queue.records {
        driver::execute(
            connection,
            RECORD_KEEP,
            vec![
                text(&key.typename),
                text(&key.id),
                Value::from_blob(value.clone()),
            ],
        )?;
    }
    ImportMarker {
        id: queue.id,
        rounds: queue.rounds,
        imported_at_ms: now_ms,
        complete: imported.complete,
    }
    .save(connection)?;
    Ok(imported)
}

/// Returns false when this database already queues that write.
fn import_row(connection: &Db, row: &[Value]) -> Result<bool, TursoStorageError> {
    let [columns @ .., data, updates, failures] = row else {
        return Err(invariant());
    };
    let (id, uuid, superseded) = (
        required_i64(columns, 0)?,
        required_text(columns, 1)?,
        required_i64(columns, 2)?,
    );
    if superseded == 0
        && !driver::query(connection, CURRENT_UUID_SELECT, vec![text(&uuid)])?.is_empty()
    {
        return Ok(false);
    }
    driver::execute(connection, QUEUE_IMPORT, columns.to_vec())?;
    driver::execute(
        connection,
        LAYER_INSERT,
        vec![Value::from_i64(id), data.clone(), updates.clone()],
    )?;
    let failures = match failures {
        Value::Null => 0,
        Value::Text(value) => mutation_retry::parse(Some(value.as_str().to_owned()))?,
        _ => return Err(invariant()),
    };
    mutation_retry::save(connection, id, failures)?;
    Ok(true)
}

fn restore_sequence(connection: &Db, highest: i64) -> Result<(), TursoStorageError> {
    if sequence(connection)? >= highest {
        return Ok(());
    }
    driver::execute(connection, SEQUENCE_INSERT, vec![Value::from_i64(highest)])?;
    driver::execute(connection, SEQUENCE_REMOVE, vec![Value::from_i64(highest)])?;
    Ok(())
}

fn import_shadow(connection: &Db, shadow: &Shadow) -> Result<(), TursoStorageError> {
    let key = shadow.document.first().ok_or_else(invariant)?.clone();
    if !driver::query(connection, SHADOW_KEY_SELECT, vec![key])?.is_empty() {
        return Ok(());
    }
    let mut values = vec![Value::from_i64(shadow.owner)];
    values.extend(shadow.document.iter().cloned());
    let inserted = driver::query(connection, OPTIMISTIC_INDEX_DOCUMENT_INSERT, values)?;
    let id = required_i64(inserted.first().ok_or_else(invariant)?, 0)?;
    for (facts, sql) in shadow.facts.iter().zip(SHADOW_FACT_INSERTS) {
        for fact in facts {
            let mut values = vec![Value::from_i64(id)];
            values.extend(fact.iter().cloned());
            driver::execute(connection, sql, values)?;
        }
    }
    Ok(())
}
