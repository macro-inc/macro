//! Reads the queue out of a database that is about to be wiped.

use super::{
    Db, IDENTITY_META_KEY, ImportMarker, QueueRead, RecordKey, STORAGE_GENERATION_META_KEY,
    SalvagedQueue, Shadow, TursoStorage, driver, import_marker, invariant, metadata_record, record,
    required_i64, required_text, sequence,
};
use crate::TursoStorageError;
use crate::storage::{
    OptimisticIndexDocumentState, QUEUE_SELECT, STORAGE_SCHEMA_VERSION, nullable_i64,
    parse_optimistic_uncertainty, parse_queue_row, projection_incomplete_kind,
};
use cache_core::codec::{
    MIGRATABLE_CACHE_FORMAT_VERSIONS, cache_namespace, cache_namespace_at, decode_record,
    encode_record,
};
use cache_core::engine::authority::AUTHORITY_META_KEY;
use cache_core::identity;
use cache_core::queue::decode_optimistic_source;
use cache_core::value::EntityKey;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use turso_core::Value;
use uuid::Uuid;

/// A wipe this soon after an import may have been caused by what it imported.
pub(super) const IMPORT_SETTLE_MS: i64 = 120_000;
/// Wipes in a row, each this soon after an import, that a queue survives.
pub(super) const MAX_ROUNDS: u32 = 8;

const SHADOW_SELECT: &str = "SELECT id, owner_mutation_id, record_key, profile, partition, state, incomplete_kind FROM optimistic_index_documents ORDER BY id";
const SHADOW_FACT_SELECTS: [&str; 4] = [
    "SELECT document_id, attribute, value FROM optimistic_exact_facts",
    "SELECT document_id, attribute, value FROM optimistic_integer_facts",
    "SELECT document_id, attribute, value FROM optimistic_sort_facts",
    "SELECT document_id, attribute FROM optimistic_uncertain_attributes ORDER BY document_id, attribute",
];
const UNCERTAIN_FACTS: usize = 3;

/// Reads the queue of a database that is about to be wiped, joined with
/// `pending`, a queue salvaged earlier that no database is known to hold yet.
///
/// A database that cannot be read yields what could be: `complete` says
/// whether that was all of it. The account the writes were made under must be
/// readable, or none of them are carried.
#[cfg(target_arch = "wasm32")]
pub fn read_queue(
    session: &turso_opfs::ConnectedOpfsSession,
    scope: &str,
    pending: Option<SalvagedQueue>,
    now_ms: i64,
) -> QueueRead {
    read(&Db::uncached(session.connection()), scope, pending, now_ms)
}

impl TursoStorage {
    /// Reads this database's queue as `read_queue` does before a wipe.
    pub fn salvage_queue(
        &self,
        scope: &str,
        pending: Option<SalvagedQueue>,
        now_ms: i64,
    ) -> QueueRead {
        read(&self.connection(), scope, pending, now_ms)
    }
}

fn read(connection: &Db, scope: &str, pending: Option<SalvagedQueue>, now_ms: i64) -> QueueRead {
    let held = match read_database(connection, scope, now_ms) {
        Ok(held) => held,
        Err(_) => {
            return QueueRead {
                queue: pending,
                ..QueueRead::default()
            }
            .marked();
        }
    };
    let held = match held {
        Held::Queue(held) => held,
        Held::Unknown(dropped) => {
            return QueueRead {
                queue: pending,
                dropped,
                complete: dropped == 0,
                ..QueueRead::default()
            }
            .marked();
        }
    };
    let pending_held = pending.as_ref().is_some_and(|pending| held.holds(pending));
    let pending = pending.filter(|_| !pending_held);
    let mut read = QueueRead {
        queue: None,
        dropped: held.dropped,
        complete: held.complete,
        abandoned: held.queue.rounds > MAX_ROUNDS && !held.queue.is_empty(),
        pending_held,
    };
    let queue = if read.abandoned {
        read.dropped += held.queue.len();
        None
    } else {
        Some(held.queue).filter(|queue| !queue.is_empty())
    };
    read.queue = match (queue, pending) {
        (Some(mut queue), Some(pending)) => match queue.absorb(pending) {
            Ok(left_out) => {
                read.dropped += left_out;
                Some(queue)
            }
            Err(_) => Some(queue),
        },
        (queue, pending) => queue.or(pending),
    };
    read.marked()
}

impl QueueRead {
    /// Tells the queue whether it is all there was.
    fn marked(mut self) -> Self {
        if let Some(queue) = &mut self.queue {
            queue.complete &= self.complete && self.dropped == 0 && !self.abandoned;
        }
        self
    }
}

