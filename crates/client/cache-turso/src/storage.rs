use crate::driver;
use crate::key::RecordKey;
use crate::{PhysicalResetReason, TursoStorageError};
use cache_core::codec::{
    cache_namespace, decode_record, decode_record_updates, encode_record, encode_record_updates,
};
use cache_core::predicate::{
    OptimisticShadowReconciliation, PredicateIndexStorage, PredicateQueryResult,
    ProjectionIncompleteKind, ProjectionMutation, ProjectionState,
};
use cache_core::queue::{
    ClaimedMutation, MutationClaimRequest, MutationClaimToken, MutationId, MutationRequest,
    NewQueuedMutation, PersistedOptimisticLayer, QueuedMutation, StoredMutation,
};
use cache_core::search::{SearchCursor, SearchDocument, SearchProfile, project_search_documents};
use cache_core::store::{QueueDiagnostics, QueueDiagnosticsAvailability, Storage};
use cache_core::value::{EntityKey, Record};
use predicate_index::{
    EffectiveOptimisticProjection, OptimisticProjectionState, OptimisticUncertainty,
    PendingOptimisticProjection, PredicateExpr, Profile, RangeBound,
    RecordKey as PredicateRecordKey, SortDirection, Token, ValidatedIndexQuery,
};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use turso_core::{Connection, Numeric, Value};

#[cfg(not(target_arch = "wasm32"))]
use std::io::ErrorKind;
#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};
#[cfg(not(target_arch = "wasm32"))]
use std::sync::Mutex;
#[cfg(not(target_arch = "wasm32"))]
use std::sync::atomic::AtomicU64;
#[cfg(not(target_arch = "wasm32"))]
use turso_core::{Database, IO, MemoryIO, OpenOptions, PlatformIO, SqliteDialect};
#[cfg(target_arch = "wasm32")]
use turso_opfs::{
    CloseFailure, ClosedSession, ConnectedOpfsSession, OpenDisposition, OpfsError, OpfsOwner,
    ResetFailure,
};

/// Frozen storage schema version, independent of cache postcard versions.
pub const STORAGE_SCHEMA_VERSION: u32 = 10;

/// Coarse outcome of validating a Turso database.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TursoStorageOpenOutcome {
    /// Existing compatible storage was validated and preserved.
    OpenedExisting,
    /// A fresh physical database was initialized.
    OpenedNew,
}

const CREATE_SCHEMA: [&str; 27] = [
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    "CREATE TABLE records (__typename TEXT NOT NULL, id TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (__typename, id))",
    "CREATE TABLE search_documents (profile TEXT NOT NULL, __typename TEXT NOT NULL, id TEXT NOT NULL, bucket TEXT NOT NULL, search_text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY (profile, __typename, id))",
    "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id)",
    "CREATE TABLE mutation_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL, operation_name TEXT, variables_json TEXT NOT NULL, identity TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at_ms INTEGER, lease_owner TEXT, lease_generation INTEGER NOT NULL DEFAULT 0, lease_expires_at_ms INTEGER, last_error TEXT, created_at_ms INTEGER NOT NULL)",
    "CREATE INDEX mutation_queue_created_at_ms_idx ON mutation_queue(created_at_ms)",
    "CREATE TABLE optimistic_layers (mutation_id INTEGER PRIMARY KEY, optimistic_data_json TEXT NOT NULL, normalized_updates BLOB NOT NULL, FOREIGN KEY (mutation_id) REFERENCES mutation_queue(id) ON DELETE CASCADE)",
    "CREATE TABLE index_documents (id INTEGER PRIMARY KEY, record_key TEXT NOT NULL, profile TEXT NOT NULL, partition TEXT NOT NULL, state INTEGER NOT NULL)",
    "CREATE UNIQUE INDEX index_documents_record_key_idx ON index_documents(record_key)",
    "CREATE INDEX index_documents_scope_idx ON index_documents(profile, partition, state, id)",
    "CREATE TABLE exact_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (document_id, attribute, value), FOREIGN KEY (document_id) REFERENCES index_documents(id) ON DELETE CASCADE)",
    "CREATE INDEX exact_facts_lookup_idx ON exact_facts(attribute, value, document_id)",
    "CREATE TABLE integer_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (document_id, attribute, value), FOREIGN KEY (document_id) REFERENCES index_documents(id) ON DELETE CASCADE)",
    "CREATE INDEX integer_facts_lookup_idx ON integer_facts(attribute, value, document_id)",
    "CREATE TABLE sort_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (document_id, attribute), FOREIGN KEY (document_id) REFERENCES index_documents(id) ON DELETE CASCADE)",
    "CREATE INDEX sort_facts_lookup_idx ON sort_facts(attribute, value, document_id)",
    "CREATE TABLE optimistic_index_documents (id INTEGER PRIMARY KEY, owner_mutation_id INTEGER NOT NULL, record_key TEXT NOT NULL, profile TEXT NOT NULL, partition TEXT NOT NULL, state INTEGER NOT NULL, incomplete_kind INTEGER, FOREIGN KEY (owner_mutation_id) REFERENCES optimistic_layers(mutation_id) ON DELETE CASCADE)",
    "CREATE UNIQUE INDEX optimistic_index_documents_record_key_idx ON optimistic_index_documents(record_key)",
    "CREATE INDEX optimistic_index_documents_owner_idx ON optimistic_index_documents(owner_mutation_id, id)",
    "CREATE INDEX optimistic_index_documents_scope_idx ON optimistic_index_documents(profile, partition, state, id)",
    "CREATE TABLE optimistic_exact_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (document_id, attribute, value), FOREIGN KEY (document_id) REFERENCES optimistic_index_documents(id) ON DELETE CASCADE)",
    "CREATE TABLE optimistic_integer_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (document_id, attribute, value), FOREIGN KEY (document_id) REFERENCES optimistic_index_documents(id) ON DELETE CASCADE)",
    "CREATE TABLE optimistic_sort_facts (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (document_id, attribute), FOREIGN KEY (document_id) REFERENCES optimistic_index_documents(id) ON DELETE CASCADE)",
    "CREATE TABLE optimistic_uncertain_attributes (document_id INTEGER NOT NULL, attribute TEXT NOT NULL, PRIMARY KEY (document_id, attribute), FOREIGN KEY (document_id) REFERENCES optimistic_index_documents(id) ON DELETE CASCADE)",
    "CREATE INDEX optimistic_exact_facts_lookup_idx ON optimistic_exact_facts(attribute, value, document_id)",
    "CREATE INDEX optimistic_integer_facts_lookup_idx ON optimistic_integer_facts(attribute, value, document_id)",
    "CREATE INDEX optimistic_sort_facts_lookup_idx ON optimistic_sort_facts(attribute, value, document_id)",
];
const RECORD_GET: &str = "SELECT value FROM records WHERE __typename = ?1 AND id = ?2";
const RECORD_UPSERT: &str = "INSERT INTO records (__typename, id, value) VALUES (?1, ?2, ?3) ON CONFLICT (__typename, id) DO UPDATE SET value = excluded.value";
const RECORD_DELETE: &str = "DELETE FROM records WHERE __typename = ?1 AND id = ?2";
const SEARCH_DELETE: &str = "DELETE FROM search_documents WHERE __typename = ?1 AND id = ?2";
const SEARCH_UPSERT: &str = "INSERT INTO search_documents (profile, __typename, id, bucket, search_text, timestamp_ms, source_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT (profile, __typename, id) DO UPDATE SET bucket = excluded.bucket, search_text = excluded.search_text, timestamp_ms = excluded.timestamp_ms, source_hash = excluded.source_hash";
const SEARCH_LOAD: &str = "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash FROM search_documents WHERE profile = ?1";
const SEARCH_BROWSE: &str = "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash FROM search_documents INDEXED BY search_documents_browse_idx WHERE profile = ?1 AND bucket = ?2 ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?3";
const SEARCH_BROWSE_AFTER: &str = "SELECT __typename, id, bucket, search_text, timestamp_ms, source_hash FROM search_documents INDEXED BY search_documents_browse_idx WHERE profile = ?1 AND bucket = ?2 AND (timestamp_ms < ?3 OR (timestamp_ms = ?3 AND (__typename > ?4 OR (__typename = ?4 AND id > ?5)))) ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?6";
const INDEX_DOCUMENT_UPSERT: &str = "INSERT INTO index_documents (record_key, profile, partition, state) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (record_key) DO UPDATE SET profile = excluded.profile, partition = excluded.partition, state = excluded.state RETURNING id";
const INDEX_DOCUMENT_ID: &str = "SELECT id FROM index_documents WHERE record_key = ?1";
const INDEX_DOCUMENT_DELETE: &str = "DELETE FROM index_documents WHERE record_key = ?1";
const INDEX_FACTS_DELETE: [&str; 3] = [
    "DELETE FROM exact_facts WHERE document_id = ?1",
    "DELETE FROM integer_facts WHERE document_id = ?1",
    "DELETE FROM sort_facts WHERE document_id = ?1",
];
const EXACT_FACT_INSERT: &str =
    "INSERT INTO exact_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const INTEGER_FACT_INSERT: &str =
    "INSERT INTO integer_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const SORT_FACT_INSERT: &str =
    "INSERT INTO sort_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const QUEUE_INSERT: &str = "INSERT INTO mutation_queue (query, operation_name, variables_json, identity, attempt_count, next_attempt_at_ms, lease_owner, lease_generation, lease_expires_at_ms, last_error, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)";
const LAYER_INSERT: &str = "INSERT INTO optimistic_layers (mutation_id, optimistic_data_json, normalized_updates) VALUES (?1, ?2, ?3)";
const QUEUE_SELECT: &str = "SELECT m.id, m.query, m.operation_name, m.variables_json, m.identity, m.attempt_count, m.next_attempt_at_ms, m.lease_owner, m.lease_generation, m.lease_expires_at_ms, m.last_error, m.created_at_ms, o.optimistic_data_json, o.normalized_updates FROM mutation_queue AS m LEFT JOIN optimistic_layers AS o ON o.mutation_id = m.id ORDER BY m.id ASC";
const QUEUE_HEAD_SELECT: &str = "SELECT m.id, m.query, m.operation_name, m.variables_json, m.identity, m.attempt_count, m.next_attempt_at_ms, m.lease_owner, m.lease_generation, m.lease_expires_at_ms, m.last_error, m.created_at_ms, o.optimistic_data_json, o.normalized_updates FROM mutation_queue AS m LEFT JOIN optimistic_layers AS o ON o.mutation_id = m.id ORDER BY m.id ASC LIMIT 1";
const ORPHAN_LAYER_SELECT: &str = "SELECT o.mutation_id FROM optimistic_layers AS o LEFT JOIN mutation_queue AS m ON m.id = o.mutation_id WHERE m.id IS NULL LIMIT 1";
const ANY_LAYER_SELECT: &str = "SELECT mutation_id FROM optimistic_layers LIMIT 1";
const CLAIM_SELECT: &str = "SELECT lease_owner, lease_generation FROM mutation_queue WHERE id = ?1";
const REQUIRE_LAYER_SELECT: &str = "SELECT 1 FROM optimistic_layers WHERE mutation_id = ?1";
const QUEUE_DIAGNOSTICS_SELECT: &str = "SELECT COUNT(*), MIN(created_at_ms) FROM mutation_queue";
const OPTIMISTIC_INDEX_DOCUMENT_INSERT: &str = "INSERT INTO optimistic_index_documents (owner_mutation_id, record_key, profile, partition, state, incomplete_kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id";
const OPTIMISTIC_INDEX_DOCUMENT_DELETE: &str =
    "DELETE FROM optimistic_index_documents WHERE record_key = ?1";
const OPTIMISTIC_EXACT_FACT_INSERT: &str =
    "INSERT INTO optimistic_exact_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const OPTIMISTIC_INTEGER_FACT_INSERT: &str =
    "INSERT INTO optimistic_integer_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const OPTIMISTIC_SORT_FACT_INSERT: &str =
    "INSERT INTO optimistic_sort_facts (document_id, attribute, value) VALUES (?1, ?2, ?3)";
const OPTIMISTIC_UNCERTAINTY_INSERT: &str =
    "INSERT INTO optimistic_uncertain_attributes (document_id, attribute) VALUES (?1, ?2)";
const UNCERTAINTY_ALL_V1: &str = "@macro-cache/optimistic-uncertainty:all:v1";
const UNCERTAINTY_CERTAIN_V1_PREFIX: &str = "@macro-cache/optimistic-uncertainty:certain:v1:";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i64)]
enum OptimisticIndexDocumentState {
    Complete = 0,
    Deleted = 1,
    Incomplete = 2,
}

impl TryFrom<i64> for OptimisticIndexDocumentState {
    type Error = TursoStorageError;

    fn try_from(value: i64) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Complete),
            1 => Ok(Self::Deleted),
            2 => Ok(Self::Incomplete),
            _ => Err(invariant()),
        }
    }
}

/// Turso-backed implementation of [`Storage`].
///
/// On `wasm32` this value owns the consuming
/// `turso_opfs::ConnectedOpfsSession` capability. It must be consumed with
/// [`Self::try_close`] before OPFS preservation or reset.
/// Native builds own either a filesystem-backed Turso database or a `MemoryIO`
/// database used by conformance tests.
pub struct TursoStorage {
    health: AtomicU8,
    #[cfg(target_arch = "wasm32")]
    session: ConnectedOpfsSession,
    #[cfg(not(target_arch = "wasm32"))]
    database: Arc<Database>,
    #[cfg(not(target_arch = "wasm32"))]
    connection: Arc<Connection>,
    #[cfg(all(test, not(target_arch = "wasm32")))]
    fault: Mutex<Option<TestFault>>,
}

impl std::fmt::Debug for TursoStorage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TursoStorage")
            .finish_non_exhaustive()
    }
}

#[cfg(target_arch = "wasm32")]
impl TursoStorage {
    /// Validates or initializes an already connected, OPFS-owned Turso session.
    ///
    /// Initialization failure exposes only a consuming physical-reset
    /// transition. It never exposes the connected or closed OPFS capability,
    /// so incompatible files cannot be preserved accidentally.
    pub fn from_opfs_session(
        session: ConnectedOpfsSession,
        scope: &str,
    ) -> Result<Self, TursoStorageOpenFailure> {
        Self::from_opfs_session_with_outcome(session, scope).map(|(storage, _)| storage)
    }

    /// Validates or initializes an OPFS session and returns its coarse outcome.
    pub fn from_opfs_session_with_outcome(
        session: ConnectedOpfsSession,
        scope: &str,
    ) -> Result<(Self, TursoStorageOpenOutcome), TursoStorageOpenFailure> {
        let fresh = session.disposition() == OpenDisposition::Fresh;
        let connection = session.connection();
        let result = initialize(&connection, scope, fresh);
        drop(connection);
        match result {
            Ok(()) => Ok((
                Self {
                    health: AtomicU8::new(0),
                    session,
                },
                if fresh {
                    TursoStorageOpenOutcome::OpenedNew
                } else {
                    TursoStorageOpenOutcome::OpenedExisting
                },
            )),
            Err(error) => Err(TursoStorageOpenFailure { error, session }),
        }
    }

