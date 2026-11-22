//! In-place upgrades of a database written at an older
//! [`STORAGE_SCHEMA_VERSION`].
//!
//! Each registered step upgrades version `from` to `from + 1` in one write
//! transaction that also advances `meta.storage_schema_version`. A process
//! stopped during an upgrade therefore leaves the last committed step behind,
//! and the next open resumes from there. The last step's transaction also runs
//! the frozen-schema checks every reopen runs, so an upgraded file must have
//! exactly the tables and indexes a fresh file has before the current version
//! is committed: a chain that would produce anything else rolls back and leaves
//! the file at the version before its last step. The browser hands that back to
//! the older build only when it is the version the file moved at, that is, when
//! no earlier step committed; a longer chain rejected at its last step is
//! discarded instead.
//!
//! Steps commit one at a time rather than the chain in one transaction because
//! Turso keeps a write transaction's dirty pages in memory until it commits,
//! and the browser's Wasm memory never shrinks: one transaction for 11 to 13
//! grew it to 301 MiB on a 320 MB cache, against 236 MiB for the larger step
//! alone.
//!
//! A version with no complete chain of steps, a newer version, and a failing
//! step are all classified for physical reset, as every version change was
//! before steps existed.
//!
//! A step's SQL is frozen when the step is registered: it must not use the
//! current schema constants, because a later version may change them while the
//! step must still produce exactly the version after its own.

use super::{
    HashMap, PredicateRecordKey, Profile, STORAGE_SCHEMA_VERSION, Token, Value, compatibility,
    facts_blob, invariant, load_index_facts, require_changed, required_i64, required_text, text,
    validate_frozen_schema,
};
use crate::driver::Db;
use crate::{TursoStorageError, driver};
use predicate_index::IndexDocument;

/// The body of one step. Tests build generated steps as closures.
pub(super) type StepFn = dyn Fn(&Db) -> Result<(), TursoStorageError> + Sync;

/// One upgrade from storage version `from` to `from + 1`.
pub(super) struct StorageUpgradeStep {
    pub(super) from: u32,
    /// Changes the schema and rows inside the step's transaction. The runner
    /// advances the stored version in the same transaction.
    pub(super) apply: &'static StepFn,
}

/// Registered steps, oldest first, contiguous, and ending at the current
/// version. Bumping [`STORAGE_SCHEMA_VERSION`] needs a step here; clearing the
/// list instead declares that every older file is reset.
const STEPS: &[StorageUpgradeStep] = &[
    StorageUpgradeStep {
        from: 11,
        apply: &upgrade_11_to_12,
    },
    StorageUpgradeStep {
        from: 12,
        apply: &upgrade_12_to_13,
    },
    StorageUpgradeStep {
        from: 13,
        apply: &upgrade_13_to_14,
    },
];

const _: () = assert!(
    steps_reach_current_version(),
    "STORAGE_SCHEMA_VERSION changed without an upgrade step: register one in \
     storage/migration.rs, or clear STEPS to declare that older files reset"
);

const fn steps_reach_current_version() -> bool {
    if STEPS.is_empty() {
        return true;
    }
    let mut index = 1;
    while index < STEPS.len() {
        if STEPS[index].from != STEPS[index - 1].from + 1 {
            return false;
        }
        index += 1;
    }
    STEPS[STEPS.len() - 1].from + 1 == STORAGE_SCHEMA_VERSION
}

/// The oldest storage version this build upgrades in place, if any.
#[must_use]
pub fn oldest_upgradable_storage_version() -> Option<u32> {
    STEPS.first().map(|step| step.from)
}

/// Whether a database written at storage `version` is upgraded in place by
/// this build instead of being reset.
#[must_use]
pub fn storage_version_upgradable(version: u32) -> bool {
    version < STORAGE_SCHEMA_VERSION
        && oldest_upgradable_storage_version().is_some_and(|oldest| oldest <= version)
}

/// Upgrades an existing database to the current storage version. Returns the
/// version it was written at when it was older.
pub(super) fn upgrade(connection: &Db) -> Result<Option<u32>, TursoStorageError> {
    run_steps(
        connection,
        STEPS,
        STORAGE_SCHEMA_VERSION,
        validate_frozen_schema,
    )
}