enum Held {
    Queue(HeldQueue),
    /// No queue this build can read, and how many writes it holds.
    Unknown(u64),
}

struct HeldQueue {
    queue: SalvagedQueue,
    imported: Option<Uuid>,
    dropped: u64,
    complete: bool,
}

impl HeldQueue {
    /// Whether this database holds, or has already settled, what `pending` does.
    fn holds(&self, pending: &SalvagedQueue) -> bool {
        self.imported == Some(pending.id)
            || (pending.source.is_some() && pending.source == self.queue.source)
    }
}

fn read_database(connection: &Db, scope: &str, now_ms: i64) -> Result<Held, TursoStorageError> {
    let tables = driver::query(
        connection,
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'mutation_queue'",
        Vec::new(),
    )?;
    if tables.is_empty() {
        return Ok(Held::Unknown(0));
    }
    if !can_read_layers(connection, scope)? {
        let rows = driver::query(connection, "SELECT id FROM mutation_queue", Vec::new())?;
        return Ok(Held::Unknown(rows.len() as u64));
    }
    let marker = import_marker(connection)?;
    let mut held = HeldQueue {
        queue: SalvagedQueue {
            id: Uuid::now_v7(),
            source: metadata_record(connection, STORAGE_GENERATION_META_KEY)?,
            complete: marker.is_none_or(|marker| marker.complete),
            rounds: marker.map_or(1, |marker| marker.next_rounds(now_ms)),
            sequence: sequence(connection)?,
            rows: Vec::new(),
            shadows: Vec::new(),
            records: Vec::new(),
        },
        imported: marker.map(|marker| marker.id),
        dropped: 0,
        complete: true,
    };
    let mut local_keys = BTreeSet::new();
    let rows = driver::query_each(connection, QUEUE_SELECT, Vec::new(), |row| {
        let row = row.get_values().cloned().collect::<Vec<_>>();
        match binding_keys(&row) {
            Ok(keys) => {
                local_keys.extend(keys);
                held.queue.rows.push(row);
            }
            Err(_) => held.dropped += 1,
        }
        Ok(())
    });
    held.complete = rows.is_ok();
    if held.queue.is_empty() {
        return Ok(Held::Queue(held));
    }
    for key in [IDENTITY_META_KEY, AUTHORITY_META_KEY] {
        if let Some(value) = metadata_record(connection, key)? {
            held.queue
                .records
                .push((RecordKey::from_entity(&EntityKey(key.into()))?, value));
        }
    }
    let (aliases, complete) = aliases(connection, local_keys)?;
    held.queue.records.extend(aliases);
    held.complete &= complete;
    let owners = held
        .queue
        .rows
        .iter()
        .map(|row| required_i64(row, 0))
        .collect::<Result<HashSet<_>, _>>()?;
    // Projections only place a pending write in lists before it settles.
    held.queue.shadows = shadows(connection, &owners).unwrap_or_default();
    Ok(Held::Queue(held))
}

/// Whether this build reads the optimistic layers this database holds.
fn can_read_layers(connection: &Db, scope: &str) -> Result<bool, TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT key, value FROM meta WHERE key IN ('scope', 'namespace', 'storage_schema_version') ORDER BY key ASC",
        Vec::new(),
    )?;
    let [namespace, stored_scope, version] = rows.as_slice() else {
        return Ok(false);
    };
    let namespace = required_text(namespace, 1)?;
    Ok(required_text(stored_scope, 1)? == scope
        && required_text(version, 1)? == STORAGE_SCHEMA_VERSION.to_string()
        && (namespace == cache_namespace(scope)
            || MIGRATABLE_CACHE_FORMAT_VERSIONS
                .iter()
                .any(|version| namespace == cache_namespace_at(scope, *version))))
}

/// The local keys a valid queued write binds; an invalid one is an error.
fn binding_keys(row: &[Value]) -> Result<Vec<EntityKey<'static>>, TursoStorageError> {
    let optimistic = parse_queue_row(row)?.optimistic.ok_or_else(invariant)?;
    let source =
        decode_optimistic_source(&optimistic.optimistic_data_json).map_err(|_| invariant())?;
    Ok(source
        .identity_bindings
        .into_iter()
        .map(|binding| binding.local_key)
        .collect())
}