    /// Browser-test-artifact-only helper used by the storage-control worker.
    #[cfg(feature = "browser-test-hooks")]
    #[doc(hidden)]
    pub fn browser_test_make_namespace_incompatible(&mut self) -> Result<(), TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        self.latch_result(driver::write_transaction(&connection, || {
            require_changed(
                driver::execute(
                    &connection,
                    "UPDATE meta SET value = 'browser-test-incompatible' WHERE key = 'namespace'",
                    Vec::new(),
                )?,
                1,
            )
        }))
    }

    /// Browser-test-artifact-only helper that writes an invalid queue payload.
    #[cfg(feature = "browser-test-hooks")]
    #[doc(hidden)]
    pub fn browser_test_corrupt_queue_payload(&mut self) -> Result<(), TursoStorageError> {
        self.require_healthy()?;
        let connection = self.connection();
        self.latch_result(driver::write_transaction(&connection, || {
            require_changed(
                driver::execute(
                    &connection,
                    QUEUE_INSERT,
                    vec![
                        text("mutation BrowserTestCorrupt { __typename }"),
                        Value::Null,
                        text("{}"),
                        Value::Null,
                        Value::from_i64(0),
                        Value::Null,
                        Value::Null,
                        Value::from_i64(0),
                        Value::Null,
                        Value::Null,
                        Value::from_i64(1),
                    ],
                )?,
                1,
            )?;
            let id = mutation_id_from_row(connection.last_insert_rowid())?;
            require_changed(
                driver::execute(
                    &connection,
                    LAYER_INSERT,
                    vec![
                        Value::from_i64(mutation_id_to_sql(id)?),
                        text("{}"),
                        Value::from_blob(vec![0xff]),
                    ],
                )?,
                1,
            )
        }))
    }

    /// Consumes storage and closes Turso into a health-typed OPFS capability.
    ///
    /// Healthy storage may subsequently be preserved or reset. A latched
    /// reset-required storage returns a capability that exposes reset only.
    /// Close failure exposes no recoverable session and requires replacing the
    /// worker before a recovery wipe.
    pub fn try_close(self) -> Result<TursoStorageCloseOutcome, TursoStorageCloseFailure> {
        let reason = self.latched_reason();
        let closed = self
            .session
            .try_close()
            .map_err(TursoStorageCloseFailure::new)?;
        Ok(match reason {
            Some(reason) => {
                TursoStorageCloseOutcome::ResetRequired(ResetRequiredTursoStorageClosed {
                    reason,
                    closed,
                })
            }
            None => TursoStorageCloseOutcome::Healthy(HealthyTursoStorageClosed { closed }),
        })
    }

    fn connection(&self) -> Arc<Connection> {
        self.session.connection()
    }
}

/// Result of consuming and gracefully closing a browser Turso storage.
#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub enum TursoStorageCloseOutcome {
    /// The database remained healthy and may be preserved or reset.
    Healthy(HealthyTursoStorageClosed),
    /// A reset-required reason was latched, so preservation is unavailable.
    ResetRequired(ResetRequiredTursoStorageClosed),
}

/// Closed healthy browser storage that may be preserved or reset.
#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub struct HealthyTursoStorageClosed {
    closed: ClosedSession,
}

#[cfg(target_arch = "wasm32")]
impl HealthyTursoStorageClosed {
    /// Preserves the healthy main/WAL pair and returns its still-locked owner.
    pub fn preserve(self) -> Result<OpfsOwner, OpfsError> {
        self.closed.preserve()
    }

    /// Physically resets the healthy main/WAL pair.
    pub async fn reset(self) -> Result<OpfsOwner, TursoStorageResetFailure> {
        self.closed
            .reset()
            .await
            .map_err(TursoStorageResetFailure::from_reset)
    }
}

/// Closed reset-required browser storage that cannot be preserved.
#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub struct ResetRequiredTursoStorageClosed {
    reason: PhysicalResetReason,
    closed: ClosedSession,
}

#[cfg(target_arch = "wasm32")]
impl ResetRequiredTursoStorageClosed {
    /// Returns the first reset-required reason latched by this storage.
    pub fn reason(&self) -> PhysicalResetReason {
        self.reason
    }

    /// Physically resets the unhealthy main/WAL pair.
    pub async fn reset(self) -> Result<OpfsOwner, TursoStorageResetFailure> {
        self.closed
            .reset()
            .await
            .map_err(TursoStorageResetFailure::from_reset)
    }
}

/// A browser close failure that exposes no reusable session capability.
///
/// The worker-local OPFS owner is either already poisoned or becomes poisoned
/// when the retained internal session is dropped. Recovery requires worker
/// replacement followed by the owner's recovery wipe.
#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub struct TursoStorageCloseFailure {
    failure: CloseFailure,
}

#[cfg(target_arch = "wasm32")]
impl TursoStorageCloseFailure {
    fn new(failure: CloseFailure) -> Self {
        Self { failure }
    }

    /// Returns the payload-free OPFS error classification.
    pub fn error(&self) -> &OpfsError {
        self.failure.error()
    }

    /// Returns that recovery requires replacing the poisoned worker.
    pub const fn requires_worker_replacement(&self) -> bool {
        true
    }
}

#[cfg(target_arch = "wasm32")]
impl std::fmt::Display for TursoStorageCloseFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.failure.fmt(formatter)
    }
}

#[cfg(target_arch = "wasm32")]
impl std::error::Error for TursoStorageCloseFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.failure)
    }
}

/// A browser reset transition failure that requires worker replacement.
#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
pub struct TursoStorageResetFailure {
    failure: TursoStorageResetFailureInner,
}

#[cfg(target_arch = "wasm32")]
#[derive(Debug)]
enum TursoStorageResetFailureInner {
    Close(CloseFailure),
    Reset(ResetFailure),
}

#[cfg(target_arch = "wasm32")]
impl TursoStorageResetFailure {
    fn from_close(failure: CloseFailure) -> Self {
        Self {
            failure: TursoStorageResetFailureInner::Close(failure),
        }
    }

    fn from_reset(failure: ResetFailure) -> Self {
        Self {
            failure: TursoStorageResetFailureInner::Reset(failure),
        }
    }

    /// Returns the payload-free OPFS error classification.
    pub fn error(&self) -> &OpfsError {
        match &self.failure {
            TursoStorageResetFailureInner::Close(failure) => failure.error(),
            TursoStorageResetFailureInner::Reset(failure) => failure.error(),
        }
    }

    /// Returns that recovery requires replacing the poisoned worker.
    pub const fn requires_worker_replacement(&self) -> bool {
        true
    }
}

#[cfg(target_arch = "wasm32")]
impl std::fmt::Display for TursoStorageResetFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.failure {
            TursoStorageResetFailureInner::Close(failure) => failure.fmt(formatter),
            TursoStorageResetFailureInner::Reset(failure) => failure.fmt(formatter),
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl std::error::Error for TursoStorageResetFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match &self.failure {
            TursoStorageResetFailureInner::Close(failure) => Some(failure),
            TursoStorageResetFailureInner::Reset(failure) => Some(failure),
        }
    }
}

/// A WASM initialization failure that permits only physical reset.
#[cfg(target_arch = "wasm32")]
pub struct TursoStorageOpenFailure {
    error: TursoStorageError,
    session: ConnectedOpfsSession,
}

#[cfg(target_arch = "wasm32")]
impl TursoStorageOpenFailure {
    /// Returns the payload-free storage classification.
    pub fn error(&self) -> TursoStorageError {
        self.error
    }

    /// Consumes a non-reset failure, closes Turso, and preserves main and WAL.
    ///
    /// This accessor must only be used when [`Self::error`] does not require a
    /// physical reset. A close failure poisons the worker-local owner.
    pub fn preserve(self) -> Result<OpfsOwner, OpfsError> {
        let closed = self
            .session
            .try_close()
            .map_err(|failure| failure.error().clone())?;
        closed.preserve()
    }

    /// Consumes the failure, closes Turso, and physically resets main and WAL.
    ///
    /// Neither the connected nor closed session is exposed. Close/reset failure
    /// requires worker replacement before recovery.
    pub async fn reset(self) -> Result<OpfsOwner, TursoStorageResetFailure> {
        let closed = self
            .session
            .try_close()
            .map_err(TursoStorageResetFailure::from_close)?;
        closed
            .reset()
            .await
            .map_err(TursoStorageResetFailure::from_reset)
    }
}

#[cfg(target_arch = "wasm32")]
impl std::fmt::Debug for TursoStorageOpenFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TursoStorageOpenFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

#[cfg(target_arch = "wasm32")]
impl std::fmt::Display for TursoStorageOpenFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.error.fmt(formatter)
    }
}

#[cfg(target_arch = "wasm32")]
impl std::error::Error for TursoStorageOpenFailure {}

/// Reopenable filesystem-backed Turso database for native hosts.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Debug)]
pub struct TursoFileDatabase {
    path: PathBuf,
    turso_path: String,
}

#[cfg(not(target_arch = "wasm32"))]
impl TursoFileDatabase {
    /// Creates a native database owner for `path`.
    pub fn new(path: impl AsRef<Path>) -> Result<Self, TursoStorageError> {
        let path = path.as_ref().to_path_buf();
        let turso_path = path
            .to_str()
            .ok_or(TursoStorageError::InvalidInput)?
            .to_owned();
        Ok(Self { path, turso_path })
    }

    /// Opens and initializes or validates this database for `scope`.
    pub fn open(&self, scope: &str) -> Result<TursoStorage, TursoStorageError> {
        let fresh = !self.path.exists();
        let io: Arc<dyn IO> = Arc::new(PlatformIO::new().map_err(TursoStorageError::turso)?);
        open_native_database(io, &self.turso_path, scope, fresh)
    }

    /// Opens this database, physically replacing incompatible or uncertain
    /// storage before retrying once.
    pub fn open_or_reset(&self, scope: &str) -> Result<TursoStorage, TursoStorageError> {
        match self.open(scope) {
            Ok(storage) => Ok(storage),
            Err(error) if error.requires_physical_reset() => {
                self.physical_reset()?;
                self.open(scope)
            }
            Err(error) => Err(error),
        }
    }

    /// Deletes the native main and WAL files after all connections are closed.
    pub fn physical_reset(&self) -> Result<(), TursoStorageError> {
        remove_native_file(&self.path)?;
        let wal_path = PathBuf::from(format!("{}-wal", self.turso_path));
        remove_native_file(&wal_path)
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn remove_native_file(path: &Path) -> Result<(), TursoStorageError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(TursoStorageError::reset(PhysicalResetReason::Io)),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn open_native_database(
    io: Arc<dyn IO>,
    path: &str,
    scope: &str,
    fresh: bool,
) -> Result<TursoStorage, TursoStorageError> {
    let database = Database::open(io, path, OpenOptions::new(Arc::new(SqliteDialect)))
        .map_err(TursoStorageError::turso)
        .map_err(|error| if fresh { error } else { error.initialization() })?;
    let connection = database
        .connect()
        .map_err(TursoStorageError::turso)
        .map_err(|error| if fresh { error } else { error.initialization() })?;
    if let Err(error) = initialize(&connection, scope, fresh) {
        if connection.close().is_err() {
            return Err(TursoStorageError::reset(
                PhysicalResetReason::TransactionOutcomeUncertain,
            ));
        }
        return Err(error);
    }
    Ok(TursoStorage {
        health: AtomicU8::new(0),
        database,
        connection,
        #[cfg(all(test, not(target_arch = "wasm32")))]
        fault: Mutex::new(None),
    })
}

/// Reopenable Turso `MemoryIO` database used by native conformance tests.
#[cfg(not(target_arch = "wasm32"))]
pub struct TursoMemoryDatabase {
    path: String,
    state: Mutex<MemoryDatabaseState>,
}

#[cfg(not(target_arch = "wasm32"))]
struct MemoryDatabaseState {
    io: Arc<MemoryIO>,
    initialized: bool,
}

#[cfg(not(target_arch = "wasm32"))]
impl TursoMemoryDatabase {
    /// Creates an isolated, initially fresh in-memory physical database.
    pub fn new(database_path: impl Into<String>) -> Self {
        Self {
            path: database_path.into(),
            state: Mutex::new(MemoryDatabaseState {
                io: Arc::new(MemoryIO::new()),
                initialized: false,
            }),
        }
    }

    /// Opens and initializes or validates this in-memory database for `scope`.
    pub fn open(&self, scope: &str) -> Result<TursoStorage, TursoStorageError> {
        let (io, fresh) = {
            let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            (state.io.clone(), !state.initialized)
        };
        let io_trait: Arc<dyn IO> = io;
        let storage = open_native_database(io_trait, &self.path, scope, fresh)?;
        if fresh {
            self.state
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .initialized = true;
        }
        Ok(storage)
    }

    /// Replaces the complete in-memory main/WAL store with a fresh one.
    ///
    /// Callers must first consume and close every storage opened from this
    /// database. This models the owner-level physical reset used by OPFS.
    pub fn physical_reset(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.io = Arc::new(MemoryIO::new());
        state.initialized = false;
    }
}

/// Health-typed result of consuming a native conformance-test storage.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TursoStorageCloseOutcome {
    /// The native test database remained healthy.
    Healthy,
    /// The native test database must be physically replaced before reopening.
    ResetRequired(PhysicalResetReason),
}

#[cfg(not(target_arch = "wasm32"))]
impl TursoStorage {
    /// Opens a one-use isolated Turso `MemoryIO` database.
    pub fn open_in_memory(scope: &str) -> Result<Self, TursoStorageError> {
        static NEXT_MEMORY_DATABASE: AtomicU64 = AtomicU64::new(1);
        let id = NEXT_MEMORY_DATABASE.fetch_add(1, Ordering::Relaxed);
        TursoMemoryDatabase::new(format!("cache-turso-memory-{id}.db")).open(scope)
    }

    /// Consumes and explicitly closes the native Turso connection.
    pub fn try_close(self) -> Result<TursoStorageCloseOutcome, TursoStorageError> {
        let reason = self.latched_reason();
        self.connection.close().map_err(|_| {
            TursoStorageError::reset(PhysicalResetReason::TransactionOutcomeUncertain)
        })?;
        drop(self.connection);
        drop(self.database);
        Ok(match reason {
            Some(reason) => TursoStorageCloseOutcome::ResetRequired(reason),
            None => TursoStorageCloseOutcome::Healthy,
        })
    }

    fn connection(&self) -> Arc<Connection> {
        self.connection.clone()
    }
}

impl TursoStorage {
    fn latched_reason(&self) -> Option<PhysicalResetReason> {
        let code = self.health.load(Ordering::Acquire);
        PhysicalResetReason::from_latch_code(code)
            .or_else(|| (code != 0).then_some(PhysicalResetReason::TransactionOutcomeUncertain))
    }

    fn require_healthy(&self) -> Result<(), TursoStorageError> {
        self.latched_reason()
            .map_or(Ok(()), |reason| Err(TursoStorageError::reset(reason)))
    }

    fn latch_result<T>(
        &self,
        result: Result<T, TursoStorageError>,
    ) -> Result<T, TursoStorageError> {
        match result {
            Err(TursoStorageError::PhysicalResetRequired(reason)) => {
                let _ = self.health.compare_exchange(
                    0,
                    reason.latch_code(),
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
                Err(TursoStorageError::reset(reason))
            }
            result => result,
        }
    }
}

impl Storage for TursoStorage {
    type Error = TursoStorageError;

    async fn get_batch(&self, keys: &[EntityKey<'_>]) -> Result<Vec<Option<Record>>, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let keys = keys
                .iter()
                .map(RecordKey::from_entity)
                .collect::<Result<Vec<_>, _>>()?;
            if keys.is_empty() {
                return Ok(Vec::new());
            }
            let connection = self.connection();
            driver::read_transaction(&connection, || {
                let mut statement = driver::prepare(&connection, RECORD_GET)?;
                let mut records = Vec::with_capacity(keys.len());
                for key in &keys {
                    let rows = driver::query_prepared(
                        &mut statement,
                        vec![text(&key.typename), text(&key.id)],
                    )?;
                    match rows.as_slice() {
                        [] => records.push(None),
                        [row] => {
                            records.push(Some(decode_record(&required_blob(row, 0)?).map_err(
                                |_| TursoStorageError::reset(PhysicalResetReason::Codec),
                            )?))
                        }
                        _ => return Err(invariant()),
                    }
                }
                Ok(records)
            })
        })();
        self.latch_result(result)
    }