/// Runs `steps`, a contiguous chain ending at `current - 1`, from the stored
/// version, running `validate` inside the last step's transaction. Separate
/// from [`upgrade`] so tests can run generated chains against their own
/// schema.
pub(super) fn run_steps(
    connection: &Db,
    steps: &[StorageUpgradeStep],
    current: u32,
    validate: impl Fn(&Db) -> Result<(), TursoStorageError>,
) -> Result<Option<u32>, TursoStorageError> {
    let stored = stored_version(connection)?;
    if stored == current {
        return Ok(None);
    }
    let upgradable = stored < current && steps.first().is_some_and(|oldest| oldest.from <= stored);
    if !upgradable {
        return Err(compatibility());
    }
    #[cfg(any(test, feature = "migration-test-hooks"))]
    let mut committed = 0_u32;
    for step in steps.iter().filter(|step| step.from >= stored) {
        let target = step.from + 1;
        driver::write_transaction(connection, || {
            (step.apply)(connection)?;
            driver::execute(
                connection,
                "UPDATE meta SET value = ?1 WHERE key = 'storage_schema_version'",
                vec![text(&target.to_string())],
            )?;
            if target == current {
                validate(connection)?;
            }
            Ok(())
        })
        .map_err(TursoStorageError::initialization)?;
        #[cfg(any(test, feature = "migration-test-hooks"))]
        {
            committed += 1;
            if test_hooks::stop_after(committed) {
                return Err(TursoStorageError::Database);
            }
        }
    }
    Ok(Some(stored))
}

/// The storage version a database says it was written at, or `None` when it
/// does not say so readably. Never writes.
#[cfg(any(test, target_arch = "wasm32"))]
pub(super) fn stored_storage_version(connection: &Db) -> Option<u32> {
    stored_version(connection).ok()
}

fn stored_version(connection: &Db) -> Result<u32, TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT value FROM meta WHERE key = 'storage_schema_version'",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = rows.as_slice() else {
        return Err(compatibility());
    };
    required_text(row, 0)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or_else(compatibility)
}

/// Storage 12 covers search browsing with the text and hash columns and adds
/// the partial contact payload index; no table or row changed.
pub(super) const UPGRADE_11_TO_12: [&str; 3] = [
    "DROP INDEX search_documents_browse_idx",
    "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id, search_text, source_hash)",
    "CREATE INDEX records_contacts_cover_idx ON records (__typename, id, value) WHERE __typename = 'GraphqlContact'",
];