/// The identity metadata of the records these keys alias, along each chain,
/// and whether all of it could be read.
fn aliases(
    connection: &Db,
    keys: BTreeSet<EntityKey<'static>>,
) -> Result<(Vec<(RecordKey, Vec<u8>)>, bool), TursoStorageError> {
    let mut seen = BTreeSet::new();
    let mut pending = keys.into_iter().collect::<Vec<_>>();
    let mut records = Vec::new();
    let mut complete = true;
    while let Some(key) = pending.pop() {
        if !seen.insert(key.clone()) {
            continue;
        }
        let key = RecordKey::from_entity(&key)?;
        let Ok(value) = record(connection, &key) else {
            complete = false;
            continue;
        };
        let Some(mut record) = value.and_then(|value| decode_record(&value).ok()) else {
            continue;
        };
        pending.extend(identity::alias_target(&record).cloned());
        if identity::retain_metadata(&mut record) {
            records.push((key, encode_record(&record)));
        }
    }
    Ok((records, complete))
}

fn shadows(connection: &Db, owners: &HashSet<i64>) -> Result<Vec<Shadow>, TursoStorageError> {
    let mut facts = BTreeMap::<i64, [Vec<Vec<Value>>; 4]>::new();
    for (kind, sql) in SHADOW_FACT_SELECTS.into_iter().enumerate() {
        for mut row in driver::query(connection, sql, Vec::new())? {
            let document = required_i64(&row, 0)?;
            facts.entry(document).or_default()[kind].push(row.split_off(1));
        }
    }
    let mut shadows = Vec::new();
    for mut row in driver::query(connection, SHADOW_SELECT, Vec::new())? {
        let shadow = Shadow {
            owner: required_i64(&row, 1)?,
            facts: facts.remove(&required_i64(&row, 0)?).unwrap_or_default(),
            document: row.split_off(2),
        };
        if owners.contains(&shadow.owner) && shadow.is_valid() {
            shadows.push(shadow);
        }
    }
    Ok(shadows)
}

impl Shadow {
    /// What opening a database requires of one; see
    /// `validate_optimistic_shadow_consistency`.
    fn is_valid(&self) -> bool {
        self.check().is_ok()
    }

    fn check(&self) -> Result<(), TursoStorageError> {
        let document = &self.document;
        let state = OptimisticIndexDocumentState::try_from(required_i64(document, 3)?)?;
        let kind = nullable_i64(document, 4)?;
        match (state, kind) {
            (OptimisticIndexDocumentState::Incomplete, Some(kind)) => {
                projection_incomplete_kind(kind)?;
            }
            (
                OptimisticIndexDocumentState::Complete | OptimisticIndexDocumentState::Deleted,
                None,
            ) => {}
            _ => return Err(invariant()),
        }
        if state != OptimisticIndexDocumentState::Complete
            && self.facts[..UNCERTAIN_FACTS]
                .iter()
                .any(|facts| !facts.is_empty())
        {
            return Err(invariant());
        }
        let uncertain = self.facts[UNCERTAIN_FACTS]
            .iter()
            .map(|fact| required_text(fact, 0))
            .collect::<Result<Vec<_>, _>>()?;
        parse_optimistic_uncertainty(uncertain).map(|_| ())
    }
}

impl SalvagedQueue {
    /// Adds what `older` holds and this does not, or nothing when the two were
    /// queued by different accounts. Returns how many writes were left out.
    fn absorb(&mut self, older: SalvagedQueue) -> Result<u64, TursoStorageError> {
        if older.account() != self.account() {
            return Ok(older.len());
        }
        let older = older.renumbered_above(self.sequence)?;
        let mut current = HashSet::new();
        for row in &self.rows {
            current.insert(required_text(row, 1)?);
        }
        let mut left_out = BTreeSet::new();
        for row in older.rows {
            if current.contains(&required_text(&row, 1)?) {
                left_out.insert(required_i64(&row, 0)?);
            } else {
                self.rows.push(row);
            }
        }
        for shadow in older.shadows {
            let taken = self
                .shadows
                .iter()
                .any(|own| own.document.first() == shadow.document.first());
            if !taken && !left_out.contains(&shadow.owner) {
                self.shadows.push(shadow);
            }
        }
        for (key, value) in older.records {
            if !self.records.iter().any(|(own, _)| *own == key) {
                self.records.push((key, value));
            }
        }
        // The older writes have new IDs.
        self.complete = false;
        self.sequence = older.sequence;
        Ok(left_out.len() as u64)
    }
}

impl ImportMarker {
    fn next_rounds(self, now_ms: i64) -> u32 {
        if now_ms.saturating_sub(self.imported_at_ms) > IMPORT_SETTLE_MS {
            1
        } else {
            self.rounds.saturating_add(1)
        }
    }
}