    async fn put_batch(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let entries = prepare_records(entries)?;
            if entries.is_empty() {
                return Ok(());
            }
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let mut statement = driver::prepare(&connection, RECORD_UPSERT)?;
                for (index, entry) in entries.iter().enumerate() {
                    let changed = driver::execute_prepared(
                        &mut statement,
                        vec![
                            text(&entry.key.typename),
                            text(&entry.key.id),
                            Value::from_blob(entry.value.clone()),
                        ],
                    )?;
                    require_changed(changed, 1)?;
                    self.fault_after(TestFaultSite::Put, index)?;
                }
                write_search_documents(&connection, &entries)
            })
        })();
        self.latch_result(result)
    }

    async fn put_batch_with_projections(
        &mut self,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let entries = prepare_records(entries)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let mut statement = driver::prepare(&connection, RECORD_UPSERT)?;
                for (index, entry) in entries.iter().enumerate() {
                    require_changed(
                        driver::execute_prepared(
                            &mut statement,
                            vec![
                                text(&entry.key.typename),
                                text(&entry.key.id),
                                Value::from_blob(entry.value.clone()),
                            ],
                        )?,
                        1,
                    )?;
                    self.fault_after(TestFaultSite::Put, index)?;
                }
                write_search_documents(&connection, &entries)?;
                write_projection_mutations(&connection, projections)
            })
        })();
        self.latch_result(result)
    }

    async fn delete_batch(&mut self, keys: &[EntityKey<'static>]) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let keys = keys
                .iter()
                .map(RecordKey::from_entity)
                .collect::<Result<Vec<_>, _>>()?;
            if keys.is_empty() {
                return Ok(());
            }
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let mut record_statement = driver::prepare(&connection, RECORD_DELETE)?;
                let mut search_statement = driver::prepare(&connection, SEARCH_DELETE)?;
                for (index, key) in keys.iter().enumerate() {
                    let changed = driver::execute_prepared(
                        &mut record_statement,
                        vec![text(&key.typename), text(&key.id)],
                    )?;
                    if !(0..=1).contains(&changed) {
                        return Err(invariant());
                    }
                    let search_changed = driver::execute_prepared(
                        &mut search_statement,
                        vec![text(&key.typename), text(&key.id)],
                    )?;
                    if search_changed < 0 {
                        return Err(invariant());
                    }
                    self.fault_after(TestFaultSite::Delete, index)?;
                }
                Ok(())
            })
        })();
        self.latch_result(result)
    }

    async fn load_search_documents(
        &self,
        profile: SearchProfile,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        self.require_healthy()?;
        let result = {
            let connection = self.connection();
            driver::query(&connection, SEARCH_LOAD, vec![text(profile.as_str())]).and_then(|rows| {
                rows.into_iter()
                    .map(|row| parse_search_document(&row, profile))
                    .collect()
            })
        };
        self.latch_result(result)
    }

    async fn browse_search_documents(
        &self,
        profile: SearchProfile,
        bucket: &str,
        after: Option<&SearchCursor>,
        limit: usize,
    ) -> Result<Vec<SearchDocument>, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            if limit == 0 {
                return Ok(Vec::new());
            }
            let limit = i64::try_from(limit).map_err(|_| TursoStorageError::InvalidInput)?;
            let connection = self.connection();
            let rows = match after {
                Some(cursor) => {
                    let cursor_key = RecordKey::from_entity(&cursor.record_key)?;
                    driver::query(
                        &connection,
                        SEARCH_BROWSE_AFTER,
                        vec![
                            text(profile.as_str()),
                            text(bucket),
                            Value::from_i64(cursor.timestamp_ms),
                            text(&cursor_key.typename),
                            text(&cursor_key.id),
                            Value::from_i64(limit),
                        ],
                    )?
                }
                None => driver::query(
                    &connection,
                    SEARCH_BROWSE,
                    vec![text(profile.as_str()), text(bucket), Value::from_i64(limit)],
                )?,
            };
            rows.into_iter()
                .map(|row| parse_search_document(&row, profile))
                .collect()
        })();
        self.latch_result(result)
    }

    async fn enqueue_mutation_with_shadow(
        &mut self,
        entry: NewQueuedMutation,
        projections: Vec<PendingOptimisticProjection>,
    ) -> Result<MutationId, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            validate_pending_optimistic_projections(&projections)?;
            let mutation_values = mutation_values(&entry.mutation)?;
            let updates = encode_record_updates(&entry.optimistic.normalized_updates);
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                require_changed(
                    driver::execute(&connection, QUEUE_INSERT, mutation_values)?,
                    1,
                )?;
                self.fault_after(TestFaultSite::Enqueue, 0)?;
                let id = mutation_id_from_row(connection.last_insert_rowid())?;
                require_changed(
                    driver::execute(
                        &connection,
                        LAYER_INSERT,
                        vec![
                            Value::from_i64(mutation_id_to_sql(id)?),
                            text(&entry.optimistic.optimistic_data_json),
                            Value::from_blob(updates),
                        ],
                    )?,
                    1,
                )?;
                write_pending_optimistic_projections(&connection, id, projections, |index| {
                    self.fault_after(TestFaultSite::Enqueue, index + 1)
                })?;
                Ok(id)
            })
        })();
        self.latch_result(result)
    }

    async fn load_projection_states(
        &self,
        keys: &[PredicateRecordKey],
    ) -> Result<Vec<Option<ProjectionState>>, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result =
            driver::read_transaction(&connection, || load_projection_states(&connection, keys));
        self.latch_result(result)
    }

    async fn load_optimistic_projections(
        &self,
        keys: &[PredicateRecordKey],
    ) -> Result<Vec<Option<EffectiveOptimisticProjection>>, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            load_optimistic_projections(&connection, keys)
        });
        self.latch_result(result)
    }

    async fn load_mutation_queue(&self) -> Result<Vec<QueuedMutation>, Self::Error> {
        self.require_healthy()?;
        let result = {
            let connection = self.connection();
            driver::read_transaction(&connection, || {
                let rows = driver::query(&connection, QUEUE_SELECT, Vec::new())?;
                let mut queue = Vec::with_capacity(rows.len());
                for row in rows {
                    let parsed = parse_queue_row(&row)?;
                    let optimistic = parsed.optimistic.ok_or_else(invariant)?;
                    queue.push(QueuedMutation {
                        id: parsed.id,
                        mutation: parsed.mutation,
                        optimistic,
                    });
                }
                if !driver::query(&connection, ORPHAN_LAYER_SELECT, Vec::new())?.is_empty() {
                    return Err(invariant());
                }
                Ok(queue)
            })
        };
        self.latch_result(result)
    }

    async fn queue_diagnostics(&self) -> Result<QueueDiagnostics, Self::Error> {
        self.require_healthy()?;
        // Diagnostics are deliberately outside a transaction and outside the
        // health latch. A failed observation must never alter cache recovery.
        self.fault_after(TestFaultSite::Diagnostics, 0)?;
        let connection = self.connection();
        let rows = driver::query(&connection, QUEUE_DIAGNOSTICS_SELECT, Vec::new())?;
        let [row] = rows.as_slice() else {
            return Err(invariant());
        };
        if row.len() != 2 {
            return Err(invariant());
        }
        let depth = u64::try_from(required_i64(row, 0)?).map_err(|_| invariant())?;
        let oldest_created_at_ms = nullable_i64(row, 1)?;
        if (depth == 0) != oldest_created_at_ms.is_none() {
            return Err(invariant());
        }
        Ok(QueueDiagnostics {
            availability: QueueDiagnosticsAvailability::Available,
            depth,
            oldest_created_at_ms,
        })
    }

    async fn claim_next_mutation(
        &mut self,
        request: MutationClaimRequest,
    ) -> Result<Option<ClaimedMutation>, Self::Error> {
        self.require_healthy()?;
        let result = {
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let rows = driver::query(&connection, QUEUE_HEAD_SELECT, Vec::new())?;
                let Some(row) = rows.first() else {
                    if !driver::query(&connection, ANY_LAYER_SELECT, Vec::new())?.is_empty() {
                        return Err(invariant());
                    }
                    return Ok(None);
                };
                if rows.len() != 1 {
                    return Err(invariant());
                }
                let mut parsed = parse_queue_row(row)?;
                let optimistic = parsed.optimistic.take().ok_or_else(invariant)?;
                if parsed
                    .mutation
                    .next_attempt_at_ms
                    .is_some_and(|next| next > request.now_ms)
                    || parsed
                        .mutation
                        .lease_expires_at_ms
                        .is_some_and(|expiry| expiry > request.now_ms)
                {
                    return Ok(None);
                }

                parsed.mutation.attempt_count = parsed.mutation.attempt_count.saturating_add(1);
                parsed.mutation.lease_generation =
                    parsed.mutation.lease_generation.saturating_add(1);
                let generation =
                    generation_to_sql(parsed.mutation.lease_generation).map_err(|_| invariant())?;
                parsed.mutation.next_attempt_at_ms = None;
                parsed.mutation.lease_owner = Some(request.owner.clone());
                parsed.mutation.lease_expires_at_ms = Some(request.lease_expires_at_ms);
                require_changed(
                    driver::execute(
                        &connection,
                        "UPDATE mutation_queue SET attempt_count = ?2, next_attempt_at_ms = NULL, lease_owner = ?3, lease_generation = ?4, lease_expires_at_ms = ?5 WHERE id = ?1",
                        vec![
                            Value::from_i64(mutation_id_to_sql(parsed.id)?),
                            Value::from_i64(i64::from(parsed.mutation.attempt_count)),
                            text(&request.owner),
                            Value::from_i64(generation),
                            Value::from_i64(request.lease_expires_at_ms),
                        ],
                    )?,
                    1,
                )?;
                Ok(Some(ClaimedMutation {
                    queued: QueuedMutation {
                        id: parsed.id,
                        mutation: parsed.mutation,
                        optimistic,
                    },
                    lease_generation: u64::try_from(generation).map_err(|_| invariant())?,
                }))
            })
        };
        self.latch_result(result)
    }

    async fn defer_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        next_attempt_at_ms: i64,
        error: String,
    ) -> Result<bool, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let id = mutation_id_to_sql(id)?;
            let generation = generation_to_sql(claim.generation)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let changed = driver::execute(
                    &connection,
                    "UPDATE mutation_queue SET next_attempt_at_ms = ?4, lease_owner = NULL, lease_expires_at_ms = NULL, last_error = ?5 WHERE id = ?1 AND lease_owner = ?2 AND lease_generation = ?3",
                    vec![
                        Value::from_i64(id),
                        text(&claim.owner),
                        Value::from_i64(generation),
                        Value::from_i64(next_attempt_at_ms),
                        text(&error),
                    ],
                )?;
                changed_to_bool(changed)
            })
        })();
        self.latch_result(result)
    }

    async fn complete_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
    ) -> Result<bool, Self::Error> {
        self.complete_mutation_with_projections(id, claim, entries, Vec::new())
            .await
    }

    async fn complete_mutation_with_projections(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
    ) -> Result<bool, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let sql_id = mutation_id_to_sql(id)?;
            generation_to_sql(claim.generation)?;
            let entries = prepare_records(entries)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                if !claim_is_current(&connection, sql_id, &claim)? {
                    return Ok(false);
                }
                require_layer(&connection, sql_id)?;
                {
                    let mut statement = driver::prepare(&connection, RECORD_UPSERT)?;
                    for (index, entry) in entries.iter().enumerate() {
                        require_changed(
                            driver::execute_prepared(
                                &mut statement,
                                vec![
                                    text(&entry.key.typename),
                                    text(&entry.key.id),
                                    Value::from_blob(entry.value.clone()),
                                ],
                            )?,
                            1,
                        )?;
                        self.fault_after(TestFaultSite::Complete, index)?;
                    }
                }
                write_search_documents(&connection, &entries)?;
                write_projection_mutations(&connection, projections)?;
                require_changed(
                    driver::execute(
                        &connection,
                        "DELETE FROM mutation_queue WHERE id = ?1",
                        vec![Value::from_i64(sql_id)],
                    )?,
                    1,
                )?;
                Ok(true)
            })
        })();
        self.latch_result(result)
    }

    async fn complete_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        entries: Vec<(EntityKey<'static>, Record)>,
        projections: Vec<ProjectionMutation>,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            validate_shadow_reconciliation(id, &reconciliation)?;
            let sql_id = mutation_id_to_sql(id)?;
            generation_to_sql(claim.generation)?;
            let entries = prepare_records(entries)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                if !claim_is_current(&connection, sql_id, &claim)?
                    || !queue_identity_matches(&connection, &reconciliation.expected_queue)?
                {
                    return Ok(false);
                }
                require_layer(&connection, sql_id)?;
                {
                    let mut statement = driver::prepare(&connection, RECORD_UPSERT)?;
                    for (index, entry) in entries.iter().enumerate() {
                        require_changed(
                            driver::execute_prepared(
                                &mut statement,
                                vec![
                                    text(&entry.key.typename),
                                    text(&entry.key.id),
                                    Value::from_blob(entry.value.clone()),
                                ],
                            )?,
                            1,
                        )?;
                        self.fault_after(TestFaultSite::Complete, index)?;
                    }
                }
                write_search_documents(&connection, &entries)?;
                write_projection_mutations(&connection, projections)?;
                require_changed(
                    driver::execute(
                        &connection,
                        "DELETE FROM mutation_queue WHERE id = ?1",
                        vec![Value::from_i64(sql_id)],
                    )?,
                    1,
                )?;
                write_shadow_reconciliation(&connection, reconciliation, |index| {
                    self.fault_after(TestFaultSite::Complete, entries.len() + index)
                })?;
                Ok(true)
            })
        })();
        self.latch_result(result)
    }

    async fn discard_mutation(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
    ) -> Result<bool, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let sql_id = mutation_id_to_sql(id)?;
            generation_to_sql(claim.generation)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                if !claim_is_current(&connection, sql_id, &claim)? {
                    return Ok(false);
                }
                require_layer(&connection, sql_id)?;
                require_changed(
                    driver::execute(
                        &connection,
                        "DELETE FROM mutation_queue WHERE id = ?1",
                        vec![Value::from_i64(sql_id)],
                    )?,
                    1,
                )?;
                self.fault_after(TestFaultSite::Discard, 0)?;
                Ok(true)
            })
        })();
        self.latch_result(result)
    }

    async fn discard_mutation_with_shadow(
        &mut self,
        id: MutationId,
        claim: MutationClaimToken,
        reconciliation: OptimisticShadowReconciliation,
    ) -> Result<bool, Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            validate_shadow_reconciliation(id, &reconciliation)?;
            let sql_id = mutation_id_to_sql(id)?;
            generation_to_sql(claim.generation)?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                if !claim_is_current(&connection, sql_id, &claim)?
                    || !queue_identity_matches(&connection, &reconciliation.expected_queue)?
                {
                    return Ok(false);
                }
                require_layer(&connection, sql_id)?;
                require_changed(
                    driver::execute(
                        &connection,
                        "DELETE FROM mutation_queue WHERE id = ?1",
                        vec![Value::from_i64(sql_id)],
                    )?,
                    1,
                )?;
                write_shadow_reconciliation(&connection, reconciliation, |index| {
                    self.fault_after(TestFaultSite::Discard, index)
                })?;
                Ok(true)
            })
        })();
        self.latch_result(result)
    }

    async fn clear(&mut self) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = {
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                driver::execute(&connection, "DELETE FROM optimistic_layers", Vec::new())?;
                self.fault_after(TestFaultSite::Clear, 0)?;
                driver::execute(&connection, "DELETE FROM mutation_queue", Vec::new())?;
                self.fault_after(TestFaultSite::Clear, 1)?;
                driver::execute(&connection, "DELETE FROM search_documents", Vec::new())?;
                driver::execute(&connection, "DELETE FROM index_documents", Vec::new())?;
                driver::execute(&connection, "DELETE FROM records", Vec::new())?;
                self.fault_after(TestFaultSite::Clear, 2)?;
                Ok(())
            })
        };
        self.latch_result(result)
    }
}

