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
//! the file at the version before its last step, which the browser can still
//! hand back to the build that wrote it.
//!
//! A version with no complete chain of steps, a newer version, and a failing
//! step are all classified for physical reset, as every version change was
//! before steps existed.
//!
//! A step's SQL is frozen when the step is registered: it must not use the
//! current schema constants, because a later version may change them while the
//! step must still produce exactly the version after its own.

use super::{STORAGE_SCHEMA_VERSION, compatibility, required_text, text, validate_frozen_schema};
use crate::{TursoStorageError, driver};
use std::sync::Arc;
use turso_core::Connection;

/// The body of one step. Tests build generated steps as closures.
pub(super) type StepFn = dyn Fn(&Arc<Connection>) -> Result<(), TursoStorageError> + Sync;

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
const STEPS: &[StorageUpgradeStep] = &[StorageUpgradeStep {
    from: 11,
    apply: &upgrade_11_to_12,
}];

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
pub(super) fn upgrade(connection: &Arc<Connection>) -> Result<Option<u32>, TursoStorageError> {
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
    connection: &Arc<Connection>,
    steps: &[StorageUpgradeStep],
    current: u32,
    validate: impl Fn(&Arc<Connection>) -> Result<(), TursoStorageError>,
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
pub(super) fn stored_storage_version(connection: &Arc<Connection>) -> Option<u32> {
    stored_version(connection).ok()
}

fn stored_version(connection: &Arc<Connection>) -> Result<u32, TursoStorageError> {
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

fn upgrade_11_to_12(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    for sql in UPGRADE_11_TO_12 {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

/// Hooks that stop an upgrade between steps, for tests and the differential
/// fuzzer. Not part of the production build.
#[cfg(any(test, feature = "migration-test-hooks"))]
pub mod test_hooks {
    use super::super::{
        QUICK_ACCESS_PROJECTION_VERSION_KEY, TursoStorage, page_retention, people_sql, text,
    };
    use super::{Arc, Connection};
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

    /// Rewrites a database of this build as the last storage 11 build left
    /// it, so a test can open it as a file an older build left behind: the
    /// inverse of the 11 to 12 step, plus every part of
    /// [`Storage11DerivedState`], so opening the rewrite rebuilds all three, as
    /// opening a real storage 11 file does. Page compaction then finds pages
    /// already in the newer shape, so the rewrite costs a lower bound of a real
    /// file's first open.
    pub fn rewrite_as_storage_11(storage: &mut TursoStorage) -> Result<(), TursoStorageError> {
        storage.require_healthy()?;
        let connection = storage.connection();
        storage.latch_result(driver::write_transaction(&connection, || {
            for sql in [
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

    fn rewind(
        connection: &Arc<Connection>,
        part: Storage11DerivedState,
    ) -> Result<(), TursoStorageError> {
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