fn upgrade_11_to_12(connection: &Db) -> Result<(), TursoStorageError> {
    for sql in UPGRADE_11_TO_12 {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

/// Storage 13 keeps each complete authoritative document's facts as one blob
/// in `index_document_facts`, so the authority window tests a candidate's
/// predicate by reading one row. Storage 12 kept facts only in the fact
/// tables, which stay, so the step creates the table and fills it from them.
/// Records, queued writes, optimistic layers and their projections are kept.
pub(super) const UPGRADE_12_TO_13_TABLE: &str = "CREATE TABLE index_document_facts (document_id INTEGER PRIMARY KEY, facts BLOB NOT NULL, FOREIGN KEY (document_id) REFERENCES index_documents(id) ON DELETE CASCADE)";

/// Documents whose facts the 12 to 13 step reads and writes back together.
const FACTS_UPGRADE_BATCH: i64 = 512;

/// Encodes with the blob format of storage 13 (`facts_blob` version 1). A
/// later blob format needs its own storage version and a step that rewrites
/// every blob, which runs after this one.
fn upgrade_12_to_13(connection: &Db) -> Result<(), TursoStorageError> {
    driver::execute(connection, UPGRADE_12_TO_13_TABLE, Vec::new())?;
    let mut documents_after = driver::prepare(
        connection,
        "SELECT id, record_key, profile, partition FROM index_documents WHERE id >= ?1 AND state = 0 ORDER BY id LIMIT ?2",
    )?;
    let mut insert = driver::prepare(
        connection,
        "INSERT INTO index_document_facts (document_id, facts) VALUES (?1, ?2)",
    )?;
    // Every id is a valid row id, i64::MIN and i64::MAX included.
    let mut from = Some(i64::MIN);
    while let Some(start) = from {
        let rows = driver::query_prepared(
            &mut documents_after,
            vec![Value::from_i64(start), Value::from_i64(FACTS_UPGRADE_BATCH)],
        )?;
        let Some(last) = rows.last() else {
            break;
        };
        from = required_i64(last, 0)?.checked_add(1);
        let mut by_id = HashMap::with_capacity(rows.len());
        let mut documents = HashMap::with_capacity(rows.len());
        for row in &rows {
            let record_key =
                PredicateRecordKey::new(required_text(row, 1)?).map_err(|_| invariant())?;
            by_id.insert(required_i64(row, 0)?, record_key.clone());
            documents.insert(
                record_key.clone(),
                IndexDocument {
                    record_key,
                    profile: Profile::new(
                        Token::new(required_text(row, 2)?).map_err(|_| invariant())?,
                    ),
                    partition: Token::new(required_text(row, 3)?).map_err(|_| invariant())?,
                    exact_facts: Vec::new(),
                    integer_facts: Vec::new(),
                    sort_facts: Vec::new(),
                },
            );
        }
        load_index_facts(connection, &by_id, &mut documents)?;
        for (id, record_key) in &by_id {
            let document = documents.get(record_key).ok_or_else(invariant)?;
            require_changed(
                driver::execute_prepared(
                    &mut insert,
                    vec![
                        Value::from_i64(*id),
                        Value::from_blob(facts_blob::encode(document)),
                    ],
                )?,
                1,
            )?;
        }
    }
    Ok(())
}

/// Storage 14 stores each search text once. Storage 13 kept every column of a
/// search document in `search_documents` and again in its covering browse
/// index. Storage 14 moves the rows to `search_rows`, where a bucket's rows
/// share a row id range (its slot from `search_slots`, shifted left 44 bits,
/// plus a sequence number), so a typed search reads one range of the table and
/// the browse index keeps only the order. The step copies every row, in the old
/// row id order within each bucket, then drops the old table. The rows are a
/// projection of records, so nothing else changes.
pub(super) const UPGRADE_13_TO_14_TABLES: [&str; 2] = [
    "CREATE TABLE search_slots (slot INTEGER PRIMARY KEY, profile INTEGER NOT NULL, bucket TEXT NOT NULL)",
    "CREATE TABLE search_rows (slot INTEGER NOT NULL, profile INTEGER NOT NULL, __typename TEXT NOT NULL, id TEXT NOT NULL, search_text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY (profile, __typename, id))",
];
pub(super) const UPGRADE_13_TO_14_INDEX: &str =
    "CREATE INDEX search_rows_browse_idx ON search_rows(slot, timestamp_ms DESC, __typename, id)";

/// Search documents the 13 to 14 step copies together.
const SEARCH_UPGRADE_BATCH: i64 = 512;

/// The stored number of each storage 13 profile name.
fn storage_14_profile(name: &str) -> Result<i64, TursoStorageError> {
    match name {
        "quick-access-v1" => Ok(1),
        _ => Err(invariant()),
    }
}

fn upgrade_13_to_14(connection: &Db) -> Result<(), TursoStorageError> {
    for sql in UPGRADE_13_TO_14_TABLES {
        driver::execute(connection, sql, Vec::new())?;
    }
    let mut slots = HashMap::new();
    let mut insert_slot = driver::prepare(
        connection,
        "INSERT INTO search_slots (slot, profile, bucket) VALUES (?1, ?2, ?3)",
    )?;
    for row in driver::query(
        connection,
        "SELECT DISTINCT profile, bucket FROM search_documents ORDER BY profile, bucket",
        Vec::new(),
    )? {
        let profile = storage_14_profile(&required_text(&row, 0)?)?;
        let bucket = required_text(&row, 1)?;
        let slot = i64::try_from(slots.len() + 1).map_err(|_| invariant())?;
        // Slots run from 1 to 2^19 - 1.
        if slot >= 1 << 19 {
            return Err(invariant());
        }
        require_changed(
            driver::execute_prepared(
                &mut insert_slot,
                vec![
                    Value::from_i64(slot),
                    Value::from_i64(profile),
                    text(&bucket),
                ],
            )?,
            1,
        )?;
        slots.insert((profile, bucket), (slot, slot << 44));
    }
    let mut rows_after = driver::prepare(
        connection,
        "SELECT rowid, profile, __typename, id, bucket, search_text, timestamp_ms, source_hash FROM search_documents WHERE rowid >= ?1 ORDER BY rowid LIMIT ?2",
    )?;
    let mut insert_row = driver::prepare(
        connection,
        "INSERT INTO search_rows (rowid, slot, profile, __typename, id, search_text, timestamp_ms, source_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    // Every id is a valid row id, i64::MIN and i64::MAX included.
    let mut from = Some(i64::MIN);
    while let Some(start) = from {
        let rows = driver::query_prepared(
            &mut rows_after,
            vec![Value::from_i64(start), Value::from_i64(SEARCH_UPGRADE_BATCH)],
        )?;
        let Some(last) = rows.last() else {
            break;
        };
        from = required_i64(last, 0)?.checked_add(1);
        for row in &rows {
            let profile = storage_14_profile(&required_text(row, 1)?)?;
            let (slot, next) = slots
                .get_mut(&(profile, required_text(row, 4)?))
                .ok_or_else(invariant)?;
            let rowid = *next;
            // A slot holds 2^44 row ids.
            if rowid >> 44 != *slot {
                return Err(invariant());
            }
            *next += 1;
            require_changed(
                driver::execute_prepared(
                    &mut insert_row,
                    vec![
                        Value::from_i64(rowid),
                        Value::from_i64(*slot),
                        Value::from_i64(profile),
                        Value::from_text(required_text(row, 2)?),
                        Value::from_text(required_text(row, 3)?),
                        Value::from_text(required_text(row, 5)?),
                        Value::from_i64(required_i64(row, 6)?),
                        Value::from_text(required_text(row, 7)?),
                    ],
                )?,
                1,
            )?;
        }
    }
    driver::execute(connection, "DROP TABLE search_documents", Vec::new())?;
    driver::execute(connection, UPGRADE_13_TO_14_INDEX, Vec::new())?;
    Ok(())
}

/// Hooks that stop an upgrade between steps, for tests and the differential
/// fuzzer. Not part of the production build.
#[cfg(any(test, feature = "migration-test-hooks"))]
pub mod test_hooks {
    use super::super::{
        QUICK_ACCESS_PROJECTION_VERSION_KEY, TursoStorage, page_retention, people_sql, text,
    };
    use crate::driver::Db;
    use crate::{TursoStorageError, driver};
    use cache_core::people::sql::projection;
    use std::cell::Cell;

    /// Derived state a storage 11 build had not reached yet, which opening a
    /// file it left rebuilds from the retained records.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Storage11DerivedState {
        /// Quick Access projection 4.
        QuickAccessProjection,
        /// Page retention 1.
        PageRetention,
        /// No local people facts and no stamp for them.
        PeopleFacts,
    }

    impl Storage11DerivedState {
        /// Every part, in the order an open rebuilds them.
        pub const ALL: [Self; 3] = [
            Self::QuickAccessProjection,
            Self::PageRetention,
            Self::PeopleFacts,
        ];
    }

    /// The inverse of the 13 to 14 step: search rows back in one table whose
    /// covering browse index repeats them.
    const STORAGE_13_SEARCH: [&str; 5] = [
        "CREATE TABLE search_documents (profile TEXT NOT NULL, __typename TEXT NOT NULL, id TEXT NOT NULL, bucket TEXT NOT NULL, search_text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY (profile, __typename, id))",
        "INSERT INTO search_documents (profile, __typename, id, bucket, search_text, timestamp_ms, source_hash) SELECT CASE r.profile WHEN 1 THEN 'quick-access-v1' END, r.__typename, r.id, s.bucket, r.search_text, r.timestamp_ms, r.source_hash FROM search_rows AS r JOIN search_slots AS s ON s.slot = r.slot ORDER BY r.rowid",
        "DROP TABLE search_rows",
        "DROP TABLE search_slots",
        "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id, search_text, source_hash)",
    ];

    /// Rewrites a database of this build as a storage 13 build left it: the
    /// inverse of the 13 to 14 step, so the next open runs that step alone.
    pub fn rewrite_as_storage_13(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            for sql in STORAGE_13_SEARCH.into_iter().chain([
                "UPDATE meta SET value = '13' WHERE key = 'storage_schema_version'",
            ]) {
                driver::execute(&connection, sql, Vec::new())?;
            }
            Ok(())
        }))
    }

    /// Rewrites a database of this build as a storage 12 build left it: the
    /// inverse of the 12 to 13 and 13 to 14 steps, so the next open runs them.
    pub fn rewrite_as_storage_12(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            for sql in STORAGE_13_SEARCH.into_iter().chain([
                "DROP TABLE index_document_facts",
                "UPDATE meta SET value = '12' WHERE key = 'storage_schema_version'",
            ]) {
                driver::execute(&connection, sql, Vec::new())?;
            }
            Ok(())
        }))
    }

    /// Rewrites a database of this build as the last storage 11 build left
    /// it, so a test can open it as a file an older build left behind: the
    /// inverse of the 11 to 12, 12 to 13 and 13 to 14 steps, plus every part of
    /// [`Storage11DerivedState`], so opening the rewrite rebuilds all three, as
    /// opening a real storage 11 file does. Page compaction then finds pages
    /// already in the newer shape, so the rewrite costs a lower bound of a real
    /// file's first open.
    pub fn rewrite_as_storage_11(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            for sql in STORAGE_13_SEARCH.into_iter().chain([
                "DROP TABLE index_document_facts",
                "DROP INDEX records_contacts_cover_idx",
                "DROP INDEX search_documents_browse_idx",
                "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id)",
                "UPDATE meta SET value = '11' WHERE key = 'storage_schema_version'",
            ]) {
                driver::execute(&connection, sql, Vec::new())?;
            }
            for part in Storage11DerivedState::ALL {
                rewind(&connection, part)?;
            }
            Ok(())
        }))
    }

    /// Rewinds one part of the derived state to what a storage 11 build left,
    /// keeping the storage version, so an open measures that part's rebuild
    /// alone.
    pub fn rewind_derived_state(
        storage: &mut TursoStorage,
        part: Storage11DerivedState,
    ) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            rewind(&connection, part)
        }))
    }

    fn rewind(connection: &Db, part: Storage11DerivedState) -> Result<(), TursoStorageError> {
        let set = |key: &str, value: &str| {
            driver::execute(
                connection,
                "UPDATE meta SET value = ?2 WHERE key = ?1",
                vec![text(key), text(value)],
            )
            .map(drop)
        };
        match part {
            Storage11DerivedState::QuickAccessProjection => {
                set(QUICK_ACCESS_PROJECTION_VERSION_KEY, "4")
            }
            Storage11DerivedState::PageRetention => set(page_retention::VERSION_KEY, "1"),
            Storage11DerivedState::PeopleFacts => {
                driver::execute(
                    connection,
                    "DELETE FROM meta WHERE key = ?",
                    vec![text(people_sql::VERSION_KEY)],
                )?;
                driver::execute(
                    connection,
                    "DELETE FROM index_documents WHERE profile = ?",
                    vec![text(projection::PROFILE)],
                )
                .map(drop)
            }
        }
    }

    /// Adds a table no storage version has, so the next open of this
    /// database must reset it.
    pub fn add_unknown_table(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            driver::execute(
                &connection,
                "CREATE TABLE unknown_to_every_version (value INTEGER)",
                Vec::new(),
            )?;
            Ok(())
        }))
    }

    /// Removes every queued write's optimistic layer, so the next open of
    /// this database finds its queue inconsistent and must reset it, after
    /// any upgrade step has committed. Only cache-wasm's browser tests call
    /// it, through the feature.
    #[cfg(feature = "migration-test-hooks")]
    pub fn drop_optimistic_layers(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            driver::execute(&connection, "DELETE FROM optimistic_layers", Vec::new())?;
            Ok(())
        }))
    }

    /// Removes the row that says which storage version wrote this database,
    /// so no open can tell, and the next open of it must reset it. Only
    /// cache-wasm's browser tests call it, through the feature.
    #[cfg(feature = "migration-test-hooks")]
    pub fn forget_storage_version(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            driver::execute(
                &connection,
                "DELETE FROM meta WHERE key = 'storage_schema_version'",
                Vec::new(),
            )?;
            Ok(())
        }))
    }

    thread_local! {
        static STOP_AFTER: Cell<Option<u32>> = const { Cell::new(None) };
        static STOPPED: Cell<bool> = const { Cell::new(false) };
    }

    /// Makes later opens on this thread fail, without asking for a reset, right
    /// after committing `steps` upgrade steps, as a process stopped there would.
    /// `None` turns the hook off.
    pub fn interrupt_after_steps(steps: Option<u32>) {
        STOP_AFTER.with(|stop| stop.set(steps));
    }

    /// Whether an open on this thread was stopped by the hook since the last
    /// call; clears the flag.
    #[must_use]
    pub fn take_interrupted() -> bool {
        STOPPED.with(|stopped| stopped.replace(false))
    }

    pub(super) fn stop_after(committed: u32) -> bool {
        let stop = STOP_AFTER.with(Cell::get) == Some(committed);
        if stop {
            STOPPED.with(|stopped| stopped.set(true));
        }
        stop
    }
}