impl PredicateIndexStorage for TursoStorage {
    async fn delete_batch_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[PredicateRecordKey],
    ) -> Result<(), Self::Error> {
        self.require_healthy()?;
        let result = (|| {
            let keys = keys
                .iter()
                .map(RecordKey::from_entity)
                .collect::<Result<Vec<_>, _>>()?;
            let connection = self.connection();
            driver::write_transaction(&connection, || {
                let mut record_statement = driver::prepare(&connection, RECORD_DELETE)?;
                let mut search_statement = driver::prepare(&connection, SEARCH_DELETE)?;
                for key in &keys {
                    let changed = driver::execute_prepared(
                        &mut record_statement,
                        vec![text(&key.typename), text(&key.id)],
                    )?;
                    if !(0..=1).contains(&changed) {
                        return Err(invariant());
                    }
                    driver::execute_prepared(
                        &mut search_statement,
                        vec![text(&key.typename), text(&key.id)],
                    )?;
                }
                for key in projection_keys {
                    let changed = driver::execute(
                        &connection,
                        INDEX_DOCUMENT_DELETE,
                        vec![text(key.as_str())],
                    )?;
                    if !(0..=1).contains(&changed) {
                        return Err(invariant());
                    }
                }
                Ok(())
            })
        })();
        self.latch_result(result)
    }

    async fn query_predicate_index(
        &self,
        query: &ValidatedIndexQuery,
    ) -> Result<PredicateQueryResult, Self::Error> {
        self.require_healthy()?;
        let connection = self.connection();
        let result = driver::read_transaction(&connection, || {
            if predicate_scope_is_incomplete(&connection, query)? {
                return Ok(PredicateQueryResult::Incomplete);
            }
            let optimistic = optimistic_query_status(&connection, query)?;
            if optimistic.incomplete {
                return Ok(PredicateQueryResult::Incomplete);
            }
            let (sql, parameters) = compile_predicate_sql(query);
            let rows = driver::query(&connection, &sql, parameters)?;
            let mut keys = Vec::with_capacity(rows.len());
            for row in rows {
                if row.len() != 1 {
                    return Err(invariant());
                }
                keys.push(
                    PredicateRecordKey::new(required_text(&row, 0)?).map_err(|_| invariant())?,
                );
            }
            Ok(if optimistic.has_shadow {
                PredicateQueryResult::Optimistic(keys)
            } else {
                PredicateQueryResult::Complete(keys)
            })
        });
        self.latch_result(result)
    }
}

fn validate_pending_optimistic_projections(
    projections: &[PendingOptimisticProjection],
) -> Result<(), TursoStorageError> {
    let mut keys = HashSet::with_capacity(projections.len());
    for projection in projections {
        projection
            .validate()
            .map_err(|_| TursoStorageError::InvalidInput)?;
        if !keys.insert(projection.state.record_key()) {
            return Err(TursoStorageError::InvalidInput);
        }
    }
    Ok(())
}

fn validate_shadow_reconciliation(
    id: MutationId,
    reconciliation: &OptimisticShadowReconciliation,
) -> Result<(), TursoStorageError> {
    reconciliation
        .validate(id)
        .map_err(|_| TursoStorageError::InvalidInput)
}

fn queue_identity_matches(
    connection: &Arc<Connection>,
    expected: &[MutationId],
) -> Result<bool, TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT id FROM mutation_queue ORDER BY id ASC",
        Vec::new(),
    )?;
    if rows.len() != expected.len() {
        return Ok(false);
    }
    for (row, expected) in rows.iter().zip(expected) {
        if row.len() != 1 || mutation_id_from_row(required_i64(row, 0)?)? != *expected {
            return Ok(false);
        }
    }
    Ok(true)
}

fn write_shadow_reconciliation(
    connection: &Arc<Connection>,
    reconciliation: OptimisticShadowReconciliation,
    mut after_write: impl FnMut(usize) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    for key in &reconciliation.affected_keys {
        delete_optimistic_projection(connection, key)?;
    }
    for (index, replacement) in reconciliation.replacements.into_iter().enumerate() {
        insert_optimistic_projection(
            connection,
            mutation_id_to_sql(replacement.owner)?,
            replacement.state,
            replacement.uncertainty,
        )?;
        after_write(index)?;
    }
    Ok(())
}

fn write_pending_optimistic_projections(
    connection: &Arc<Connection>,
    owner: MutationId,
    projections: Vec<PendingOptimisticProjection>,
    mut after_write: impl FnMut(usize) -> Result<(), TursoStorageError>,
) -> Result<(), TursoStorageError> {
    let owner = mutation_id_to_sql(owner)?;
    for (index, projection) in projections.into_iter().enumerate() {
        delete_optimistic_projection(connection, projection.state.record_key())?;
        insert_optimistic_projection(connection, owner, projection.state, projection.uncertainty)?;
        after_write(index)?;
    }
    Ok(())
}

fn delete_optimistic_projection(
    connection: &Arc<Connection>,
    record_key: &PredicateRecordKey,
) -> Result<(), TursoStorageError> {
    let changed = driver::execute(
        connection,
        OPTIMISTIC_INDEX_DOCUMENT_DELETE,
        vec![text(record_key.as_str())],
    )?;
    if (0..=1).contains(&changed) {
        Ok(())
    } else {
        Err(invariant())
    }
}

fn insert_optimistic_projection(
    connection: &Arc<Connection>,
    owner: i64,
    state: OptimisticProjectionState,
    uncertainty: OptimisticUncertainty,
) -> Result<(), TursoStorageError> {
    let (state_code, incomplete_kind_code) = optimistic_projection_state_code(&state);
    let rows = driver::query(
        connection,
        OPTIMISTIC_INDEX_DOCUMENT_INSERT,
        vec![
            Value::from_i64(owner),
            text(state.record_key().as_str()),
            text(state.profile().token().as_str()),
            text(state.partition().as_str()),
            Value::from_i64(state_code),
            optional_i64(incomplete_kind_code),
        ],
    )?;
    let document_id = match rows.as_slice() {
        [row] if row.len() == 1 => required_i64(row, 0)?,
        _ => return Err(invariant()),
    };
    if let OptimisticProjectionState::Complete(document) = state {
        for fact in document.exact_facts {
            require_changed(
                driver::execute(
                    connection,
                    OPTIMISTIC_EXACT_FACT_INSERT,
                    vec![
                        Value::from_i64(document_id),
                        text(fact.attribute.as_str()),
                        Value::from_blob(fact.value.as_bytes().to_vec()),
                    ],
                )?,
                1,
            )?;
        }
        for fact in document.integer_facts {
            require_changed(
                driver::execute(
                    connection,
                    OPTIMISTIC_INTEGER_FACT_INSERT,
                    vec![
                        Value::from_i64(document_id),
                        text(fact.attribute.as_str()),
                        Value::from_i64(fact.value),
                    ],
                )?,
                1,
            )?;
        }
        for fact in document.sort_facts {
            require_changed(
                driver::execute(
                    connection,
                    OPTIMISTIC_SORT_FACT_INSERT,
                    vec![
                        Value::from_i64(document_id),
                        text(fact.attribute.as_str()),
                        Value::from_i64(fact.value),
                    ],
                )?,
                1,
            )?;
        }
    }
    write_optimistic_uncertainty(connection, document_id, uncertainty)
}

fn write_optimistic_uncertainty(
    connection: &Arc<Connection>,
    document_id: i64,
    uncertainty: OptimisticUncertainty,
) -> Result<(), TursoStorageError> {
    let attributes = match uncertainty {
        OptimisticUncertainty::Attributes(attributes) => attributes
            .into_iter()
            .map(|attribute| attribute.as_str().to_owned())
            .collect::<Vec<_>>(),
        OptimisticUncertainty::AllExcept(certain) => {
            std::iter::once(UNCERTAINTY_ALL_V1.to_owned())
                .chain(certain.into_iter().map(|attribute| {
                    format!("{UNCERTAINTY_CERTAIN_V1_PREFIX}{}", attribute.as_str())
                }))
                .collect()
        }
    };
    for attribute in attributes {
        require_changed(
            driver::execute(
                connection,
                OPTIMISTIC_UNCERTAINTY_INSERT,
                vec![Value::from_i64(document_id), text(&attribute)],
            )?,
            1,
        )?;
    }
    Ok(())
}

fn optimistic_projection_state_code(state: &OptimisticProjectionState) -> (i64, Option<i64>) {
    match state {
        OptimisticProjectionState::Complete(_) => {
            (OptimisticIndexDocumentState::Complete as i64, None)
        }
        OptimisticProjectionState::Deleted { .. } => {
            (OptimisticIndexDocumentState::Deleted as i64, None)
        }
        OptimisticProjectionState::Incomplete { kind, .. } => (
            OptimisticIndexDocumentState::Incomplete as i64,
            Some(projection_state_code(*kind)),
        ),
    }
}

fn write_projection_mutations(
    connection: &Arc<Connection>,
    projections: Vec<ProjectionMutation>,
) -> Result<(), TursoStorageError> {
    for mutation in projections {
        match mutation {
            ProjectionMutation::Replace(document) => {
                document.validate().map_err(|_| invariant())?;
                let document_id = upsert_index_document(
                    connection,
                    &document.record_key,
                    &document.profile,
                    &document.partition,
                    0,
                )?;
                delete_index_facts(connection, document_id)?;
                for fact in document.exact_facts {
                    require_changed(
                        driver::execute(
                            connection,
                            EXACT_FACT_INSERT,
                            vec![
                                Value::from_i64(document_id),
                                text(fact.attribute.as_str()),
                                Value::from_blob(fact.value.as_bytes().to_vec()),
                            ],
                        )?,
                        1,
                    )?;
                }
                for fact in document.integer_facts {
                    require_changed(
                        driver::execute(
                            connection,
                            INTEGER_FACT_INSERT,
                            vec![
                                Value::from_i64(document_id),
                                text(fact.attribute.as_str()),
                                Value::from_i64(fact.value),
                            ],
                        )?,
                        1,
                    )?;
                }
                for fact in document.sort_facts {
                    require_changed(
                        driver::execute(
                            connection,
                            SORT_FACT_INSERT,
                            vec![
                                Value::from_i64(document_id),
                                text(fact.attribute.as_str()),
                                Value::from_i64(fact.value),
                            ],
                        )?,
                        1,
                    )?;
                }
            }
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                kind,
            } => {
                let document_id = upsert_index_document(
                    connection,
                    &record_key,
                    &profile,
                    &partition,
                    projection_state_code(kind),
                )?;
                delete_index_facts(connection, document_id)?;
            }
            ProjectionMutation::Delete(record_key) => {
                let changed = driver::execute(
                    connection,
                    INDEX_DOCUMENT_DELETE,
                    vec![text(record_key.as_str())],
                )?;
                if !(0..=1).contains(&changed) {
                    return Err(invariant());
                }
            }
        }
    }
    Ok(())
}

fn upsert_index_document(
    connection: &Arc<Connection>,
    record_key: &PredicateRecordKey,
    profile: &Profile,
    partition: &Token,
    state: i64,
) -> Result<i64, TursoStorageError> {
    let rows = driver::query(
        connection,
        INDEX_DOCUMENT_UPSERT,
        vec![
            text(record_key.as_str()),
            text(profile.token().as_str()),
            text(partition.as_str()),
            Value::from_i64(state),
        ],
    )?;
    match rows.as_slice() {
        [row] if row.len() == 1 => required_i64(row, 0),
        _ => Err(invariant()),
    }
}

fn delete_index_facts(
    connection: &Arc<Connection>,
    document_id: i64,
) -> Result<(), TursoStorageError> {
    for sql in INDEX_FACTS_DELETE {
        let changed = driver::execute(connection, sql, vec![Value::from_i64(document_id)])?;
        if changed < 0 {
            return Err(invariant());
        }
    }
    Ok(())
}

fn projection_state_code(kind: ProjectionIncompleteKind) -> i64 {
    match kind {
        ProjectionIncompleteKind::Dirty => 1,
        ProjectionIncompleteKind::Missing => 2,
        ProjectionIncompleteKind::IncompatibleVersion => 3,
    }
}

fn load_projection_states(
    connection: &Arc<Connection>,
    keys: &[PredicateRecordKey],
) -> Result<Vec<Option<ProjectionState>>, TursoStorageError> {
    let documents = load_index_documents(connection, keys)?;
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = sql_placeholders(keys.len());
    let rows = driver::query(
        connection,
        &format!(
            "SELECT record_key, profile, partition, state FROM index_documents WHERE record_key IN ({placeholders})"
        ),
        keys.iter().map(|key| text(key.as_str())).collect(),
    )?;
    let mut states = keys
        .iter()
        .cloned()
        .zip(documents)
        .map(|(key, document)| (key, document.map(ProjectionState::Complete)))
        .collect::<HashMap<_, _>>();
    for row in rows {
        if row.len() != 4 {
            return Err(invariant());
        }
        let record_key =
            PredicateRecordKey::new(required_text(&row, 0)?).map_err(|_| invariant())?;
        let state = required_i64(&row, 3)?;
        if state == 0 {
            if states.get(&record_key).is_none_or(Option::is_none) {
                return Err(invariant());
            }
            continue;
        }
        let profile = Profile::new(Token::new(required_text(&row, 1)?).map_err(|_| invariant())?);
        let partition = Token::new(required_text(&row, 2)?).map_err(|_| invariant())?;
        states.insert(
            record_key.clone(),
            Some(ProjectionState::Incomplete {
                record_key,
                profile,
                partition,
                kind: projection_incomplete_kind(state)?,
            }),
        );
    }
    Ok(keys
        .iter()
        .map(|key| states.get(key).cloned().flatten())
        .collect())
}

fn projection_incomplete_kind(state: i64) -> Result<ProjectionIncompleteKind, TursoStorageError> {
    match state {
        1 => Ok(ProjectionIncompleteKind::Dirty),
        2 => Ok(ProjectionIncompleteKind::Missing),
        3 => Ok(ProjectionIncompleteKind::IncompatibleVersion),
        _ => Err(invariant()),
    }
}

fn load_optimistic_projections(
    connection: &Arc<Connection>,
    keys: &[PredicateRecordKey],
) -> Result<Vec<Option<EffectiveOptimisticProjection>>, TursoStorageError> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = sql_placeholders(keys.len());
    let rows = driver::query(
        connection,
        &format!(
            "SELECT id, owner_mutation_id, record_key, profile, partition, state, incomplete_kind FROM optimistic_index_documents WHERE record_key IN ({placeholders})"
        ),
        keys.iter().map(|key| text(key.as_str())).collect(),
    )?;
    let mut by_id = HashMap::with_capacity(rows.len());
    let mut projections = HashMap::with_capacity(rows.len());
    for row in rows {
        if row.len() != 7 {
            return Err(invariant());
        }
        let id = required_i64(&row, 0)?;
        let owner = u64::try_from(required_i64(&row, 1)?).map_err(|_| invariant())?;
        let record_key =
            PredicateRecordKey::new(required_text(&row, 2)?).map_err(|_| invariant())?;
        let profile = Profile::new(Token::new(required_text(&row, 3)?).map_err(|_| invariant())?);
        let partition = Token::new(required_text(&row, 4)?).map_err(|_| invariant())?;
        let incomplete_kind = nullable_i64(&row, 6)?;
        let state = match OptimisticIndexDocumentState::try_from(required_i64(&row, 5)?)? {
            OptimisticIndexDocumentState::Complete => {
                if incomplete_kind.is_some() {
                    return Err(invariant());
                }
                OptimisticProjectionState::Complete(predicate_index::IndexDocument {
                    record_key: record_key.clone(),
                    profile,
                    partition,
                    exact_facts: Vec::new(),
                    integer_facts: Vec::new(),
                    sort_facts: Vec::new(),
                })
            }
            OptimisticIndexDocumentState::Deleted => {
                if incomplete_kind.is_some() {
                    return Err(invariant());
                }
                OptimisticProjectionState::Deleted {
                    record_key: record_key.clone(),
                    profile,
                    partition,
                }
            }
            OptimisticIndexDocumentState::Incomplete => OptimisticProjectionState::Incomplete {
                record_key: record_key.clone(),
                profile,
                partition,
                kind: projection_incomplete_kind(incomplete_kind.ok_or_else(invariant)?)?,
            },
        };
        if by_id.insert(id, record_key.clone()).is_some()
            || projections
                .insert(
                    record_key,
                    EffectiveOptimisticProjection {
                        owner,
                        state,
                        uncertainty: OptimisticUncertainty::default(),
                    },
                )
                .is_some()
        {
            return Err(invariant());
        }
    }
    if by_id.is_empty() {
        return Ok(vec![None; keys.len()]);
    }

    let id_placeholders = sql_placeholders(by_id.len());
    let ids = by_id.keys().copied().collect::<Vec<_>>();
    let id_parameters = || ids.iter().copied().map(Value::from_i64).collect::<Vec<_>>();
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM optimistic_exact_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let projection = optimistic_projection_by_document_id(&mut projections, &by_id, &row)?;
        let OptimisticProjectionState::Complete(document) = &mut projection.state else {
            return Err(invariant());
        };
        document.exact_facts.push(predicate_index::ExactFact {
            attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
            value: predicate_index::ExactValue::new(required_blob(&row, 2)?)
                .map_err(|_| invariant())?,
        });
    }
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM optimistic_integer_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let projection = optimistic_projection_by_document_id(&mut projections, &by_id, &row)?;
        let OptimisticProjectionState::Complete(document) = &mut projection.state else {
            return Err(invariant());
        };
        document.integer_facts.push(predicate_index::IntegerFact {
            attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
            value: required_i64(&row, 2)?,
        });
    }
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM optimistic_sort_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let projection = optimistic_projection_by_document_id(&mut projections, &by_id, &row)?;
        let OptimisticProjectionState::Complete(document) = &mut projection.state else {
            return Err(invariant());
        };
        document.sort_facts.push(predicate_index::IntegerFact {
            attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
            value: required_i64(&row, 2)?,
        });
    }
    let mut raw_uncertainty: HashMap<i64, Vec<String>> = HashMap::new();
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute FROM optimistic_uncertain_attributes WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        raw_uncertainty
            .entry(required_i64(&row, 0)?)
            .or_default()
            .push(required_text(&row, 1)?);
    }
    for (id, attributes) in raw_uncertainty {
        let key = by_id.get(&id).ok_or_else(invariant)?;
        projections.get_mut(key).ok_or_else(invariant)?.uncertainty =
            parse_optimistic_uncertainty(attributes)?;
    }
    for projection in projections.values_mut() {
        if let OptimisticProjectionState::Complete(document) = &mut projection.state {
            document.canonicalize();
        }
        projection.validate().map_err(|_| invariant())?;
    }
    Ok(keys
        .iter()
        .map(|key| projections.get(key).cloned())
        .collect())
}

