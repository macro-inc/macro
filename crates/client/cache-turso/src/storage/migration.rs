//! In-place upgrades of a database written at an older
//! [`STORAGE_SCHEMA_VERSION`].
//!
//! Each registered step upgrades version `from` to `from + 1` in one write
//! transaction that also advances `meta.storage_schema_version`. A process
//! stopped during an upgrade therefore leaves the last committed step behind,
//! and the next open resumes from there. The last step's transaction also runs
//! the frozen-schema checks, so an upgraded file must have exactly the tables
//! and indexes a fresh file has before the current version is committed: a
//! chain that would produce anything else rolls back and leaves the file at the
//! version before its last step. Later opens then find a fresh file's schema
//! digest and skip those checks.
//!
//! A version with no complete chain of steps, a newer version, and a failing
//! step are all classified for physical reset, as every version change was
//! before steps existed.
//!
//! Only native files reach a step: a browser database's name embeds the
//! storage version, so a browser build opens a new database instead
//! (`cache_core::codec::cache_database_name`), and resets an older version
//! found under its own name (`OlderStorage::Reset`).
//!
//! A step's SQL is frozen when the step is registered: it must not use the
//! current schema constants, because a later version may change them while the
//! step must still produce exactly the version after its own.

use super::{STORAGE_SCHEMA_VERSION, compatibility, required_text, text, validate_frozen_schema};
use crate::TursoStorageError;
use crate::driver::{self, Db};

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
#[cfg(test)]
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

/// Storage 13 stores the GraphQL schema the records were written under. The
/// step leaves the table empty: adopting the build's schema after the open
/// sorts the records against the schema that wrote them
/// (`storage/schema_store.rs`).
pub(super) const UPGRADE_12_TO_13: [&str; 1] = [
    "CREATE TABLE cache_schema (slot INTEGER PRIMARY KEY, hash TEXT NOT NULL, incoming_hash TEXT NOT NULL, artifact BLOB NOT NULL)",
];

fn upgrade_12_to_13(connection: &Db) -> Result<(), TursoStorageError> {
    for sql in UPGRADE_12_TO_13 {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

/// Storage 14 adds the channel timeline's rows, fetched stretches and sync
/// state, all empty: no build before it stored any.
pub(super) const UPGRADE_13_TO_14: [&str; 5] = [
    "CREATE TABLE channel_timeline (record_key TEXT PRIMARY KEY, channel_id TEXT NOT NULL, scope TEXT NOT NULL, sort_key TEXT NOT NULL, hidden INTEGER NOT NULL)",
    "CREATE INDEX channel_timeline_scan_idx ON channel_timeline(scope, hidden, sort_key, record_key)",
    "CREATE INDEX channel_timeline_channel_idx ON channel_timeline(channel_id, record_key)",
    "CREATE TABLE channel_coverage (channel_id TEXT NOT NULL, scope TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, PRIMARY KEY (channel_id, scope, start))",
    "CREATE TABLE channel_sync (channel_id TEXT PRIMARY KEY, seq INTEGER, touched_at_ms INTEGER NOT NULL)",
];

fn upgrade_13_to_14(connection: &Db) -> Result<(), TursoStorageError> {
    for sql in UPGRADE_13_TO_14 {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

/// Hooks that stop an upgrade between steps, for tests and the differential
/// fuzzer. Not part of the production build.
#[cfg(any(test, feature = "migration-test-hooks"))]
pub mod test_hooks {
    use super::super::{
        QUICK_ACCESS_PROJECTION_VERSION_KEY, TursoStorage, channel_timeline, page_retention,
        people_sql, text,
    };
    use super::Db;
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

    /// Drops everything the 13 to 14 step and the open after it add.
    fn drop_storage_14(connection: &Db) -> Result<(), TursoStorageError> {
        for table in channel_timeline::TABLES {
            driver::execute(connection, &format!("DROP TABLE {table}"), Vec::new())?;
        }
        driver::execute(
            connection,
            "DELETE FROM meta WHERE key = ?1",
            vec![text(channel_timeline::PROJECTION_VERSION_KEY)],
        )
        .map(drop)
    }

    /// Rewrites a database of this build as the last storage 13 build left
    /// it: the inverse of the 13 to 14 step.
    pub fn rewrite_as_storage_13(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            drop_storage_14(&connection)?;
            driver::execute(
                &connection,
                "UPDATE meta SET value = '13' WHERE key = 'storage_schema_version'",
                Vec::new(),
            )
            .map(drop)
        }))
    }

    /// Rewrites a database of this build as the last storage 12 build left
    /// it: the inverse of the 12 to 14 steps.
    pub fn rewrite_as_storage_12(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            drop_storage_14(&connection)?;
            for sql in [
                "DROP TABLE cache_schema",
                "UPDATE meta SET value = '12' WHERE key = 'storage_schema_version'",
            ] {
                driver::execute(&connection, sql, Vec::new())?;
            }
            Ok(())
        }))
    }

    /// Rewrites a database of this build as the last storage 11 build left
    /// it, so a test can open it as a file an older build left behind: the
    /// inverse of the 11 to 14 steps, plus every part of
    /// [`Storage11DerivedState`], so opening the rewrite rebuilds all three, as
    /// opening a real storage 11 file does. Page compaction then finds pages
    /// already in the newer shape, so the rewrite costs a lower bound of a real
    /// file's first open.
    pub fn rewrite_as_storage_11(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            drop_storage_14(&connection)?;
            for sql in [
                "DROP TABLE cache_schema",
                "DROP INDEX records_contacts_cover_idx",
                "DROP INDEX search_documents_browse_idx",
                "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id)",
                "UPDATE meta SET value = '11' WHERE key = 'storage_schema_version'",
            ] {
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