fn optimistic_projection_by_document_id<'a>(
    projections: &'a mut HashMap<PredicateRecordKey, EffectiveOptimisticProjection>,
    by_id: &HashMap<i64, PredicateRecordKey>,
    row: &[Value],
) -> Result<&'a mut EffectiveOptimisticProjection, TursoStorageError> {
    let record_key = by_id.get(&required_i64(row, 0)?).ok_or_else(invariant)?;
    projections.get_mut(record_key).ok_or_else(invariant)
}

fn parse_optimistic_uncertainty(
    attributes: Vec<String>,
) -> Result<OptimisticUncertainty, TursoStorageError> {
    let wildcard = attributes
        .iter()
        .any(|attribute| attribute == UNCERTAINTY_ALL_V1);
    let mut regular = BTreeSet::new();
    let mut certain = BTreeSet::new();
    for attribute in attributes {
        if attribute == UNCERTAINTY_ALL_V1 {
            continue;
        }
        if let Some(attribute) = attribute.strip_prefix(UNCERTAINTY_CERTAIN_V1_PREFIX) {
            if !wildcard {
                return Err(invariant());
            }
            certain.insert(Token::new(attribute).map_err(|_| invariant())?);
        } else {
            if wildcard {
                return Err(invariant());
            }
            regular.insert(Token::new(attribute).map_err(|_| invariant())?);
        }
    }
    Ok(if wildcard {
        OptimisticUncertainty::AllExcept(certain)
    } else {
        OptimisticUncertainty::Attributes(regular)
    })
}

fn sql_placeholders(count: usize) -> String {
    (1..=count)
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn load_index_documents(
    connection: &Arc<Connection>,
    keys: &[PredicateRecordKey],
) -> Result<Vec<Option<predicate_index::IndexDocument>>, TursoStorageError> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = (1..=keys.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let rows = driver::query(
        connection,
        &format!(
            "SELECT id, record_key, profile, partition FROM index_documents WHERE state = 0 AND record_key IN ({placeholders})"
        ),
        keys.iter().map(|key| text(key.as_str())).collect(),
    )?;
    let mut by_id = HashMap::with_capacity(rows.len());
    let mut documents = HashMap::with_capacity(rows.len());
    for row in rows {
        if row.len() != 4 {
            return Err(invariant());
        }
        let id = required_i64(&row, 0)?;
        let record_key =
            PredicateRecordKey::new(required_text(&row, 1)?).map_err(|_| invariant())?;
        let profile = Profile::new(Token::new(required_text(&row, 2)?).map_err(|_| invariant())?);
        let partition = Token::new(required_text(&row, 3)?).map_err(|_| invariant())?;
        by_id.insert(id, record_key.clone());
        documents.insert(
            record_key.clone(),
            predicate_index::IndexDocument {
                record_key,
                profile,
                partition,
                exact_facts: Vec::new(),
                integer_facts: Vec::new(),
                sort_facts: Vec::new(),
            },
        );
    }
    if by_id.is_empty() {
        return Ok(vec![None; keys.len()]);
    }

    let id_placeholders = (1..=by_id.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let ids = by_id.keys().copied().collect::<Vec<_>>();
    let id_parameters = || ids.iter().copied().map(Value::from_i64).collect::<Vec<_>>();
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM exact_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let record_key = by_id.get(&required_i64(&row, 0)?).ok_or_else(invariant)?;
        documents
            .get_mut(record_key)
            .ok_or_else(invariant)?
            .exact_facts
            .push(predicate_index::ExactFact {
                attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
                value: predicate_index::ExactValue::new(required_blob(&row, 2)?)
                    .map_err(|_| invariant())?,
            });
    }
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM integer_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let record_key = by_id.get(&required_i64(&row, 0)?).ok_or_else(invariant)?;
        documents
            .get_mut(record_key)
            .ok_or_else(invariant)?
            .integer_facts
            .push(predicate_index::IntegerFact {
                attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
                value: required_i64(&row, 2)?,
            });
    }
    for row in driver::query(
        connection,
        &format!(
            "SELECT document_id, attribute, value FROM sort_facts WHERE document_id IN ({id_placeholders})"
        ),
        id_parameters(),
    )? {
        let record_key = by_id.get(&required_i64(&row, 0)?).ok_or_else(invariant)?;
        documents
            .get_mut(record_key)
            .ok_or_else(invariant)?
            .sort_facts
            .push(predicate_index::IntegerFact {
                attribute: Token::new(required_text(&row, 1)?).map_err(|_| invariant())?,
                value: required_i64(&row, 2)?,
            });
    }

    for document in documents.values() {
        document.validate().map_err(|_| invariant())?;
    }
    Ok(keys.iter().map(|key| documents.get(key).cloned()).collect())
}

fn predicate_scope_is_incomplete(
    connection: &Arc<Connection>,
    query: &ValidatedIndexQuery,
) -> Result<bool, TursoStorageError> {
    let descriptor = query.as_query();
    let clauses = descriptor
        .partitions
        .iter()
        .map(|_| "(profile = ? AND partition = ?)")
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT 1 FROM index_documents AS d WHERE d.state <> 0 AND ({clauses}) AND NOT EXISTS (SELECT 1 FROM optimistic_index_documents AS o WHERE o.record_key = d.record_key) LIMIT 1"
    );
    let mut parameters = Vec::with_capacity(descriptor.partitions.len() * 2);
    for partition in &descriptor.partitions {
        parameters.push(text(descriptor.profile.token().as_str()));
        parameters.push(text(partition.partition.as_str()));
    }
    Ok(!driver::query(connection, &sql, parameters)?.is_empty())
}

#[derive(Clone, Copy, Debug, Default)]
struct OptimisticQueryStatus {
    has_shadow: bool,
    incomplete: bool,
}

fn optimistic_query_status(
    connection: &Arc<Connection>,
    query: &ValidatedIndexQuery,
) -> Result<OptimisticQueryStatus, TursoStorageError> {
    let descriptor = query.as_query();
    let current_clauses = descriptor
        .partitions
        .iter()
        .map(|_| "(d.profile = ? AND d.partition = ?)")
        .collect::<Vec<_>>()
        .join(" OR ");
    let authority_clauses = descriptor
        .partitions
        .iter()
        .map(|_| "(a.profile = ? AND a.partition = ?)")
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(
        "SELECT d.id, d.profile, d.partition, d.state, u.attribute FROM optimistic_index_documents AS d LEFT JOIN optimistic_uncertain_attributes AS u ON u.document_id = d.id WHERE ({current_clauses}) OR EXISTS (SELECT 1 FROM index_documents AS a WHERE a.record_key = d.record_key AND ({authority_clauses})) ORDER BY d.id, u.attribute"
    );
    let mut parameters = Vec::with_capacity(descriptor.partitions.len() * 4);
    for _ in 0..2 {
        for partition in &descriptor.partitions {
            parameters.push(text(descriptor.profile.token().as_str()));
            parameters.push(text(partition.partition.as_str()));
        }
    }
    let rows = driver::query(connection, &sql, parameters)?;
    let mut status = OptimisticQueryStatus {
        has_shadow: !rows.is_empty(),
        incomplete: false,
    };
    let mut uncertainty: HashMap<(i64, Token), Vec<String>> = HashMap::new();
    for row in rows {
        if row.len() != 5 {
            return Err(invariant());
        }
        let profile = Profile::new(Token::new(required_text(&row, 1)?).map_err(|_| invariant())?);
        let partition = Token::new(required_text(&row, 2)?).map_err(|_| invariant())?;
        let current_scope = query.includes_scope(&profile, &partition);
        let state = OptimisticIndexDocumentState::try_from(required_i64(&row, 3)?)?;
        if current_scope && state == OptimisticIndexDocumentState::Incomplete {
            status.incomplete = true;
            return Ok(status);
        }
        if current_scope && let Some(attribute) = nullable_text(&row, 4)? {
            uncertainty
                .entry((required_i64(&row, 0)?, partition))
                .or_default()
                .push(attribute);
        }
    }
    for ((_, partition), attributes) in uncertainty {
        let uncertainty = parse_optimistic_uncertainty(attributes)?;
        if query
            .dependent_attributes(&partition)
            .iter()
            .any(|attribute| uncertainty.affects(attribute))
        {
            status.incomplete = true;
            break;
        }
    }
    Ok(status)
}

fn compile_predicate_sql(query: &ValidatedIndexQuery) -> (String, Vec<Value>) {
    let descriptor = query.as_query();
    let mut compiler = SqlPredicateCompiler::new();
    let roots = descriptor
        .partitions
        .iter()
        .map(|partition| {
            compiler.compile(
                &partition.predicate,
                &descriptor.profile,
                &partition.partition,
            )
        })
        .collect::<Vec<_>>();
    let matches = compiler.next_name();
    let union = roots
        .iter()
        .map(|root| format!("SELECT source, document_id FROM {root}"))
        .collect::<Vec<_>>()
        .join(" UNION ");
    compiler
        .ctes
        .push(format!("{matches}(source, document_id) AS ({union})"));
    let effective_sort = compiler.next_name();
    compiler
        .parameters
        .push(text(descriptor.sort_attribute.as_str()));
    compiler
        .parameters
        .push(text(descriptor.sort_attribute.as_str()));
    compiler.ctes.push(format!(
        "{effective_sort}(source, document_id, value) AS (SELECT 0, document_id, value FROM sort_facts WHERE attribute = ? UNION ALL SELECT 1, document_id, value FROM optimistic_sort_facts WHERE attribute = ?)"
    ));
    compiler
        .parameters
        .push(Value::from_i64(i64::from(descriptor.limit)));
    let sort_direction = match descriptor.sort_direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };
    let tie_direction = match descriptor.tie_break_direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };
    let sql = format!(
        "WITH {} SELECT d.record_key FROM {matches} AS m JOIN effective_documents AS d ON d.source = m.source AND d.document_id = m.document_id JOIN {effective_sort} AS s ON s.source = m.source AND s.document_id = m.document_id ORDER BY s.value {sort_direction}, d.record_key {tie_direction} LIMIT ?",
        compiler.ctes.join(", ")
    );
    (sql, compiler.parameters)
}

struct SqlPredicateCompiler {
    ctes: Vec<String>,
    parameters: Vec<Value>,
    next_id: usize,
}

impl SqlPredicateCompiler {
    fn new() -> Self {
        Self {
            ctes: vec![
                "effective_documents(source, document_id, record_key, profile, partition) AS (SELECT 0, d.id, d.record_key, d.profile, d.partition FROM index_documents AS d WHERE d.state = 0 AND NOT EXISTS (SELECT 1 FROM optimistic_index_documents AS o WHERE o.record_key = d.record_key) UNION ALL SELECT 1, o.id, o.record_key, o.profile, o.partition FROM optimistic_index_documents AS o WHERE o.state = 0)".to_owned(),
            ],
            parameters: Vec::new(),
            next_id: 0,
        }
    }

    fn next_name(&mut self) -> String {
        let name = format!("expr_{}", self.next_id);
        self.next_id += 1;
        name
    }

    fn compile(&mut self, expr: &PredicateExpr, profile: &Profile, partition: &Token) -> String {
        match expr {
            PredicateExpr::All => self.universe(profile, partition),
            PredicateExpr::None => {
                let name = self.next_name();
                self.ctes.push(format!(
                    "{name}(source, document_id) AS (SELECT source, document_id FROM effective_documents WHERE 0)"
                ));
                name
            }
            PredicateExpr::Exact { attribute, value } => {
                let name = self.next_name();
                for _ in 0..2 {
                    self.parameters.push(text(profile.token().as_str()));
                    self.parameters.push(text(partition.as_str()));
                    self.parameters.push(text(attribute.as_str()));
                    self.parameters
                        .push(Value::from_blob(value.as_bytes().to_vec()));
                }
                self.ctes.push(format!(
                    "{name}(source, document_id) AS (SELECT 0, f.document_id FROM exact_facts AS f JOIN effective_documents AS d ON d.source = 0 AND d.document_id = f.document_id WHERE d.profile = ? AND d.partition = ? AND f.attribute = ? AND f.value = ? UNION SELECT 1, f.document_id FROM optimistic_exact_facts AS f JOIN effective_documents AS d ON d.source = 1 AND d.document_id = f.document_id WHERE d.profile = ? AND d.partition = ? AND f.attribute = ? AND f.value = ?)"
                ));
                name
            }
            PredicateExpr::I64Range {
                attribute,
                lower,
                upper,
            } => {
                let name = self.next_name();
                let mut range = String::new();
                if let Some(bound) = lower {
                    let (operator, _) = sql_bound(*bound, true);
                    range.push_str(&format!(" AND f.value {operator} ?"));
                }
                if let Some(bound) = upper {
                    let (operator, _) = sql_bound(*bound, false);
                    range.push_str(&format!(" AND f.value {operator} ?"));
                }
                for _ in 0..2 {
                    self.parameters.push(text(profile.token().as_str()));
                    self.parameters.push(text(partition.as_str()));
                    self.parameters.push(text(attribute.as_str()));
                    if let Some(bound) = lower {
                        self.parameters
                            .push(Value::from_i64(sql_bound(*bound, true).1));
                    }
                    if let Some(bound) = upper {
                        self.parameters
                            .push(Value::from_i64(sql_bound(*bound, false).1));
                    }
                }
                self.ctes.push(format!(
                    "{name}(source, document_id) AS (SELECT 0, f.document_id FROM integer_facts AS f JOIN effective_documents AS d ON d.source = 0 AND d.document_id = f.document_id WHERE d.profile = ? AND d.partition = ? AND f.attribute = ?{range} UNION SELECT 1, f.document_id FROM optimistic_integer_facts AS f JOIN effective_documents AS d ON d.source = 1 AND d.document_id = f.document_id WHERE d.profile = ? AND d.partition = ? AND f.attribute = ?{range})"
                ));
                name
            }
            PredicateExpr::And(left, right) | PredicateExpr::Or(left, right) => {
                let left = self.compile(left, profile, partition);
                let right = self.compile(right, profile, partition);
                let operator = if matches!(expr, PredicateExpr::And(_, _)) {
                    "INTERSECT"
                } else {
                    "UNION"
                };
                let name = self.next_name();
                self.ctes.push(format!(
                    "{name}(source, document_id) AS (SELECT source, document_id FROM {left} {operator} SELECT source, document_id FROM {right})"
                ));
                name
            }
            PredicateExpr::Not(expr) => {
                let universe = self.universe(profile, partition);
                let child = self.compile(expr, profile, partition);
                let name = self.next_name();
                self.ctes.push(format!(
                    "{name}(source, document_id) AS (SELECT source, document_id FROM {universe} EXCEPT SELECT source, document_id FROM {child})"
                ));
                name
            }
        }
    }

    fn universe(&mut self, profile: &Profile, partition: &Token) -> String {
        let name = self.next_name();
        self.parameters.push(text(profile.token().as_str()));
        self.parameters.push(text(partition.as_str()));
        self.ctes.push(format!(
            "{name}(source, document_id) AS (SELECT source, document_id FROM effective_documents WHERE profile = ? AND partition = ?)"
        ));
        name
    }
}

fn sql_bound(bound: RangeBound, lower: bool) -> (&'static str, i64) {
    match (lower, bound) {
        (true, RangeBound::Inclusive(value)) => (">=", value),
        (true, RangeBound::Exclusive(value)) => (">", value),
        (false, RangeBound::Inclusive(value)) => ("<=", value),
        (false, RangeBound::Exclusive(value)) => ("<", value),
    }
}

fn initialize(
    connection: &Arc<Connection>,
    scope: &str,
    fresh: bool,
) -> Result<(), TursoStorageError> {
    enable_foreign_keys(connection).map_err(TursoStorageError::initialization)?;
    if fresh {
        driver::write_transaction(connection, || {
            for sql in CREATE_SCHEMA {
                driver::execute(connection, sql, Vec::new())?;
            }
            driver::execute(
                connection,
                "INSERT INTO meta (key, value) VALUES ('scope', ?1)",
                vec![text(scope)],
            )?;
            driver::execute(
                connection,
                "INSERT INTO meta (key, value) VALUES ('namespace', ?1)",
                vec![text(&cache_namespace(scope))],
            )?;
            driver::execute(
                connection,
                "INSERT INTO meta (key, value) VALUES ('storage_schema_version', ?1)",
                vec![text(&STORAGE_SCHEMA_VERSION.to_string())],
            )?;
            Ok(())
        })
        .map_err(TursoStorageError::initialization)?;
        enable_foreign_keys(connection).map_err(TursoStorageError::initialization)?;
        validate_frozen_schema(connection)?;
        return Ok(());
    }

    validate_quick_check(connection)?;
    validate_frozen_schema(connection)?;
    let metadata = driver::query(
        connection,
        "SELECT key, value FROM meta WHERE key IN ('scope', 'namespace', 'storage_schema_version') ORDER BY key ASC",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected = [
        ("namespace", cache_namespace(scope)),
        ("scope", scope.to_owned()),
        ("storage_schema_version", STORAGE_SCHEMA_VERSION.to_string()),
    ];
    if metadata.len() != expected.len() {
        return Err(TursoStorageError::reset(PhysicalResetReason::Compatibility));
    }
    for (row, (expected_key, expected_value)) in metadata.iter().zip(expected) {
        let key = required_text(row, 0)
            .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Compatibility))?;
        let value = required_text(row, 1)
            .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Compatibility))?;
        if key != expected_key || value != expected_value {
            return Err(TursoStorageError::reset(PhysicalResetReason::Compatibility));
        }
    }
    for sql in [
        RECORD_GET,
        RECORD_UPSERT,
        RECORD_DELETE,
        SEARCH_DELETE,
        SEARCH_UPSERT,
        SEARCH_LOAD,
        SEARCH_BROWSE,
        SEARCH_BROWSE_AFTER,
        INDEX_DOCUMENT_UPSERT,
        INDEX_DOCUMENT_ID,
        INDEX_DOCUMENT_DELETE,
        EXACT_FACT_INSERT,
        INTEGER_FACT_INSERT,
        SORT_FACT_INSERT,
        QUEUE_INSERT,
        LAYER_INSERT,
        QUEUE_SELECT,
        QUEUE_HEAD_SELECT,
        ORPHAN_LAYER_SELECT,
        CLAIM_SELECT,
        REQUIRE_LAYER_SELECT,
        QUEUE_DIAGNOSTICS_SELECT,
        OPTIMISTIC_INDEX_DOCUMENT_INSERT,
        OPTIMISTIC_INDEX_DOCUMENT_DELETE,
        OPTIMISTIC_EXACT_FACT_INSERT,
        OPTIMISTIC_INTEGER_FACT_INSERT,
        OPTIMISTIC_SORT_FACT_INSERT,
        OPTIMISTIC_UNCERTAINTY_INSERT,
    ] {
        driver::validate(connection, sql).map_err(TursoStorageError::initialization)?;
    }
    for sql in INDEX_FACTS_DELETE {
        driver::validate(connection, sql).map_err(TursoStorageError::initialization)?;
    }
    validate_queue_consistency(connection)?;
    validate_optimistic_shadow_consistency(connection)
}

fn enable_foreign_keys(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    driver::execute(connection, "PRAGMA foreign_keys = ON", Vec::new())?;
    let rows = driver::query(connection, "PRAGMA foreign_keys", Vec::new())?;
    if rows.len() == 1 && required_i64(&rows[0], 0)? == 1 {
        Ok(())
    } else {
        Err(TursoStorageError::reset(PhysicalResetReason::Invariant))
    }
}

#[derive(Clone, Copy)]
struct ColumnSpec {
    name: &'static str,
    declared_type: &'static str,
    not_null: bool,
    default_zero: bool,
    primary_key_position: i64,
}

const META_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "key",
        declared_type: "TEXT",
        not_null: false,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "value",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const RECORD_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "__typename",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "id",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
    ColumnSpec {
        name: "value",
        declared_type: "BLOB",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const SEARCH_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "profile",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "__typename",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
    ColumnSpec {
        name: "id",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 3,
    },
    ColumnSpec {
        name: "bucket",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "search_text",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "timestamp_ms",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "source_hash",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const MUTATION_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "id",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "query",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "operation_name",
        declared_type: "TEXT",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "variables_json",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "identity",
        declared_type: "TEXT",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "attempt_count",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: true,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "next_attempt_at_ms",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "lease_owner",
        declared_type: "TEXT",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "lease_generation",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: true,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "lease_expires_at_ms",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "last_error",
        declared_type: "TEXT",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "created_at_ms",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const OPTIMISTIC_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "mutation_id",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "optimistic_data_json",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "normalized_updates",
        declared_type: "BLOB",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const INDEX_DOCUMENT_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "id",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "record_key",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "profile",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "partition",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "state",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const EXACT_FACT_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "document_id",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "attribute",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
    ColumnSpec {
        name: "value",
        declared_type: "BLOB",
        not_null: true,
        default_zero: false,
        primary_key_position: 3,
    },
];

const INTEGER_FACT_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "document_id",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "attribute",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
    ColumnSpec {
        name: "value",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 3,
    },
];

const SORT_FACT_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "document_id",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "attribute",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
    ColumnSpec {
        name: "value",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
];

const OPTIMISTIC_INDEX_DOCUMENT_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "id",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "owner_mutation_id",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "record_key",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "profile",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "partition",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "state",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 0,
    },
    ColumnSpec {
        name: "incomplete_kind",
        declared_type: "INTEGER",
        not_null: false,
        default_zero: false,
        primary_key_position: 0,
    },
];

const OPTIMISTIC_UNCERTAIN_ATTRIBUTE_COLUMNS: &[ColumnSpec] = &[
    ColumnSpec {
        name: "document_id",
        declared_type: "INTEGER",
        not_null: true,
        default_zero: false,
        primary_key_position: 1,
    },
    ColumnSpec {
        name: "attribute",
        declared_type: "TEXT",
        not_null: true,
        default_zero: false,
        primary_key_position: 2,
    },
];

fn validate_frozen_schema(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    validate_allowed_schema_objects(connection)?;
    validate_table_columns(connection, "meta", META_COLUMNS)?;
    validate_table_columns(connection, "records", RECORD_COLUMNS)?;
    validate_table_columns(connection, "search_documents", SEARCH_COLUMNS)?;
    validate_table_columns(connection, "mutation_queue", MUTATION_COLUMNS)?;
    validate_table_columns(connection, "optimistic_layers", OPTIMISTIC_COLUMNS)?;
    validate_table_columns(connection, "index_documents", INDEX_DOCUMENT_COLUMNS)?;
    validate_table_columns(connection, "exact_facts", EXACT_FACT_COLUMNS)?;
    validate_table_columns(connection, "integer_facts", INTEGER_FACT_COLUMNS)?;
    validate_table_columns(connection, "sort_facts", SORT_FACT_COLUMNS)?;
    validate_table_columns(
        connection,
        "optimistic_index_documents",
        OPTIMISTIC_INDEX_DOCUMENT_COLUMNS,
    )?;
    validate_table_columns(connection, "optimistic_exact_facts", EXACT_FACT_COLUMNS)?;
    validate_table_columns(connection, "optimistic_integer_facts", INTEGER_FACT_COLUMNS)?;
    validate_table_columns(connection, "optimistic_sort_facts", SORT_FACT_COLUMNS)?;
    validate_table_columns(
        connection,
        "optimistic_uncertain_attributes",
        OPTIMISTIC_UNCERTAIN_ATTRIBUTE_COLUMNS,
    )?;
    validate_table_indexes(connection, "meta", &[(0, "key")])?;
    validate_table_indexes(connection, "records", &[(0, "__typename"), (1, "id")])?;
    validate_search_indexes(connection)?;
    validate_mutation_queue_indexes(connection)?;
    validate_table_indexes(connection, "optimistic_layers", &[])?;
    validate_predicate_indexes(connection)?;
    validate_optimistic_predicate_indexes(connection)?;
    validate_table_indexes(
        connection,
        "optimistic_uncertain_attributes",
        &[(0, "document_id"), (1, "attribute")],
    )?;
    validate_table_constraints(connection, "meta", false)?;
    validate_table_constraints(connection, "records", false)?;
    validate_table_constraints(connection, "search_documents", false)?;
    validate_table_constraints(connection, "mutation_queue", true)?;
    validate_table_constraints(connection, "optimistic_layers", false)?;
    validate_table_constraints(connection, "index_documents", false)?;
    validate_table_constraints(connection, "exact_facts", false)?;
    validate_table_constraints(connection, "integer_facts", false)?;
    validate_table_constraints(connection, "sort_facts", false)?;
    validate_table_constraints(connection, "optimistic_index_documents", false)?;
    validate_table_constraints(connection, "optimistic_exact_facts", false)?;
    validate_table_constraints(connection, "optimistic_integer_facts", false)?;
    validate_table_constraints(connection, "optimistic_sort_facts", false)?;
    validate_table_constraints(connection, "optimistic_uncertain_attributes", false)?;
    validate_no_foreign_keys(connection, "meta")?;
    validate_no_foreign_keys(connection, "records")?;
    validate_no_foreign_keys(connection, "search_documents")?;
    validate_no_foreign_keys(connection, "mutation_queue")?;
    validate_no_foreign_keys(connection, "index_documents")?;
    validate_optimistic_foreign_key(connection)?;
    validate_fact_foreign_key(connection, "exact_facts", "index_documents")?;
    validate_fact_foreign_key(connection, "integer_facts", "index_documents")?;
    validate_fact_foreign_key(connection, "sort_facts", "index_documents")?;
    validate_shadow_document_foreign_key(connection)?;
    validate_fact_foreign_key(
        connection,
        "optimistic_exact_facts",
        "optimistic_index_documents",
    )?;
    validate_fact_foreign_key(
        connection,
        "optimistic_integer_facts",
        "optimistic_index_documents",
    )?;
    validate_fact_foreign_key(
        connection,
        "optimistic_sort_facts",
        "optimistic_index_documents",
    )?;
    validate_fact_foreign_key(
        connection,
        "optimistic_uncertain_attributes",
        "optimistic_index_documents",
    )
}

const SQLITE_SEQUENCE_TABLE: &str = "sqlite_sequence";
const TURSO_AUTOINCREMENT_TABLE: &str =
    "__turso_internal_seq___turso_internal_autoincrement_mutation_queue";

fn validate_allowed_schema_objects(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT type, name, sql FROM sqlite_schema ORDER BY type ASC, name ASC",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected = [
        "exact_facts",
        "index_documents",
        "integer_facts",
        "meta",
        "mutation_queue",
        "optimistic_exact_facts",
        "optimistic_index_documents",
        "optimistic_integer_facts",
        "optimistic_layers",
        "optimistic_sort_facts",
        "optimistic_uncertain_attributes",
        "records",
        "search_documents",
        "sort_facts",
    ];
    let named_indexes = [
        "exact_facts_lookup_idx",
        "index_documents_scope_idx",
        "integer_facts_lookup_idx",
        "index_documents_record_key_idx",
        "mutation_queue_created_at_ms_idx",
        "optimistic_exact_facts_lookup_idx",
        "optimistic_index_documents_owner_idx",
        "optimistic_index_documents_record_key_idx",
        "optimistic_index_documents_scope_idx",
        "optimistic_integer_facts_lookup_idx",
        "optimistic_sort_facts_lookup_idx",
        "search_documents_browse_idx",
        "sort_facts_lookup_idx",
    ];
    let support = [SQLITE_SEQUENCE_TABLE, TURSO_AUTOINCREMENT_TABLE];
    let mut seen = vec![false; expected.len()];
    let mut named_index_seen = vec![false; named_indexes.len()];
    let mut support_seen = [false; 2];
    for row in rows {
        if row.len() != 3 {
            return Err(compatibility());
        }
        let object_type = required_text(&row, 0).map_err(|_| compatibility())?;
        let name = required_text(&row, 1).map_err(|_| compatibility())?;
        if let Some(position) = expected.iter().position(|expected| *expected == name) {
            if object_type != "table"
                || !matches!(row.get(2), Some(Value::Text(_)))
                || seen[position]
            {
                return Err(compatibility());
            }
            seen[position] = true;
            continue;
        }
        if object_type == "index" && matches!(row.get(2), Some(Value::Null)) {
            continue;
        }
        if let Some(position) = named_indexes.iter().position(|expected| *expected == name) {
            if object_type != "index"
                || !matches!(row.get(2), Some(Value::Text(_)))
                || named_index_seen[position]
            {
                return Err(compatibility());
            }
            named_index_seen[position] = true;
            continue;
        }
        if let Some(position) = support.iter().position(|expected| *expected == name) {
            if object_type != "table"
                || !matches!(row.get(2), Some(Value::Text(_)))
                || support_seen[position]
            {
                return Err(compatibility());
            }
            validate_support_table(connection, &name, position)?;
            support_seen[position] = true;
            continue;
        }
        return Err(compatibility());
    }
    if seen.into_iter().all(|present| present)
        && named_index_seen.into_iter().all(|present| present)
        && support_seen.into_iter().all(|present| present)
    {
        Ok(())
    } else {
        Err(compatibility())
    }
}

fn validate_support_table(
    connection: &Arc<Connection>,
    table: &str,
    support_position: usize,
) -> Result<(), TursoStorageError> {
    let escaped = table.replace('\'', "''");
    let rows = driver::query(
        connection,
        &format!("PRAGMA table_xinfo('{escaped}')"),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let sqlite_sequence = [("name", "", 0, 0), ("seq", "", 0, 0)];
    let turso_autoincrement = [
        ("value", "INTEGER", 0, 1),
        ("is_called", "INTEGER", 0, 0),
        ("start", "INTEGER", 0, 0),
        ("inc", "INTEGER", 0, 0),
        ("min", "INTEGER", 0, 0),
        ("max", "INTEGER", 0, 0),
        ("cycle", "INTEGER", 0, 0),
    ];
    let expected: &[_] = match support_position {
        0 => &sqlite_sequence,
        1 => &turso_autoincrement,
        _ => return Err(compatibility()),
    };
    if rows.len() != expected.len() {
        return Err(compatibility());
    }
    for (position, (row, (expected_name, expected_type, expected_not_null, expected_pk))) in
        rows.iter().zip(expected).enumerate()
    {
        if row.len() != 7
            || required_i64(row, 0).ok() != i64::try_from(position).ok()
            || required_text(row, 1).ok().as_deref() != Some(*expected_name)
            || required_text(row, 2).ok().as_deref() != Some(*expected_type)
            || required_i64(row, 3).ok() != Some(*expected_not_null)
            || !matches!(row.get(4), Some(Value::Null))
            || required_i64(row, 5).ok() != Some(*expected_pk)
            || required_i64(row, 6).ok() != Some(0)
        {
            return Err(compatibility());
        }
    }
    if !driver::query(
        connection,
        &format!("PRAGMA index_list('{escaped}')"),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?
    .is_empty()
        || !driver::query(
            connection,
            &format!("PRAGMA foreign_key_list('{escaped}')"),
            Vec::new(),
        )
        .map_err(TursoStorageError::initialization)?
        .is_empty()
    {
        return Err(compatibility());
    }
    Ok(())
}

fn validate_table_columns(
    connection: &Arc<Connection>,
    table: &str,
    expected: &[ColumnSpec],
) -> Result<(), TursoStorageError> {
    let sql = format!("PRAGMA table_xinfo('{table}')");
    let rows =
        driver::query(connection, &sql, Vec::new()).map_err(TursoStorageError::initialization)?;
    if rows.len() != expected.len() {
        return Err(compatibility());
    }
    for (position, (row, expected)) in rows.iter().zip(expected).enumerate() {
        if row.len() != 7
            || required_i64(row, 0).ok() != i64::try_from(position).ok()
            || required_text(row, 1).ok().as_deref() != Some(expected.name)
            || required_text(row, 2)
                .ok()
                .is_none_or(|value| value.trim().to_ascii_uppercase() != expected.declared_type)
            || required_i64(row, 3).ok() != Some(i64::from(expected.not_null))
            || !default_matches(row.get(4), expected.default_zero)
            || required_i64(row, 5).ok() != Some(expected.primary_key_position)
            || required_i64(row, 6).ok() != Some(0)
        {
            return Err(compatibility());
        }
    }
    Ok(())
}

fn default_matches(value: Option<&Value>, expected_zero: bool) -> bool {
    match (value, expected_zero) {
        (Some(Value::Null), false) => true,
        (Some(Value::Text(value)), true) => {
            value.as_str().chars().all(|character| {
                character == '0'
                    || character == '('
                    || character == ')'
                    || character.is_whitespace()
            }) && value.as_str().contains('0')
        }
        (Some(Value::Numeric(Numeric::Integer(0))), true) => true,
        _ => false,
    }
}

fn validate_search_indexes(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "PRAGMA index_list('search_documents')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    if rows.len() != 2 {
        return Err(compatibility());
    }
    let browse = rows
        .iter()
        .find(|row| required_text(row, 1).ok().as_deref() == Some("search_documents_browse_idx"))
        .ok_or_else(compatibility)?;
    if browse.len() != 5
        || required_i64(browse, 2).ok() != Some(0)
        || required_text(browse, 3).ok().as_deref() != Some("c")
        || required_i64(browse, 4).ok() != Some(0)
    {
        return Err(compatibility());
    }
    let primary = rows
        .iter()
        .find(|row| required_text(row, 3).ok().as_deref() == Some("pk"))
        .ok_or_else(compatibility)?;
    if primary.len() != 5
        || required_i64(primary, 2).ok() != Some(1)
        || required_i64(primary, 4).ok() != Some(0)
    {
        return Err(compatibility());
    }

    let index_rows = driver::query(
        connection,
        "PRAGMA index_xinfo('search_documents_browse_idx')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected = [
        (0, "profile", 0, 1),
        (3, "bucket", 0, 1),
        (5, "timestamp_ms", 1, 1),
        (1, "__typename", 0, 1),
        (2, "id", 0, 1),
    ];
    if index_rows.len() != expected.len() + 1 {
        return Err(compatibility());
    }
    for (sequence, (row, (column, name, descending, key))) in
        index_rows.iter().zip(expected).enumerate()
    {
        if row.len() != 6
            || required_i64(row, 0).ok() != i64::try_from(sequence).ok()
            || required_i64(row, 1).ok() != Some(column)
            || required_text(row, 2).ok().as_deref() != Some(name)
            || required_i64(row, 3).ok() != Some(descending)
            || required_text(row, 4).ok().as_deref() != Some("BINARY")
            || required_i64(row, 5).ok() != Some(key)
        {
            return Err(compatibility());
        }
    }
    let rowid = index_rows.last().ok_or_else(compatibility)?;
    if rowid.len() != 6
        || required_i64(rowid, 0).ok() != Some(expected.len() as i64)
        || required_i64(rowid, 1).ok() != Some(-1)
        || required_i64(rowid, 3).ok() != Some(0)
        || required_text(rowid, 4).ok().as_deref() != Some("BINARY")
        || required_i64(rowid, 5).ok() != Some(0)
    {
        return Err(compatibility());
    }
    Ok(())
}

fn validate_mutation_queue_indexes(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "PRAGMA index_list('mutation_queue')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = rows.as_slice() else {
        return Err(compatibility());
    };
    if row.len() != 5
        || required_i64(row, 0).ok() != Some(0)
        || required_text(row, 1).ok().as_deref() != Some("mutation_queue_created_at_ms_idx")
        || required_i64(row, 2).ok() != Some(0)
        || required_text(row, 3).ok().as_deref() != Some("c")
        || required_i64(row, 4).ok() != Some(0)
    {
        return Err(compatibility());
    }
    let index_rows = driver::query(
        connection,
        "PRAGMA index_xinfo('mutation_queue_created_at_ms_idx')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let [created_at, rowid] = index_rows.as_slice() else {
        return Err(compatibility());
    };
    if created_at.len() != 6
        || required_i64(created_at, 0).ok() != Some(0)
        || required_i64(created_at, 1).ok() != Some(11)
        || required_text(created_at, 2).ok().as_deref() != Some("created_at_ms")
        || required_i64(created_at, 3).ok() != Some(0)
        || required_text(created_at, 4).ok().as_deref() != Some("BINARY")
        || required_i64(created_at, 5).ok() != Some(1)
        || rowid.len() != 6
        || required_i64(rowid, 0).ok() != Some(1)
        || required_i64(rowid, 1).ok() != Some(-1)
        || !rowid.get(2).is_some_and(|value| {
            matches!(value, Value::Null)
                || matches!(value, Value::Text(text) if text.as_str().is_empty())
        })
        || required_i64(rowid, 3).ok() != Some(0)
        || required_text(rowid, 4).ok().as_deref() != Some("BINARY")
        || required_i64(rowid, 5).ok() != Some(0)
    {
        return Err(compatibility());
    }
    Ok(())
}

fn validate_table_indexes(
    connection: &Arc<Connection>,
    table: &str,
    expected_key_columns: &[(i64, &str)],
) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        &format!("PRAGMA index_list('{}')", table.replace('\'', "''")),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected_index_count = usize::from(!expected_key_columns.is_empty());
    if rows.len() != expected_index_count {
        return Err(compatibility());
    }
    let Some(row) = rows.first() else {
        return Ok(());
    };
    if row.len() != 5
        || required_i64(row, 0).ok() != Some(0)
        || required_i64(row, 2).ok() != Some(1)
        || required_text(row, 3).ok().as_deref() != Some("pk")
        || required_i64(row, 4).ok() != Some(0)
    {
        return Err(compatibility());
    }
    let index_name = required_text(row, 1).map_err(|_| compatibility())?;
    let index_rows = driver::query(
        connection,
        &format!("PRAGMA index_xinfo('{}')", index_name.replace('\'', "''")),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    if index_rows.len() != expected_key_columns.len() + 1 {
        return Err(compatibility());
    }
    for (sequence, (row, (expected_column_id, expected_name))) in
        index_rows.iter().zip(expected_key_columns).enumerate()
    {
        if row.len() != 6
            || required_i64(row, 0).ok() != i64::try_from(sequence).ok()
            || required_i64(row, 1).ok() != Some(*expected_column_id)
            || required_text(row, 2).ok().as_deref() != Some(*expected_name)
            || required_i64(row, 3).ok() != Some(0)
            || required_text(row, 4).ok().as_deref() != Some("BINARY")
            || required_i64(row, 5).ok() != Some(1)
        {
            return Err(compatibility());
        }
    }
    let Some(rowid) = index_rows.last() else {
        return Err(compatibility());
    };
    if rowid.len() != 6
        || required_i64(rowid, 0).ok() != i64::try_from(expected_key_columns.len()).ok()
        || required_i64(rowid, 1).ok() != Some(-1)
        || !rowid.get(2).is_some_and(|value| {
            matches!(value, Value::Null)
                || matches!(value, Value::Text(text) if text.as_str().is_empty())
        })
        || required_i64(rowid, 3).ok() != Some(0)
        || required_text(rowid, 4).ok().as_deref() != Some("BINARY")
        || required_i64(rowid, 5).ok() != Some(0)
    {
        return Err(compatibility());
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum SchemaToken {
    Word(String),
    QuotedIdentifier,
    StringLiteral,
    Symbol,
}

impl SchemaToken {
    fn is_keyword(&self, expected: &str) -> bool {
        matches!(self, Self::Word(word) if word == expected)
    }
}

fn validate_table_constraints(
    connection: &Arc<Connection>,
    table: &str,
    expects_autoincrement: bool,
) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?1",
        vec![text(table)],
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = rows.as_slice() else {
        return Err(compatibility());
    };
    if row.len() != 1 {
        return Err(compatibility());
    }
    let sql = required_text(row, 0).map_err(|_| compatibility())?;
    let tokens = lex_schema(&sql)?;
    if has_forbidden_table_syntax(&tokens) {
        return Err(compatibility());
    }
    let autoincrement_count = tokens
        .iter()
        .filter(|token| token.is_keyword("autoincrement"))
        .count();
    if !expects_autoincrement {
        return (autoincrement_count == 0)
            .then_some(())
            .ok_or_else(compatibility);
    }
    let declaration_count = tokens
        .windows(4)
        .filter(|window| {
            window[0].is_keyword("integer")
                && window[1].is_keyword("primary")
                && window[2].is_keyword("key")
                && window[3].is_keyword("autoincrement")
        })
        .count();
    if autoincrement_count == 1 && declaration_count == 1 {
        Ok(())
    } else {
        Err(compatibility())
    }
}

fn has_forbidden_table_syntax(tokens: &[SchemaToken]) -> bool {
    ["as", "check", "collate", "generated", "unique"]
        .into_iter()
        .any(|keyword| tokens.iter().any(|token| token.is_keyword(keyword)))
}

fn lex_schema(sql: &str) -> Result<Vec<SchemaToken>, TursoStorageError> {
    let characters = sql.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character.is_whitespace() {
            index += 1;
            continue;
        }
        if character == '-' && characters.get(index + 1) == Some(&'-') {
            index += 2;
            while index < characters.len() && !matches!(characters[index], '\n' | '\r') {
                index += 1;
            }
            continue;
        }
        if character == '/' && characters.get(index + 1) == Some(&'*') {
            index += 2;
            let mut closed = false;
            while index + 1 < characters.len() {
                if characters[index] == '*' && characters[index + 1] == '/' {
                    index += 2;
                    closed = true;
                    break;
                }
                index += 1;
            }
            if !closed {
                return Err(compatibility());
            }
            continue;
        }
        if character == '\'' {
            index = scan_quoted(&characters, index + 1, '\'')?;
            tokens.push(SchemaToken::StringLiteral);
            continue;
        }
        if matches!(character, '"' | '`') {
            index = scan_quoted(&characters, index + 1, character)?;
            tokens.push(SchemaToken::QuotedIdentifier);
            continue;
        }
        if character == '[' {
            index += 1;
            while index < characters.len() && characters[index] != ']' {
                index += 1;
            }
            if index == characters.len() {
                return Err(compatibility());
            }
            index += 1;
            tokens.push(SchemaToken::QuotedIdentifier);
            continue;
        }
        if character.is_alphabetic() || character == '_' {
            let start = index;
            index += 1;
            while index < characters.len()
                && (characters[index].is_alphanumeric() || matches!(characters[index], '_' | '$'))
            {
                index += 1;
            }
            tokens.push(SchemaToken::Word(
                characters[start..index]
                    .iter()
                    .collect::<String>()
                    .to_lowercase(),
            ));
            continue;
        }
        tokens.push(SchemaToken::Symbol);
        index += 1;
    }
    Ok(tokens)
}

fn scan_quoted(
    characters: &[char],
    mut index: usize,
    delimiter: char,
) -> Result<usize, TursoStorageError> {
    while index < characters.len() {
        if characters[index] == delimiter {
            if characters.get(index + 1) == Some(&delimiter) {
                index += 2;
                continue;
            }
            return Ok(index + 1);
        }
        index += 1;
    }
    Err(compatibility())
}

fn validate_predicate_indexes(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    for (table, index, expected_columns) in [
        (
            "index_documents",
            "index_documents_scope_idx",
            &["profile", "partition", "state", "id"][..],
        ),
        (
            "exact_facts",
            "exact_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
        (
            "integer_facts",
            "integer_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
        (
            "sort_facts",
            "sort_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
        (
            "optimistic_exact_facts",
            "optimistic_exact_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
        (
            "optimistic_integer_facts",
            "optimistic_integer_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
        (
            "optimistic_sort_facts",
            "optimistic_sort_facts_lookup_idx",
            &["attribute", "value", "document_id"][..],
        ),
    ] {
        let indexes = driver::query(
            connection,
            &format!("PRAGMA index_list('{table}')"),
            Vec::new(),
        )
        .map_err(TursoStorageError::initialization)?;
        if indexes.len() != 2
            || !indexes
                .iter()
                .any(|row| required_text(row, 1).ok().as_deref() == Some(index))
        {
            return Err(compatibility());
        }
        let columns = driver::query(
            connection,
            &format!("PRAGMA index_info('{index}')"),
            Vec::new(),
        )
        .map_err(TursoStorageError::initialization)?;
        if columns.len() != expected_columns.len()
            || columns.iter().zip(expected_columns).enumerate().any(
                |(position, (row, expected))| {
                    row.len() != 3
                        || required_i64(row, 0).ok() != i64::try_from(position).ok()
                        || required_text(row, 2).ok().as_deref() != Some(*expected)
                },
            )
        {
            return Err(compatibility());
        }
    }
    Ok(())
}

fn validate_optimistic_predicate_indexes(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    let indexes = driver::query(
        connection,
        "PRAGMA index_list('optimistic_index_documents')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let expected = [
        (
            "optimistic_index_documents_record_key_idx",
            true,
            &["record_key"][..],
        ),
        (
            "optimistic_index_documents_owner_idx",
            false,
            &["owner_mutation_id", "id"][..],
        ),
        (
            "optimistic_index_documents_scope_idx",
            false,
            &["profile", "partition", "state", "id"][..],
        ),
    ];
    if indexes.len() != expected.len() {
        return Err(compatibility());
    }
    for (index, unique, expected_columns) in expected {
        let Some(row) = indexes
            .iter()
            .find(|row| required_text(row, 1).ok().as_deref() == Some(index))
        else {
            return Err(compatibility());
        };
        if row.len() != 5
            || required_i64(row, 2).ok() != Some(i64::from(unique))
            || required_text(row, 3).ok().as_deref() != Some("c")
        {
            return Err(compatibility());
        }
        let columns = driver::query(
            connection,
            &format!("PRAGMA index_info('{index}')"),
            Vec::new(),
        )
        .map_err(TursoStorageError::initialization)?;
        if columns.len() != expected_columns.len()
            || columns.iter().zip(expected_columns).enumerate().any(
                |(position, (row, expected))| {
                    row.len() != 3
                        || required_i64(row, 0).ok() != i64::try_from(position).ok()
                        || required_text(row, 2).ok().as_deref() != Some(*expected)
                },
            )
        {
            return Err(compatibility());
        }
    }
    Ok(())
}

fn validate_no_foreign_keys(
    connection: &Arc<Connection>,
    table: &str,
) -> Result<(), TursoStorageError> {
    let escaped = table.replace('\'', "''");
    if driver::query(
        connection,
        &format!("PRAGMA foreign_key_list('{escaped}')"),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?
    .is_empty()
    {
        Ok(())
    } else {
        Err(compatibility())
    }
}

fn validate_optimistic_foreign_key(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        "PRAGMA foreign_key_list('optimistic_layers')",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = rows.as_slice() else {
        return Err(compatibility());
    };
    if row.len() != 8
        || required_i64(row, 0).ok() != Some(0)
        || required_i64(row, 1).ok() != Some(0)
        || required_text(row, 2).ok().as_deref() != Some("mutation_queue")
        || required_text(row, 3).ok().as_deref() != Some("mutation_id")
        || required_text(row, 4).ok().as_deref() != Some("id")
        || required_text(row, 5).ok().as_deref() != Some("NO ACTION")
        || required_text(row, 6).ok().as_deref() != Some("CASCADE")
        || required_text(row, 7).ok().as_deref() != Some("NONE")
    {
        return Err(compatibility());
    }
    Ok(())
}

fn validate_shadow_document_foreign_key(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    validate_cascade_foreign_key(
        connection,
        "optimistic_index_documents",
        "optimistic_layers",
        "owner_mutation_id",
        "mutation_id",
    )
}

fn validate_fact_foreign_key(
    connection: &Arc<Connection>,
    table: &str,
    parent: &str,
) -> Result<(), TursoStorageError> {
    validate_cascade_foreign_key(connection, table, parent, "document_id", "id")
}

fn validate_cascade_foreign_key(
    connection: &Arc<Connection>,
    table: &str,
    parent: &str,
    from: &str,
    to: &str,
) -> Result<(), TursoStorageError> {
    let rows = driver::query(
        connection,
        &format!("PRAGMA foreign_key_list('{}')", table.replace('\'', "''")),
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let [row] = rows.as_slice() else {
        return Err(compatibility());
    };
    if row.len() != 8
        || required_i64(row, 0).ok() != Some(0)
        || required_i64(row, 1).ok() != Some(0)
        || required_text(row, 2).ok().as_deref() != Some(parent)
        || required_text(row, 3).ok().as_deref() != Some(from)
        || required_text(row, 4).ok().as_deref() != Some(to)
        || required_text(row, 5).ok().as_deref() != Some("NO ACTION")
        || required_text(row, 6).ok().as_deref() != Some("CASCADE")
        || required_text(row, 7).ok().as_deref() != Some("NONE")
    {
        return Err(compatibility());
    }
    Ok(())
}

fn compatibility() -> TursoStorageError {
    TursoStorageError::reset(PhysicalResetReason::Compatibility)
}

fn validate_quick_check(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let rows = driver::query(connection, "PRAGMA quick_check", Vec::new())
        .map_err(TursoStorageError::initialization)?;
    validate_quick_check_rows(&rows)
}

fn validate_quick_check_rows(rows: &[Vec<Value>]) -> Result<(), TursoStorageError> {
    if rows.len() == 1
        && rows[0].len() == 1
        && required_text(&rows[0], 0).ok().as_deref() == Some("ok")
    {
        Ok(())
    } else {
        Err(TursoStorageError::reset(PhysicalResetReason::Integrity))
    }
}

fn validate_queue_consistency(connection: &Arc<Connection>) -> Result<(), TursoStorageError> {
    let queue = driver::query(connection, QUEUE_SELECT, Vec::new())
        .map_err(TursoStorageError::initialization)?;
    for row in queue {
        if parse_queue_row(&row)?.optimistic.is_none() {
            return Err(invariant());
        }
    }
    if driver::query(connection, ORPHAN_LAYER_SELECT, Vec::new())
        .map_err(TursoStorageError::initialization)?
        .is_empty()
    {
        Ok(())
    } else {
        Err(invariant())
    }
}

fn validate_optimistic_shadow_consistency(
    connection: &Arc<Connection>,
) -> Result<(), TursoStorageError> {
    if !driver::query(connection, "PRAGMA foreign_key_check", Vec::new())
        .map_err(TursoStorageError::initialization)?
        .is_empty()
    {
        return Err(invariant());
    }
    for row in driver::query(
        connection,
        "SELECT state, incomplete_kind FROM optimistic_index_documents",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?
    {
        if row.len() != 2 {
            return Err(invariant());
        }
        let incomplete_kind = nullable_i64(&row, 1)?;
        match OptimisticIndexDocumentState::try_from(required_i64(&row, 0)?)? {
            OptimisticIndexDocumentState::Complete | OptimisticIndexDocumentState::Deleted => {
                if incomplete_kind.is_some() {
                    return Err(invariant());
                }
            }
            OptimisticIndexDocumentState::Incomplete => {
                projection_incomplete_kind(incomplete_kind.ok_or_else(invariant)?)?;
            }
        }
    }
    if !driver::query(
        connection,
        "SELECT 1 FROM optimistic_index_documents AS d WHERE d.state <> 0 AND (EXISTS (SELECT 1 FROM optimistic_exact_facts AS f WHERE f.document_id = d.id) OR EXISTS (SELECT 1 FROM optimistic_integer_facts AS f WHERE f.document_id = d.id) OR EXISTS (SELECT 1 FROM optimistic_sort_facts AS f WHERE f.document_id = d.id)) LIMIT 1",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?
    .is_empty()
    {
        return Err(invariant());
    }
    let rows = driver::query(
        connection,
        "SELECT document_id, attribute FROM optimistic_uncertain_attributes ORDER BY document_id, attribute",
        Vec::new(),
    )
    .map_err(TursoStorageError::initialization)?;
    let mut by_document: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        by_document
            .entry(required_i64(&row, 0)?)
            .or_default()
            .push(required_text(&row, 1)?);
    }
    for attributes in by_document.into_values() {
        parse_optimistic_uncertainty(attributes)?;
    }
    Ok(())
}

struct EncodedRecord {
    key: RecordKey,
    value: Vec<u8>,
    search_documents: Vec<SearchDocument>,
}

fn prepare_records(
    entries: Vec<(EntityKey<'static>, Record)>,
) -> Result<Vec<EncodedRecord>, TursoStorageError> {
    entries
        .into_iter()
        .map(|(key, record)| {
            Ok(EncodedRecord {
                key: RecordKey::from_entity(&key)?,
                value: encode_record(&record),
                search_documents: project_search_documents(&key, &record),
            })
        })
        .collect()
}

fn write_search_documents(
    connection: &Arc<Connection>,
    entries: &[EncodedRecord],
) -> Result<(), TursoStorageError> {
    let mut delete = driver::prepare(connection, SEARCH_DELETE)?;
    let mut upsert = driver::prepare(connection, SEARCH_UPSERT)?;
    for entry in entries {
        let changed = driver::execute_prepared(
            &mut delete,
            vec![text(&entry.key.typename), text(&entry.key.id)],
        )?;
        if changed < 0 {
            return Err(invariant());
        }
        for document in &entry.search_documents {
            require_changed(
                driver::execute_prepared(
                    &mut upsert,
                    vec![
                        text(document.profile.as_str()),
                        text(&entry.key.typename),
                        text(&entry.key.id),
                        text(&document.bucket),
                        text(&document.search_text),
                        Value::from_i64(document.timestamp_ms),
                        text(&document.source_hash),
                    ],
                )?,
                1,
            )?;
        }
    }
    Ok(())
}

fn parse_search_document(
    row: &[Value],
    profile: SearchProfile,
) -> Result<SearchDocument, TursoStorageError> {
    if row.len() != 6 {
        return Err(invariant());
    }
    let key = RecordKey {
        typename: required_text(row, 0)?,
        id: required_text(row, 1)?,
    }
    .into_entity()?;
    Ok(SearchDocument {
        profile,
        record_key: key,
        bucket: required_text(row, 2)?,
        search_text: required_text(row, 3)?,
        timestamp_ms: required_i64(row, 4)?,
        source_hash: required_text(row, 5)?,
    })
}

fn mutation_values(mutation: &StoredMutation) -> Result<Vec<Value>, TursoStorageError> {
    Ok(vec![
        text(&mutation.request.query),
        optional_text(mutation.request.operation_name.as_deref()),
        text(&mutation.request.variables_json),
        optional_text(mutation.request.identity.as_deref()),
        Value::from_i64(i64::from(mutation.attempt_count)),
        optional_i64(mutation.next_attempt_at_ms),
        optional_text(mutation.lease_owner.as_deref()),
        Value::from_i64(generation_to_sql(mutation.lease_generation)?),
        optional_i64(mutation.lease_expires_at_ms),
        optional_text(mutation.last_error.as_deref()),
        Value::from_i64(mutation.created_at_ms),
    ])
}

struct ParsedQueueRow {
    id: MutationId,
    mutation: StoredMutation,
    optimistic: Option<PersistedOptimisticLayer>,
}

fn parse_queue_row(row: &[Value]) -> Result<ParsedQueueRow, TursoStorageError> {
    if row.len() != 14 {
        return Err(invariant());
    }
    let optimistic = match (&row[12], &row[13]) {
        (Value::Null, Value::Null) => None,
        (Value::Null, _) | (_, Value::Null) => return Err(invariant()),
        _ => Some(PersistedOptimisticLayer {
            optimistic_data_json: required_text(row, 12)?,
            normalized_updates: decode_record_updates(&required_blob(row, 13)?)
                .map_err(|_| TursoStorageError::reset(PhysicalResetReason::Codec))?,
        }),
    };
    Ok(ParsedQueueRow {
        id: mutation_id_from_row(required_i64(row, 0)?)?,
        mutation: StoredMutation {
            request: MutationRequest {
                query: required_text(row, 1)?,
                operation_name: nullable_text(row, 2)?,
                variables_json: required_text(row, 3)?,
                identity: nullable_text(row, 4)?,
            },
            attempt_count: u32::try_from(required_i64(row, 5)?).map_err(|_| invariant())?,
            next_attempt_at_ms: nullable_i64(row, 6)?,
            lease_owner: nullable_text(row, 7)?,
            lease_generation: u64::try_from(required_i64(row, 8)?).map_err(|_| invariant())?,
            lease_expires_at_ms: nullable_i64(row, 9)?,
            last_error: nullable_text(row, 10)?,
            created_at_ms: required_i64(row, 11)?,
        },
        optimistic,
    })
}

fn claim_is_current(
    connection: &Arc<Connection>,
    id: i64,
    claim: &MutationClaimToken,
) -> Result<bool, TursoStorageError> {
    let rows = driver::query(connection, CLAIM_SELECT, vec![Value::from_i64(id)])?;
    match rows.as_slice() {
        [] => Ok(false),
        [row] => Ok(
            nullable_text(row, 0)?.as_deref() == Some(claim.owner.as_str())
                && u64::try_from(required_i64(row, 1)?).map_err(|_| invariant())?
                    == claim.generation,
        ),
        _ => Err(invariant()),
    }
}

fn require_layer(connection: &Arc<Connection>, id: i64) -> Result<(), TursoStorageError> {
    let rows = driver::query(connection, REQUIRE_LAYER_SELECT, vec![Value::from_i64(id)])?;
    if rows.len() == 1 && required_i64(&rows[0], 0)? == 1 {
        Ok(())
    } else {
        Err(invariant())
    }
}

fn mutation_id_from_row(value: i64) -> Result<MutationId, TursoStorageError> {
    if value <= 0 {
        Err(invariant())
    } else {
        u64::try_from(value).map_err(|_| invariant())
    }
}

fn mutation_id_to_sql(value: MutationId) -> Result<i64, TursoStorageError> {
    let value = i64::try_from(value).map_err(|_| TursoStorageError::InvalidInput)?;
    if value > 0 {
        Ok(value)
    } else {
        Err(TursoStorageError::InvalidInput)
    }
}

fn generation_to_sql(value: u64) -> Result<i64, TursoStorageError> {
    i64::try_from(value).map_err(|_| TursoStorageError::InvalidInput)
}

fn text(value: &str) -> Value {
    Value::from_text(value.to_owned())
}

fn optional_text(value: Option<&str>) -> Value {
    value.map_or(Value::Null, text)
}

fn optional_i64(value: Option<i64>) -> Value {
    value.map_or(Value::Null, Value::from_i64)
}

fn required_value(row: &[Value], index: usize) -> Result<&Value, TursoStorageError> {
    row.get(index)
        .ok_or_else(|| TursoStorageError::reset(PhysicalResetReason::Corruption))
}

fn required_text(row: &[Value], index: usize) -> Result<String, TursoStorageError> {
    match required_value(row, index)? {
        Value::Text(value) => Ok(value.as_str().to_owned()),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn nullable_text(row: &[Value], index: usize) -> Result<Option<String>, TursoStorageError> {
    match required_value(row, index)? {
        Value::Null => Ok(None),
        Value::Text(value) => Ok(Some(value.as_str().to_owned())),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn required_blob(row: &[Value], index: usize) -> Result<Vec<u8>, TursoStorageError> {
    match required_value(row, index)? {
        Value::Blob(value) => Ok(value.to_vec()),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn required_i64(row: &[Value], index: usize) -> Result<i64, TursoStorageError> {
    match required_value(row, index)? {
        Value::Numeric(Numeric::Integer(value)) => Ok(*value),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn nullable_i64(row: &[Value], index: usize) -> Result<Option<i64>, TursoStorageError> {
    match required_value(row, index)? {
        Value::Null => Ok(None),
        Value::Numeric(Numeric::Integer(value)) => Ok(Some(*value)),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn require_changed(changed: i64, expected: i64) -> Result<(), TursoStorageError> {
    if changed == expected {
        Ok(())
    } else {
        Err(invariant())
    }
}

fn changed_to_bool(changed: i64) -> Result<bool, TursoStorageError> {
    match changed {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(invariant()),
    }
}

fn invariant() -> TursoStorageError {
    TursoStorageError::reset(PhysicalResetReason::Invariant)
}

#[derive(Clone, Copy)]
enum TestFaultSite {
    Diagnostics,
    Put,
    Delete,
    Enqueue,
    Complete,
    Discard,
    Clear,
}

impl TursoStorage {
    fn fault_after(&self, site: TestFaultSite, index: usize) -> Result<(), TursoStorageError> {
        #[cfg(all(test, not(target_arch = "wasm32")))]
        {
            let mut fault = self.fault.lock().unwrap_or_else(|error| error.into_inner());
            if let Some((fault_state, fault_code)) = fault
                .as_ref()
                .and_then(|fault| fault.rollback_io_step_at(site, index))
            {
                fault_state.store(fault_code, Ordering::SeqCst);
                *fault = None;
                // This pinned Turso rollback emits no File completion after
                // this operation failure. Force its IO::step polling boundary
                // instead; no successful or unrelated completion is repurposed.
                driver::arm_rollback_control_io();
                return Err(TursoStorageError::Database);
            }
            if let Some(error) = fault.as_ref().and_then(|fault| fault.error_at(site, index)) {
                *fault = None;
                return Err(error);
            }
        }
        #[cfg(any(not(test), target_arch = "wasm32"))]
        let _ = (site, index);
        Ok(())
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[derive(Clone)]
enum TestFault {
    After {
        site: TestFaultSite,
        index: usize,
    },
    ResetAfter {
        site: TestFaultSite,
        index: usize,
        reason: PhysicalResetReason,
    },
    RollbackIoStepAfter {
        site: TestFaultSite,
        index: usize,
        fault_state: Arc<AtomicU8>,
        fault_code: u8,
    },
}

#[cfg(all(test, not(target_arch = "wasm32")))]
impl TestFault {
    fn error_at(&self, site: TestFaultSite, index: usize) -> Option<TursoStorageError> {
        let (expected_site, expected_index, error) = match self {
            Self::After { site, index } => (site, index, TursoStorageError::Database),
            Self::ResetAfter {
                site,
                index,
                reason,
            } => (site, index, TursoStorageError::reset(*reason)),
            Self::RollbackIoStepAfter { .. } => return None,
        };
        (std::mem::discriminant(expected_site) == std::mem::discriminant(&site)
            && *expected_index == index)
            .then_some(error)
    }

    fn rollback_io_step_at(
        &self,
        site: TestFaultSite,
        index: usize,
    ) -> Option<(Arc<AtomicU8>, u8)> {
        let Self::RollbackIoStepAfter {
            site: expected_site,
            index: expected_index,
            fault_state,
            fault_code,
        } = self
        else {
            return None;
        };
        (std::mem::discriminant(expected_site) == std::mem::discriminant(&site)
            && *expected_index == index)
            .then(|| (fault_state.clone(), *fault_code))
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
impl TursoStorage {
    fn arm_fault(&self, fault: TestFault) {
        *self.fault.lock().unwrap_or_else(|error| error.into_inner()) = Some(fault);
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod browser_test;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
