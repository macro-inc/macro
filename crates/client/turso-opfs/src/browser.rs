//! `wasm32` DedicatedWorker OPFS implementation.

use crate::state::{
    CloseToken, FileRole, HandleId, Machine, OwnerId, Paths, SessionId, StateError, StateErrorKind,
};
use js_sys::{Function, Object, Promise, Reflect};
use std::{
    cell::RefCell,
    collections::HashMap,
    fmt,
    io::ErrorKind,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use turso_core::{
    Buffer, Clock, Completion, CompletionError, Connection, Database, File, IO, LimboError,
    MonotonicInstant, OpenFlags, OpenOptions, SqliteDialect, WallClockInstant,
    io::{FileId, FileSyncType},
};
use wasm_bindgen::{JsCast, JsValue, closure::Closure, prelude::wasm_bindgen};
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    AbortController, DedicatedWorkerGlobalScope, DomException, FileSystemDirectoryHandle,
    FileSystemFileHandle, FileSystemGetFileOptions, FileSystemReadWriteOptions,
    FileSystemRemoveOptions, FileSystemSyncAccessHandle,
};

#[cfg(test)]
mod test;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// Stable, payload-free error categories produced by the OPFS adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpfsErrorKind {
    /// The database filename is not an approved direct OPFS child name.
    InvalidName,
    /// Acquiring, validating, or releasing the canonical database Web Lock failed.
    Lock,
    /// The caller does not own the worker-local adapter.
    Ownership,
    /// A stale session, handle, or one-use close token was used.
    Lifecycle,
    /// A callback attempted to enter OPFS while another operation was active.
    Reentrant,
    /// Turso, I/O, or file references still exist at close time.
    ActiveReferences,
    /// Opening, connecting, or gracefully closing Turso failed.
    Turso,
    /// Opening or registering a sync access handle failed.
    Open,
    /// Reading an OPFS file failed.
    Read,
    /// Writing an OPFS file failed.
    Write,
    /// Flushing an OPFS file failed.
    Flush,
    /// Truncating an OPFS file failed.
    Truncate,
    /// Reading an OPFS file size failed.
    Size,
    /// Closing a sync access handle was uncertain.
    Close,
    /// Asynchronously removing a closed OPFS path failed.
    Remove,
    /// Asynchronously recreating a removed OPFS path failed.
    Recreate,
    /// Browser storage reported that its quota was full.
    StorageFull,
    /// The worker-local session is poisoned and cannot be reused.
    Poisoned,
    /// Turso requested a synchronous operation that this adapter forbids.
    Unsupported,
}

/// A payload-free OPFS adapter error.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpfsError {
    kind: OpfsErrorKind,
    message: String,
}

impl OpfsError {
    fn new(kind: OpfsErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Returns the stable error category.
    pub fn kind(&self) -> OpfsErrorKind {
        self.kind
    }
}

impl fmt::Display for OpfsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for OpfsError {}

/// Whether a complete pre-opened main/WAL pair was fresh or existing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenDisposition {
    /// Neither path existed, or this pair was freshly recreated by reset/wipe.
    Fresh,
    /// Both approved paths already existed.
    Existing,
}

/// Result of physically pre-opening the identity-bound main/WAL pair.
#[derive(Debug)]
pub enum OpenResult {
    /// Both paths form a complete pair and may be connected to Turso.
    Ready(OpfsSession),
    /// Exactly one path pre-existed; only physical reset is permitted.
    ResetRequired(ResetRequiredSession),
}

/// Exclusive canonical-database ownership backed by a held Web Lock.
#[derive(Debug)]
pub struct OpfsOwner {
    id: OwnerId,
    paths: Paths,
    lock_name: String,
    fresh: bool,
    armed: bool,
}

impl OpfsOwner {
    /// Acquires and holds this canonical database identity's exclusive Web Lock.
    ///
    /// The single validated identity derives both the physical main/WAL names
    /// and the Web Lock name, so the same files cannot be opened under a
    /// different lock. [`Self::open`] accepts no alternate path. The lock is
    /// held across open, Turso use, close, preserve/reset, and idle ownership.
    pub async fn acquire(database_identity: &str) -> Result<Self, OpfsError> {
        let paths = approved_paths(database_identity)?;
        let lock_name = owner_lock_name(database_identity);
        let id = acquire_database_lock(database_identity, &lock_name).await?;
        Ok(Self {
            id,
            paths,
            lock_name,
            fresh: false,
            armed: true,
        })
    }

    /// Returns the canonical database identity bound into this owner.
    pub fn database_path(&self) -> &str {
        self.paths.get(FileRole::Main)
    }

    /// Returns the exact exclusive Web Lock name held by this owner.
    pub fn lock_name(&self) -> &str {
        &self.lock_name
    }

    /// Physically wipes and recreates both approved paths before any open.
    ///
    /// This is the recovery path after abrupt worker loss or a pre-open entry
    /// conflict. It recursively removes only the two direct, validated child
    /// names. Cancellation or any partial remove/recreate failure poisons the
    /// owner; a poisoned worker must be replaced.
    pub async fn recovery_wipe(mut self) -> Result<Self, WipeFailure> {
        REGISTRY
            .with(|registry| {
                registry
                    .borrow_mut()
                    .machine
                    .start_wipe(self.id, self.paths.clone())
            })
            .map_err(state_error)
            .map_err(WipeFailure::new)?;
        self.armed = false;
        let mut guard = AsyncPoisonGuard::new(
            self.id,
            "recovery wipe cancelled or failed after entering Wiping",
        );
        reset_paths(&self.paths, true)
            .await
            .map_err(WipeFailure::new)?;
        REGISTRY
            .with(|registry| registry.borrow_mut().machine.finish_wipe(self.id))
            .map_err(state_error)
            .map_err(WipeFailure::new)?;
        guard.disarm();
        self.fresh = true;
        self.armed = true;
        Ok(self)
    }

    /// Pre-opens exactly this owner's bound main and WAL paths.
    ///
    /// A one-sided pre-existing pair returns [`OpenResult::ResetRequired`], a
    /// type that exposes no Turso I/O and can only be physically reset.
    pub async fn open(mut self) -> Result<OpenResult, OpenFailure> {
        let paths = self.paths.clone();
        let session = match REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .start_open(self.id, paths.clone())
        }) {
            Ok(session) => session,
            Err(error) => return Err(open_failure_after_cleanup(state_error(error), self)),
        };

        let root = match worker_root().await {
            Ok(root) => root,
            Err(error) => {
                let adapter_error = js_error(OpfsErrorKind::Open, "OPFS root open", &error);
                cleanup_failed_open(self.id, session, &adapter_error);
                return Err(open_failure_after_cleanup(adapter_error, self));
            }
        };

        let mut created = [false; 2];
        for role in FileRole::ALL {
            #[cfg(test)]
            if take_open_failure(role) {
                let error = OpfsError::new(OpfsErrorKind::Open, "injected OPFS pre-open failure");
                cleanup_failed_open(self.id, session, &error);
                return Err(open_failure_after_cleanup(error, self));
            }

            let (handle, was_created) = match open_sync_handle(&root, paths.get(role)).await {
                Ok(value) => value,
                Err(error) => {
                    let adapter_error =
                        js_error(OpfsErrorKind::Open, "OPFS sync handle open", &error);
                    cleanup_failed_open(self.id, session, &adapter_error);
                    return Err(open_failure_after_cleanup(adapter_error, self));
                }
            };
            created[role.index()] = was_created;

            let handle_id = match REGISTRY.with(|registry| {
                registry
                    .borrow_mut()
                    .machine
                    .register(self.id, session, role)
            }) {
                Ok(handle_id) => handle_id,
                Err(error) => {
                    let adapter_error = state_error(error);
                    let current_closed = close_sync_handle(&handle).is_ok();
                    cleanup_failed_open(self.id, session, &adapter_error);
                    if !current_closed {
                        poison(self.id, "unregistered sync handle close was uncertain");
                    }
                    return Err(open_failure_after_cleanup(adapter_error, self));
                }
            };
            REGISTRY.with(|registry| {
                registry
                    .borrow_mut()
                    .handles
                    .insert(handle_id, RegisteredHandle { role, handle });
            });
        }

        let reset_only = created[0] != created[1];
        if let Err(error) = REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .activate(self.id, session, reset_only)
        }) {
            let adapter_error = state_error(error);
            cleanup_failed_open(self.id, session, &adapter_error);
            return Err(open_failure_after_cleanup(adapter_error, self));
        }

        let disposition = if self.fresh || created == [true, true] {
            OpenDisposition::Fresh
        } else {
            OpenDisposition::Existing
        };
        self.armed = false;
        if reset_only {
            return Ok(OpenResult::ResetRequired(ResetRequiredSession {
                owner: self.id,
                session,
                paths,
                armed: true,
            }));
        }

        let references = Arc::new(SessionReferences);
        let io = Arc::new(OpfsIo {
            owner: self.id,
            session,
            references: references.clone(),
            last_monotonic_nanos: AtomicU64::new(0),
        });
        Ok(OpenResult::Ready(OpfsSession {
            owner: self.id,
            session,
            paths,
            disposition,
            io,
            references,
            armed: true,
        }))
    }

    /// Releases the idle owner and then proves its physical Web Lock request
    /// completed. Cancellation after release begins poisons the registry.
    pub async fn release(mut self) -> Result<(), OpfsError> {
        self.armed = false;
        let mut guard = AsyncPoisonGuard::new(
            self.id,
            "owner lock release cancelled before completion proof",
        );
        release_database_lock(self.id).await?;
        REGISTRY
            .with(|registry| registry.borrow_mut().machine.release_owner(self.id))
            .map_err(state_error)?;
        guard.disarm();
        Ok(())
    }
}

impl Drop for OpfsOwner {
    fn drop(&mut self) {
        if self.armed {
            poison(self.id, "armed OPFS owner dropped without explicit release");
            begin_database_lock_release(self.id);
        }
    }
}

/// A failure while asynchronously pre-opening main and WAL.
#[derive(Debug)]
pub struct OpenFailure {
    error: OpfsError,
    owner: Option<OpfsOwner>,
}

impl OpenFailure {
    fn recoverable(error: OpfsError, owner: OpfsOwner) -> Self {
        Self {
            error,
            owner: Some(owner),
        }
    }

    fn poisoned(error: OpfsError) -> Self {
        Self { error, owner: None }
    }

    /// Returns the classified adapter error.
    pub fn error(&self) -> &OpfsError {
        &self.error
    }

    /// Returns the idle owner only when partial-open cleanup was certain.
    pub fn into_owner(mut self) -> Option<OpfsOwner> {
        self.owner.take()
    }
}

impl fmt::Display for OpenFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for OpenFailure {}

/// A complete, identity-bound main/WAL session not yet connected to Turso.
#[derive(Debug)]
pub struct OpfsSession {
    owner: OwnerId,
    session: SessionId,
    paths: Paths,
    disposition: OpenDisposition,
    io: Arc<OpfsIo>,
    references: Arc<SessionReferences>,
    armed: bool,
}

impl OpfsSession {
    /// Returns the approved main database filename.
    pub fn database_path(&self) -> &str {
        self.paths.get(FileRole::Main)
    }

    /// Returns the approved WAL filename.
    pub fn wal_path(&self) -> &str {
        self.paths.get(FileRole::Wal)
    }

    /// Reports whether this complete pair was fresh or existing.
    pub fn disposition(&self) -> OpenDisposition {
        self.disposition
    }

    /// Opens exactly one production Turso database and connection bound to
    /// this session's private I/O object.
    ///
    /// The adapter constructs the approved `SqliteDialect` and default Turso
    /// options internally. Neither raw options, the database, nor raw I/O is
    /// exposed. Any Turso open/storage/connect failure poisons the session;
    /// recovery requires worker replacement and a new owner recovery wipe.
    pub fn connect(mut self) -> Result<ConnectedOpfsSession, ConnectFailure> {
        let options = OpenOptions::new(Arc::new(SqliteDialect));
        let database =
            match open_turso_database(self.io.clone(), self.paths.get(FileRole::Main), options) {
                Ok(database) => database,
                Err(error) => {
                    self.armed = false;
                    poison(
                        self.owner,
                        "Turso open/storage failure made session health uncertain",
                    );
                    return Err(ConnectFailure::poisoned(turso_error("open", error)));
                }
            };
        let connection = match connect_turso_database(&database) {
            Ok(connection) => connection,
            Err(error) => {
                drop(database);
                self.armed = false;
                poison(
                    self.owner,
                    "Turso connection failure made session health uncertain",
                );
                return Err(ConnectFailure::poisoned(turso_error("connect", error)));
            }
        };
        if let Err(error) = REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .bind_connection(self.owner, self.session)
        }) {
            let _ = connection.close();
            drop(connection);
            drop(database);
            self.armed = false;
            poison(
                self.owner,
                "connection binding did not match the OPFS session",
            );
            return Err(ConnectFailure::poisoned(state_error(error)));
        }
        self.armed = false;
        Ok(ConnectedOpfsSession {
            owner: self.owner,
            session: self.session,
            paths: self.paths.clone(),
            disposition: self.disposition,
            io: self.io.clone(),
            references: self.references.clone(),
            database: Some(database),
            connection: Some(connection),
            armed: true,
        })
    }
}

impl Drop for OpfsSession {
    fn drop(&mut self) {
        if self.armed {
            poison(
                self.owner,
                "ready OPFS session dropped without creating and closing its Turso connection",
            );
        }
    }
}

/// Failure while creating the session's sole production Turso connection.
#[derive(Debug)]
pub struct ConnectFailure {
    error: OpfsError,
}

impl ConnectFailure {
    fn poisoned(error: OpfsError) -> Self {
        Self { error }
    }

    /// Returns the classified adapter error.
    pub fn error(&self) -> &OpfsError {
        &self.error
    }
}

impl fmt::Display for ConnectFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for ConnectFailure {}

/// Session owning the sole production Turso database and connection.
pub struct ConnectedOpfsSession {
    owner: OwnerId,
    session: SessionId,
    paths: Paths,
    disposition: OpenDisposition,
    io: Arc<OpfsIo>,
    references: Arc<SessionReferences>,
    database: Option<Arc<Database>>,
    connection: Option<Arc<Connection>>,
    armed: bool,
}

impl fmt::Debug for ConnectedOpfsSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConnectedOpfsSession")
            .field("owner", &self.owner)
            .field("session", &self.session)
            .field("paths", &self.paths)
            .field("disposition", &self.disposition)
            .field("armed", &self.armed)
            .finish_non_exhaustive()
    }
}

impl ConnectedOpfsSession {
    /// Returns the approved main database filename.
    pub fn database_path(&self) -> &str {
        self.paths.get(FileRole::Main)
    }

    /// Returns whether this complete pair was fresh or existing.
    pub fn disposition(&self) -> OpenDisposition {
        self.disposition
    }

    /// Clones the sole production connection for application use.
    ///
    /// Callers must never invoke `Connection::close` directly. All clones and
    /// statements must be dropped before [`Self::try_close`], which exclusively
    /// owns the close transition and its success proof.
    pub fn connection(&self) -> Arc<Connection> {
        self.connection
            .as_ref()
            .expect("armed connected session always owns its connection")
            .clone()
    }

    /// Consumes the session, calls its bound `Connection::close`, verifies the
    /// close succeeded, drops Turso ownership, proves no Database/IO/File
    /// references remain, and only then closes the JavaScript handles.
    pub fn try_close(mut self) -> Result<ClosedSession, CloseFailure> {
        let connection = self
            .connection
            .as_ref()
            .expect("armed connected session always owns its connection");
        if connection.is_closed() {
            self.armed = false;
            poison(
                self.owner,
                "bound Turso connection was closed outside the adapter transition",
            );
            return Err(CloseFailure::poisoned(OpfsError::new(
                OpfsErrorKind::Turso,
                "bound Turso connection was already closed; session poisoned",
            )));
        }
        if Arc::strong_count(connection) != 1 {
            return Err(CloseFailure::recoverable(
                OpfsError::new(
                    OpfsErrorKind::ActiveReferences,
                    "connection clones or statements remain before graceful close",
                ),
                self,
            ));
        }

        if let Err(error) = close_turso_connection(connection) {
            self.armed = false;
            poison(self.owner, "session-bound Turso Connection::close failed");
            return Err(CloseFailure::poisoned(turso_error("close", error)));
        }
        if let Err(error) = REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .record_connection_close(self.owner, self.session)
        }) {
            self.armed = false;
            poison(
                self.owner,
                "Turso close proof did not match the OPFS session",
            );
            return Err(CloseFailure::poisoned(state_error(error)));
        }

        drop(self.connection.take());
        drop(self.database.take());
        if Arc::strong_count(&self.io) != 1 || Arc::strong_count(&self.references) != 2 {
            self.armed = false;
            poison(
                self.owner,
                "Turso close succeeded but Database/IO/File references remained",
            );
            return Err(CloseFailure::poisoned(OpfsError::new(
                OpfsErrorKind::ActiveReferences,
                "references remained after the session-bound Turso close",
            )));
        }

        self.armed = false;
        close_session_handles(self.owner, self.session, false).map_err(CloseFailure::poisoned)
    }
}

impl Drop for ConnectedOpfsSession {
    fn drop(&mut self) {
        if self.armed {
            poison(
                self.owner,
                "connected OPFS session dropped without adapter-driven Turso close",
            );
        }
    }
}

/// A one-sided main/WAL pair that can only be physically reset.
#[derive(Debug)]
pub struct ResetRequiredSession {
    owner: OwnerId,
    session: SessionId,
    paths: Paths,
    armed: bool,
}

impl ResetRequiredSession {
    /// Returns the approved main database filename requiring reset.
    pub fn database_path(&self) -> &str {
        self.paths.get(FileRole::Main)
    }

    /// Closes the unexposed handles, deletes/recreates both paths, and returns
    /// the still-locked idle owner. No raw I/O or Turso connection is exposed.
    pub async fn reset(mut self) -> Result<OpfsOwner, ResetFailure> {
        self.armed = false;
        let closed =
            close_session_handles(self.owner, self.session, true).map_err(ResetFailure::new)?;
        closed.reset().await
    }
}

impl Drop for ResetRequiredSession {
    fn drop(&mut self) {
        if self.armed {
            poison(
                self.owner,
                "reset-only incomplete pair dropped without physical reset",
            );
        }
    }
}

/// Failure while proving connection ownership or closing Turso/OPFS.
#[derive(Debug)]
pub struct CloseFailure {
    error: OpfsError,
    session: Option<ConnectedOpfsSession>,
}

impl CloseFailure {
    fn recoverable(error: OpfsError, session: ConnectedOpfsSession) -> Self {
        Self {
            error,
            session: Some(session),
        }
    }

    fn poisoned(error: OpfsError) -> Self {
        Self {
            error,
            session: None,
        }
    }

    /// Returns the classified adapter error.
    pub fn error(&self) -> &OpfsError {
        &self.error
    }

    /// Returns the connected session only before `Connection::close` ran.
    pub fn into_session(mut self) -> Option<ConnectedOpfsSession> {
        self.session.take()
    }
}

impl fmt::Display for CloseFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for CloseFailure {}

/// A one-use token proving Turso resources and JavaScript handles are closed.
#[derive(Debug)]
pub struct ClosedSession {
    owner: OwnerId,
    token: CloseToken,
    armed: bool,
}

impl ClosedSession {
    /// Consumes this token without deleting files and returns an idle owner.
    pub fn preserve(mut self) -> Result<OpfsOwner, OpfsError> {
        let binding = owner_binding(self.owner)?;
        let result = REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .preserve(self.owner, self.token)
        });
        // An invalid token is consumed without a Drop-side state mutation; the
        // checked transition itself is the sole operation and is mutation-free.
        self.armed = false;
        result.map_err(state_error)?;
        Ok(binding.into_owner(self.owner, false))
    }

    /// Consumes this token, asynchronously deletes and recreates main and WAL,
    /// and returns an idle owner that marks the next matching open as fresh.
    ///
    /// Synchronous [`IO::remove_file`] is never used. Any removal, recreation,
    /// or unexpected-state failure poisons the worker-local session.
    pub async fn reset(mut self) -> Result<OpfsOwner, ResetFailure> {
        let binding = owner_binding(self.owner).map_err(ResetFailure::new)?;
        let start = REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .start_reset(self.owner, self.token)
        });
        // As with preserve, invalid/consumed tokens are rejected without a
        // Drop-side transition or mutation of the checked state.
        self.armed = false;
        let paths = start.map_err(state_error).map_err(ResetFailure::new)?;
        let mut guard = AsyncPoisonGuard::new(
            self.owner,
            "reset cancelled or failed after entering Resetting",
        );

        reset_paths(&paths, false)
            .await
            .map_err(ResetFailure::new)?;
        REGISTRY
            .with(|registry| {
                registry
                    .borrow_mut()
                    .machine
                    .finish_reset(self.owner, self.token)
            })
            .map_err(state_error)
            .map_err(ResetFailure::new)?;
        guard.disarm();
        Ok(binding.into_owner(self.owner, true))
    }
}

impl Drop for ClosedSession {
    fn drop(&mut self) {
        if self.armed {
            poison(
                self.owner,
                "closed-session token dropped without preserve or reset",
            );
        }
    }
}

/// A reset failure; the worker-local session is poisoned and not reusable.
#[derive(Clone, Debug)]
pub struct ResetFailure {
    error: OpfsError,
}

impl ResetFailure {
    fn new(error: OpfsError) -> Self {
        Self { error }
    }

    /// Returns the classified adapter error.
    pub fn error(&self) -> &OpfsError {
        &self.error
    }
}

impl fmt::Display for ResetFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for ResetFailure {}

/// A recovery-wipe failure; the worker-local owner is poisoned.
#[derive(Clone, Debug)]
pub struct WipeFailure {
    error: OpfsError,
}

impl WipeFailure {
    fn new(error: OpfsError) -> Self {
        Self { error }
    }

    /// Returns the classified adapter error.
    pub fn error(&self) -> &OpfsError {
        &self.error
    }
}

impl fmt::Display for WipeFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for WipeFailure {}

#[derive(Debug)]
struct AsyncPoisonGuard {
    owner: OwnerId,
    reason: &'static str,
    armed: bool,
}

impl AsyncPoisonGuard {
    fn new(owner: OwnerId, reason: &'static str) -> Self {
        Self {
            owner,
            reason,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for AsyncPoisonGuard {
    fn drop(&mut self) {
        if self.armed {
            poison(self.owner, self.reason);
        }
    }
}

#[derive(Debug)]
struct SessionReferences;

struct RegisteredHandle {
    role: FileRole,
    handle: FileSystemSyncAccessHandle,
}

#[derive(Clone, Debug)]
struct OwnerBinding {
    paths: Paths,
    lock_name: String,
}

impl OwnerBinding {
    fn into_owner(self, id: OwnerId, fresh: bool) -> OpfsOwner {
        OpfsOwner {
            id,
            paths: self.paths,
            lock_name: self.lock_name,
            fresh,
            armed: true,
        }
    }
}

// Each Function comes from Closure::into_js_value: JavaScript owns the Rust
// closure allocation. Registry clones intentionally keep grant/settlement
// callbacks reachable until the outer Web Lock request has actually settled.
struct LockCallbacks {
    _grant: Function,
    _fulfilled: Function,
    _rejected: Function,
}

struct RegisteredOwnerLock {
    owner: OwnerId,
    binding: OwnerBinding,
    release: Function,
    request: Option<Promise>,
    callbacks: Option<LockCallbacks>,
}

struct PendingOwnerLock {
    lock_name: String,
    controller: AbortController,
    request: Option<Promise>,
    callbacks: LockCallbacks,
    cancelled: bool,
}

#[derive(Default)]
struct Registry {
    machine: Machine,
    handles: HashMap<HandleId, RegisteredHandle>,
    owner_lock: Option<RegisteredOwnerLock>,
    pending_lock: Option<PendingOwnerLock>,
    #[cfg(test)]
    faults: TestFaults,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResetFault {
    AfterMainRemoval,
    AfterMainRecreate,
}

#[cfg(test)]
#[derive(Default)]
struct TestFaults {
    fail_open: Option<FileRole>,
    fail_close: Option<FileRole>,
    database_open_error: Option<CompletionError>,
    database_connect_error: Option<CompletionError>,
    fail_connection_close: bool,
    connection_close_calls: usize,
    reset_fault: Option<ResetFault>,
    max_write_chunk: Option<usize>,
    next_write_error: Option<CompletionError>,
    write_error_after_chunks: Option<(usize, CompletionError)>,
}

thread_local! {
    // The sole long-lived owner of JavaScript OPFS objects. It is never placed
    // in Arc/Mutex and never enters a Turso Send + Sync trait object.
    static REGISTRY: RefCell<Registry> = RefCell::new(Registry::default());
}

#[derive(Debug)]
struct OpfsIo {
    owner: OwnerId,
    session: SessionId,
    references: Arc<SessionReferences>,
    last_monotonic_nanos: AtomicU64,
}

#[derive(Debug)]
struct OpfsFile {
    owner: OwnerId,
    session: SessionId,
    handle: HandleId,
    _references: Arc<SessionReferences>,
}

impl Clock for OpfsIo {
    fn current_time_monotonic(&self) -> MonotonicInstant {
        let observed = (performance_now().max(0.0) * 1_000_000.0) as u64;
        let mut previous = self.last_monotonic_nanos.load(Ordering::Relaxed);
        loop {
            let next = observed.max(previous.saturating_add(1));
            match self.last_monotonic_nanos.compare_exchange_weak(
                previous,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return MonotonicInstant::from_nanos(next as u128),
                Err(current) => previous = current,
            }
        }
    }

    fn current_time_wall_clock(&self) -> WallClockInstant {
        let millis = js_sys::Date::now();
        let seconds = (millis / 1_000.0).floor() as i64;
        let micros = ((millis - seconds as f64 * 1_000.0) * 1_000.0) as u32;
        WallClockInstant {
            secs: seconds,
            micros,
        }
    }
}

impl IO for OpfsIo {
    fn open_file(
        &self,
        path: &str,
        flags: OpenFlags,
        direct: bool,
    ) -> turso_core::Result<Arc<dyn File>> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        let handle = REGISTRY.with(|registry| {
            registry.borrow().machine.validate_open(
                self.owner,
                self.session,
                path,
                flags.contains(OpenFlags::ReadOnly),
                flags.contains(OpenFlags::NoLock),
                direct,
            )
        })?;
        Ok(Arc::new(OpfsFile {
            owner: self.owner,
            session: self.session,
            handle,
            _references: self.references.clone(),
        }))
    }

    fn remove_file(&self, _path: &str) -> turso_core::Result<()> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        Err(completion_io_error(
            ErrorKind::Unsupported,
            "synchronous OPFS remove_file is forbidden",
        ))
    }

    fn file_id(&self, path: &str) -> turso_core::Result<FileId> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        REGISTRY.with(|registry| {
            registry
                .borrow()
                .machine
                .validate_path(self.owner, self.session, path)
        })?;
        Ok(FileId::from_path_hash(path))
    }

    fn supports_shared_wal_coordination(&self) -> bool {
        false
    }
}

impl File for OpfsFile {
    fn lock_file(&self, _exclusive: bool) -> turso_core::Result<()> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        registered_handle(self.owner, self.session, self.handle).map(|_| ())
    }

    fn unlock_file(&self) -> turso_core::Result<()> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        registered_handle(self.owner, self.session, self.handle).map(|_| ())
    }

    fn pread(&self, pos: u64, completion: Completion) -> turso_core::Result<Completion> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        let result = read_once(
            self.owner,
            self.session,
            self.handle,
            pos,
            completion.as_read().buf(),
        );
        finish_completion(&completion, result);
        Ok(completion)
    }

    fn pwrite(
        &self,
        pos: u64,
        buffer: Arc<Buffer>,
        completion: Completion,
    ) -> turso_core::Result<Completion> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        completion.keep_write_buffer_alive(buffer.clone());
        let result = preflight_write_range(pos, [buffer.as_slice().len()])
            .and_then(|expected| {
                write_all(
                    pos,
                    buffer.as_slice(),
                    self.owner,
                    self.session,
                    self.handle,
                )
                .and_then(|written| {
                    if written == expected {
                        completion_count(written)
                    } else {
                        Err(CompletionError::ShortWrite)
                    }
                })
            })
            .map_err(LimboError::CompletionError);
        finish_completion(&completion, result);
        Ok(completion)
    }

    fn pwritev(
        &self,
        mut pos: u64,
        buffers: Vec<Arc<Buffer>>,
        completion: Completion,
    ) -> turso_core::Result<Completion> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        // All browser writes are synchronous, so the argument vector keeps
        // every buffer alive until all writes finish and completion fires.
        // Aggregate count and end offset are checked before the first write.
        let result = (|| {
            let expected =
                preflight_write_range(pos, buffers.iter().map(|buffer| buffer.as_slice().len()))?;
            let mut total = 0_usize;
            for buffer in &buffers {
                let written = write_all(
                    pos,
                    buffer.as_slice(),
                    self.owner,
                    self.session,
                    self.handle,
                )?;
                total = total
                    .checked_add(written)
                    .ok_or(CompletionError::ShortWrite)?;
                pos = pos
                    .checked_add(written as u64)
                    .ok_or(CompletionError::ShortWrite)?;
            }
            if total == expected {
                completion_count(total)
            } else {
                Err(CompletionError::ShortWrite)
            }
        })()
        .map_err(LimboError::CompletionError);
        finish_completion(&completion, result);
        Ok(completion)
    }

    fn sync(
        &self,
        completion: Completion,
        _sync_type: FileSyncType,
    ) -> turso_core::Result<Completion> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        let result = registered_handle(self.owner, self.session, self.handle).and_then(|handle| {
            handle.flush().map_err(|error| {
                js_handle_completion_error(self.owner, "OPFS flush", &error, ErrorKind::Other)
            })?;
            Ok(0)
        });
        finish_completion(&completion, result);
        Ok(completion)
    }

    fn size(&self) -> turso_core::Result<u64> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        registered_handle(self.owner, self.session, self.handle).and_then(|handle| {
            handle
                .get_size()
                .map_err(|error| {
                    js_handle_limbo_error(self.owner, "OPFS getSize", &error, ErrorKind::Other)
                })
                .and_then(number_to_u64)
        })
    }

    fn truncate(&self, len: u64, completion: Completion) -> turso_core::Result<Completion> {
        let _operation = OperationGuard::enter(self.owner, self.session)?;
        let result = validate_position(len).and_then(|()| {
            let handle = registered_handle(self.owner, self.session, self.handle)?;
            handle.truncate_with_f64(len as f64).map_err(|error| {
                js_handle_limbo_error(self.owner, "OPFS truncate", &error, ErrorKind::Other)
            })?;
            Ok(0)
        });
        finish_completion(&completion, result);
        Ok(completion)
    }
}

#[derive(Debug)]
struct OperationGuard {
    owner: OwnerId,
    session: SessionId,
}

impl OperationGuard {
    fn enter(owner: OwnerId, session: SessionId) -> turso_core::Result<Self> {
        REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .begin_operation(owner, session)
        })?;
        Ok(Self { owner, session })
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        REGISTRY.with(|registry| {
            registry
                .borrow_mut()
                .machine
                .end_operation(self.owner, self.session);
        });
    }
}

fn approved_paths(database_name: &str) -> Result<Paths, OpfsError> {
    if database_name.is_empty()
        || database_name == "."
        || database_name == ".."
        || database_name.ends_with("-wal")
        || database_name.contains(['/', '\\', '\0'])
    {
        return Err(OpfsError::new(
            OpfsErrorKind::InvalidName,
            "database identity must be a direct child and must not use the reserved -wal suffix",
        ));
    }
    let wal = format!("{database_name}-wal");
    Ok(Paths::new(database_name.to_owned(), wal))
}

fn owner_lock_name(database_identity: &str) -> String {
    format!(
        "macro:turso-opfs:v1:{}:{database_identity}",
        database_identity.len()
    )
}

#[derive(Debug)]
struct PendingAcquireGuard {
    lock_name: String,
    armed: bool,
}

impl PendingAcquireGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingAcquireGuard {
    fn drop(&mut self) {
        if self.armed {
            cancel_database_lock_acquire(&self.lock_name);
        }
    }
}

async fn acquire_database_lock(
    database_identity: &str,
    lock_name: &str,
) -> Result<OwnerId, OpfsError> {
    let worker = js_sys::global()
        .dyn_into::<DedicatedWorkerGlobalScope>()
        .map_err(|error| js_error(OpfsErrorKind::Lock, "DedicatedWorker lock scope", &error))?;
    let manager = Reflect::get(worker.navigator().as_ref(), &JsValue::from_str("locks"))
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock manager", &error))?;
    if manager.is_null() || manager.is_undefined() {
        return Err(OpfsError::new(
            OpfsErrorKind::Lock,
            "Web Locks API is unavailable in this DedicatedWorker",
        ));
    }
    let request_function = Reflect::get(&manager, &JsValue::from_str("request"))
        .and_then(|value| value.dyn_into::<Function>())
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock request function", &error))?;
    let occupied = REGISTRY.with(|registry| {
        let registry = registry.borrow();
        registry.pending_lock.is_some() || registry.owner_lock.is_some()
    });
    if occupied {
        return Err(OpfsError::new(
            OpfsErrorKind::Ownership,
            "worker-local OPFS registry already owns or is acquiring a Web Lock",
        ));
    }

    let controller = AbortController::new()
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock abort controller", &error))?;
    let options = Object::new();
    Reflect::set(
        options.as_ref(),
        &JsValue::from_str("mode"),
        &JsValue::from_str("exclusive"),
    )
    .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock mode", &error))?;
    Reflect::set(
        options.as_ref(),
        &JsValue::from_str("signal"),
        controller.signal().as_ref(),
    )
    .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock abort signal", &error))?;

    let mut acquired_resolve = None;
    let mut acquired_reject = None;
    let acquired = Promise::new(&mut |resolve, reject| {
        acquired_resolve = Some(resolve.clone());
        acquired_reject = Some(reject.clone());
    });
    let resolve = acquired_resolve.expect("Promise constructor supplies resolve");
    let reject = acquired_reject.expect("Promise constructor supplies reject");
    let callback_reject = reject.clone();
    let callback_resolve = resolve.clone();
    let callback_lock_name = lock_name.to_owned();
    let binding = OwnerBinding {
        paths: approved_paths(database_identity)?,
        lock_name: lock_name.to_owned(),
    };
    let grant = Closure::wrap(Box::new(move |lock: JsValue| -> Promise {
        if lock.is_null() || lock.is_undefined() {
            let _ = callback_reject.call1(
                &JsValue::UNDEFINED,
                &JsValue::from_str("exclusive Web Lock was not granted"),
            );
            return Promise::resolve(&JsValue::UNDEFINED);
        }
        let actual_name = Reflect::get(&lock, &JsValue::from_str("name"))
            .ok()
            .and_then(|value| value.as_string());
        let actual_mode = Reflect::get(&lock, &JsValue::from_str("mode"))
            .ok()
            .and_then(|value| value.as_string());
        if actual_name.as_deref() != Some(callback_lock_name.as_str())
            || actual_mode.as_deref() != Some("exclusive")
        {
            let _ = callback_reject.call1(
                &JsValue::UNDEFINED,
                &JsValue::from_str("granted Web Lock did not match canonical identity"),
            );
            return Promise::resolve(&JsValue::UNDEFINED);
        }

        let mut release_resolve = None;
        let held = Promise::new(&mut |resolve, _reject| {
            release_resolve = Some(resolve.clone());
        });
        let release = release_resolve.expect("Promise constructor supplies resolve");
        let claimed = REGISTRY.with(|registry| {
            let mut registry = registry.borrow_mut();
            if registry
                .pending_lock
                .as_ref()
                .is_none_or(|pending| pending.lock_name != callback_lock_name)
                || registry.owner_lock.is_some()
            {
                return Err(OpfsError::new(
                    OpfsErrorKind::Ownership,
                    "Web Lock callback did not match the pending acquisition",
                ));
            }
            let owner = registry.machine.claim_owner().map_err(state_error)?;
            registry.owner_lock = Some(RegisteredOwnerLock {
                owner,
                binding: binding.clone(),
                release,
                request: None,
                callbacks: None,
            });
            Ok(owner)
        });
        match claimed {
            Ok(_) => {
                let _ = callback_resolve.call1(&JsValue::UNDEFINED, &JsValue::TRUE);
                held
            }
            Err(error) => {
                let _ = callback_reject
                    .call1(&JsValue::UNDEFINED, &JsValue::from_str(&error.to_string()));
                Promise::resolve(&JsValue::UNDEFINED)
            }
        }
    }) as Box<dyn FnMut(JsValue) -> Promise>)
    .into_js_value()
    .unchecked_into::<Function>();

    let fulfilled_lock_name = lock_name.to_owned();
    let fulfilled = Closure::wrap(Box::new(move |_value: JsValue| -> JsValue {
        REGISTRY.with(|registry| {
            let mut registry = registry.borrow_mut();
            let cancelled = registry.pending_lock.as_ref().is_some_and(|pending| {
                pending.lock_name == fulfilled_lock_name && pending.cancelled
            });
            if cancelled {
                registry.pending_lock = None;
                if registry.owner_lock.as_ref().is_some_and(|lock| {
                    lock.binding.lock_name == fulfilled_lock_name && lock.callbacks.is_none()
                }) {
                    registry.owner_lock = None;
                }
            }
        });
        JsValue::UNDEFINED
    }) as Box<dyn FnMut(JsValue) -> JsValue>)
    .into_js_value()
    .unchecked_into::<Function>();

    let rejected_lock_name = lock_name.to_owned();
    let request_reject = reject.clone();
    let rejected = Closure::wrap(Box::new(move |error: JsValue| -> JsValue {
        let _ = request_reject.call1(&JsValue::UNDEFINED, &error);
        let owner = REGISTRY.with(|registry| {
            let mut registry = registry.borrow_mut();
            if registry
                .pending_lock
                .as_ref()
                .is_some_and(|pending| pending.lock_name == rejected_lock_name)
            {
                registry.pending_lock = None;
            }
            if registry
                .owner_lock
                .as_ref()
                .is_some_and(|lock| lock.binding.lock_name == rejected_lock_name)
            {
                registry.owner_lock.take().map(|lock| lock.owner)
            } else {
                None
            }
        });
        if let Some(owner) = owner {
            poison(owner, "held Web Lock request rejected before clean release");
        }
        JsValue::UNDEFINED
    }) as Box<dyn FnMut(JsValue) -> JsValue>)
    .into_js_value()
    .unchecked_into::<Function>();

    let callbacks = LockCallbacks {
        _grant: grant.clone(),
        _fulfilled: fulfilled.clone(),
        _rejected: rejected.clone(),
    };
    REGISTRY.with(|registry| {
        registry.borrow_mut().pending_lock = Some(PendingOwnerLock {
            lock_name: lock_name.to_owned(),
            controller,
            request: None,
            callbacks,
            cancelled: false,
        });
    });
    let mut guard = PendingAcquireGuard {
        lock_name: lock_name.to_owned(),
        armed: true,
    };

    let request = match request_function
        .call3(
            &manager,
            &JsValue::from_str(lock_name),
            options.as_ref(),
            grant.as_ref(),
        )
        .and_then(|value| value.dyn_into::<Promise>())
    {
        Ok(request) => request,
        Err(error) => {
            REGISTRY.with(|registry| registry.borrow_mut().pending_lock = None);
            guard.disarm();
            return Err(js_error(OpfsErrorKind::Lock, "Web Lock request", &error));
        }
    };
    REGISTRY.with(|registry| {
        if let Some(pending) = registry.borrow_mut().pending_lock.as_mut() {
            pending.request = Some(request.clone());
        }
    });
    let then = Reflect::get(request.as_ref(), &JsValue::from_str("then"))
        .and_then(|value| value.dyn_into::<Function>())
        .and_then(|then| then.call2(request.as_ref(), fulfilled.as_ref(), rejected.as_ref()));
    if let Err(error) = then {
        cancel_database_lock_acquire(lock_name);
        let _ = JsFuture::from(request).await;
        REGISTRY.with(|registry| registry.borrow_mut().pending_lock = None);
        guard.disarm();
        return Err(js_error(
            OpfsErrorKind::Lock,
            "Web Lock settlement handlers",
            &error,
        ));
    }

    JsFuture::from(acquired)
        .await
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock acquisition", &error))?;

    let owner = REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        let pending = registry.pending_lock.take().ok_or_else(|| {
            OpfsError::new(
                OpfsErrorKind::Lock,
                "Web Lock acquisition lost its pending capability",
            )
        })?;
        if pending.lock_name != lock_name || pending.cancelled {
            return Err(OpfsError::new(
                OpfsErrorKind::Lock,
                "Web Lock acquisition completed for a cancelled identity",
            ));
        }
        let registered = registry.owner_lock.as_mut().ok_or_else(|| {
            OpfsError::new(
                OpfsErrorKind::Lock,
                "Web Lock callback completed without an owner capability",
            )
        })?;
        if registered.binding.lock_name != lock_name {
            return Err(OpfsError::new(
                OpfsErrorKind::Lock,
                "registered owner lock does not match canonical identity",
            ));
        }
        registered.request = pending.request;
        registered.callbacks = Some(pending.callbacks);
        Ok(registered.owner)
    })?;
    guard.disarm();
    Ok(owner)
}

fn cancel_database_lock_acquire(lock_name: &str) {
    let (controller, release, owner) = REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        let controller = registry
            .pending_lock
            .as_mut()
            .filter(|pending| pending.lock_name == lock_name)
            .map(|pending| {
                pending.cancelled = true;
                pending.controller.clone()
            });
        let lock = registry
            .owner_lock
            .as_ref()
            .filter(|lock| lock.binding.lock_name == lock_name && lock.callbacks.is_none());
        (
            controller,
            lock.map(|lock| lock.release.clone()),
            lock.map(|lock| lock.owner),
        )
    });
    if let Some(controller) = controller {
        controller.abort();
    }
    if let Some(owner) = owner {
        poison(owner, "Web Lock acquisition future cancelled after grant");
    }
    if let Some(release) = release {
        let _ = release.call0(&JsValue::UNDEFINED);
    }
}

fn owner_binding(owner: OwnerId) -> Result<OwnerBinding, OpfsError> {
    REGISTRY.with(|registry| {
        registry
            .borrow()
            .owner_lock
            .as_ref()
            .filter(|lock| lock.owner == owner && lock.request.is_some())
            .map(|lock| lock.binding.clone())
            .ok_or_else(|| {
                OpfsError::new(
                    OpfsErrorKind::Lock,
                    "owner is not backed by the matching held Web Lock",
                )
            })
    })
}

fn begin_database_lock_release(owner: OwnerId) {
    let release = REGISTRY.with(|registry| {
        registry
            .borrow()
            .owner_lock
            .as_ref()
            .filter(|lock| lock.owner == owner)
            .map(|lock| lock.release.clone())
    });
    if let Some(release) = release {
        let _ = release.call0(&JsValue::UNDEFINED);
    }
}

async fn release_database_lock(owner: OwnerId) -> Result<(), OpfsError> {
    let (release, request) = REGISTRY.with(|registry| {
        let registry = registry.borrow();
        let lock = registry
            .owner_lock
            .as_ref()
            .filter(|lock| lock.owner == owner)
            .ok_or_else(|| {
                OpfsError::new(
                    OpfsErrorKind::Lock,
                    "owner release lacks its matching held Web Lock",
                )
            })?;
        let request = lock.request.clone().ok_or_else(|| {
            OpfsError::new(
                OpfsErrorKind::Lock,
                "owner Web Lock request has no completion proof",
            )
        })?;
        Ok::<_, OpfsError>((lock.release.clone(), request))
    })?;
    release
        .call0(&JsValue::UNDEFINED)
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock release signal", &error))?;
    JsFuture::from(request)
        .await
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock release completion", &error))?;
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        if registry
            .owner_lock
            .as_ref()
            .is_some_and(|lock| lock.owner == owner)
        {
            registry.owner_lock = None;
            Ok(())
        } else {
            Err(OpfsError::new(
                OpfsErrorKind::Lock,
                "released Web Lock did not match the current owner",
            ))
        }
    })
}

async fn worker_root() -> Result<FileSystemDirectoryHandle, JsValue> {
    let worker = js_sys::global().dyn_into::<DedicatedWorkerGlobalScope>()?;
    JsFuture::from(worker.navigator().storage().get_directory())
        .await?
        .dyn_into::<FileSystemDirectoryHandle>()
}

async fn open_sync_handle(
    root: &FileSystemDirectoryHandle,
    path: &str,
) -> Result<(FileSystemSyncAccessHandle, bool), JsValue> {
    let (file, created) = match JsFuture::from(root.get_file_handle(path)).await {
        Ok(file) => (file.dyn_into::<FileSystemFileHandle>()?, false),
        Err(error) if is_not_found(&error) => {
            let options = FileSystemGetFileOptions::new();
            options.set_create(true);
            (
                JsFuture::from(root.get_file_handle_with_options(path, &options))
                    .await?
                    .dyn_into::<FileSystemFileHandle>()?,
                true,
            )
        }
        Err(error) => return Err(error),
    };
    let handle = JsFuture::from(file.create_sync_access_handle())
        .await?
        .dyn_into::<FileSystemSyncAccessHandle>()?;
    Ok((handle, created))
}

fn open_turso_database(
    io: Arc<dyn IO>,
    path: &str,
    options: OpenOptions,
) -> turso_core::Result<Arc<Database>> {
    #[cfg(test)]
    if let Some(error) =
        REGISTRY.with(|registry| registry.borrow_mut().faults.database_open_error.take())
    {
        return Err(LimboError::CompletionError(error));
    }
    Database::open(io, path, options)
}

fn connect_turso_database(database: &Arc<Database>) -> turso_core::Result<Arc<Connection>> {
    #[cfg(test)]
    if let Some(error) =
        REGISTRY.with(|registry| registry.borrow_mut().faults.database_connect_error.take())
    {
        return Err(LimboError::CompletionError(error));
    }
    database.connect()
}

#[cfg(test)]
fn inject_out_of_band_marked_close_failure(connection: &Connection) -> turso_core::Result<()> {
    // Faithfully model pinned Turso's ordering: Connection::close marks the
    // connection closed before shutdown checkpoint can return an error.
    connection.close()?;
    debug_assert!(connection.is_closed());
    Err(LimboError::InternalError(
        "injected failure after out-of-band close marked the connection".into(),
    ))
}

fn close_turso_connection(connection: &Connection) -> turso_core::Result<()> {
    #[cfg(test)]
    if REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        registry.faults.connection_close_calls += 1;
        std::mem::take(&mut registry.faults.fail_connection_close)
    }) {
        return Err(LimboError::InternalError(
            "injected session-bound Turso close failure".into(),
        ));
    }
    connection.close()
}

fn close_session_handles(
    owner: OwnerId,
    session: SessionId,
    reset_only: bool,
) -> Result<ClosedSession, OpfsError> {
    let handle_ids = REGISTRY
        .with(|registry| {
            let mut registry = registry.borrow_mut();
            if reset_only {
                registry.machine.start_reset_only_close(owner, session)
            } else {
                registry.machine.start_close(owner, session)
            }
        })
        .map_err(state_error)
        .inspect_err(|_| poison(owner, "handle close proof did not match active session"))?;

    let mut failures = Vec::new();
    let mut unexpected = false;
    for (role, handle_id) in [
        (FileRole::Wal, handle_ids[FileRole::Wal.index()]),
        (FileRole::Main, handle_ids[FileRole::Main.index()]),
    ] {
        let entry = REGISTRY.with(|registry| registry.borrow_mut().handles.remove(&handle_id));
        let Some(entry) = entry else {
            unexpected = true;
            continue;
        };
        if entry.role != role || close_registered_handle(&entry).is_err() {
            failures.push((handle_id, entry));
        }
    }

    if unexpected || !failures.is_empty() {
        REGISTRY.with(|registry| {
            let mut registry = registry.borrow_mut();
            registry.handles.extend(failures);
            let _ = registry.machine.poison(
                owner,
                "sync handle close was uncertain or registry state was unexpected".into(),
            );
        });
        return Err(OpfsError::new(
            OpfsErrorKind::Close,
            "OPFS sync handle close was uncertain; session poisoned",
        ));
    }

    let token = REGISTRY
        .with(|registry| registry.borrow_mut().machine.finish_close(owner, session))
        .map_err(state_error)
        .inspect_err(|_| poison(owner, "close completion did not match worker registry"))?;
    Ok(ClosedSession {
        owner,
        token,
        armed: true,
    })
}

fn cleanup_failed_open(owner: OwnerId, session: SessionId, cause: &OpfsError) {
    let entries =
        REGISTRY.with(|registry| registry.borrow_mut().handles.drain().collect::<Vec<_>>());
    let mut uncertain = Vec::new();
    for (id, entry) in entries {
        if close_registered_handle(&entry).is_err() {
            uncertain.push((id, entry));
        }
    }
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        registry.handles.extend(uncertain);
        let cleanup_certain = registry.handles.is_empty();
        let _ = registry.machine.abort_open(
            owner,
            session,
            cleanup_certain,
            format!(
                "partial open cleanup uncertain after {}",
                cause.kind() as u8
            ),
        );
    });
}

fn open_failure_after_cleanup(error: OpfsError, mut owner: OpfsOwner) -> OpenFailure {
    let reusable = REGISTRY.with(|registry| {
        let registry = registry.borrow();
        registry.machine.is_idle_owner(owner.id)
            && registry.handles.is_empty()
            && registry.pending_lock.is_none()
            && registry.owner_lock.as_ref().is_some_and(|lock| {
                lock.owner == owner.id
                    && lock.request.is_some()
                    && lock.binding.paths == owner.paths
                    && lock.binding.lock_name == owner.lock_name
            })
    });
    if reusable {
        OpenFailure::recoverable(error, owner)
    } else {
        owner.armed = false;
        OpenFailure::poisoned(OpfsError::new(
            OpfsErrorKind::Poisoned,
            "partial OPFS open cleanup was uncertain; session poisoned",
        ))
    }
}

fn close_registered_handle(entry: &RegisteredHandle) -> Result<(), JsValue> {
    #[cfg(test)]
    if take_close_failure(entry.role) {
        return Err(JsValue::from_str("injected sync handle close failure"));
    }
    close_sync_handle(&entry.handle)
}

fn close_sync_handle(handle: &FileSystemSyncAccessHandle) -> Result<(), JsValue> {
    let close =
        Reflect::get(handle.as_ref(), &JsValue::from_str("close"))?.dyn_into::<Function>()?;
    close.call0(handle.as_ref()).map(|_| ())
}

async fn reset_paths(paths: &Paths, recursive: bool) -> Result<(), OpfsError> {
    let root = worker_root()
        .await
        .map_err(|error| js_error(OpfsErrorKind::Remove, "OPFS reset root open", &error))?;
    for role in FileRole::ALL {
        remove_if_present(&root, paths.get(role), recursive).await?;
        #[cfg(test)]
        if role == FileRole::Main && take_reset_failure(ResetFault::AfterMainRemoval) {
            return Err(OpfsError::new(
                OpfsErrorKind::Remove,
                "injected failure after removing the main path",
            ));
        }
    }
    for role in FileRole::ALL {
        let options = FileSystemGetFileOptions::new();
        options.set_create(true);
        JsFuture::from(root.get_file_handle_with_options(paths.get(role), &options))
            .await
            .map_err(|error| js_error(OpfsErrorKind::Recreate, "OPFS path recreate", &error))?
            .dyn_into::<FileSystemFileHandle>()
            .map_err(|error| {
                js_error(OpfsErrorKind::Recreate, "OPFS recreated entry type", &error)
            })?;
        #[cfg(test)]
        if role == FileRole::Main && take_reset_failure(ResetFault::AfterMainRecreate) {
            return Err(OpfsError::new(
                OpfsErrorKind::Recreate,
                "injected failure after recreating the main path",
            ));
        }
    }
    Ok(())
}

async fn remove_if_present(
    root: &FileSystemDirectoryHandle,
    path: &str,
    recursive: bool,
) -> Result<(), OpfsError> {
    let remove = if recursive {
        let options = FileSystemRemoveOptions::new();
        options.set_recursive(true);
        root.remove_entry_with_options(path, &options)
    } else {
        root.remove_entry(path)
    };
    match JsFuture::from(remove).await {
        Ok(_) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(error) => Err(js_error(OpfsErrorKind::Remove, "OPFS path remove", &error)),
    }
}

fn is_not_found(value: &JsValue) -> bool {
    dom_exception_name(value).as_deref() == Some("NotFoundError")
}

fn registered_handle(
    owner: OwnerId,
    session: SessionId,
    id: HandleId,
) -> turso_core::Result<FileSystemSyncAccessHandle> {
    let handle = REGISTRY.with(|registry| {
        let registry = registry.borrow();
        registry.machine.validate_session(owner, session)?;
        Ok::<_, LimboError>(registry.handles.get(&id).map(|entry| entry.handle.clone()))
    })?;
    handle.ok_or_else(|| {
        poison(
            owner,
            "active session referenced a missing registered OPFS handle",
        );
        completion_io_error(ErrorKind::Other, "active OPFS handle registry is invalid")
    })
}

fn read_once(
    owner: OwnerId,
    session: SessionId,
    id: HandleId,
    pos: u64,
    buffer: &Buffer,
) -> turso_core::Result<i32> {
    validate_position(pos)?;
    let handle = registered_handle(owner, session, id)?;
    let options = FileSystemReadWriteOptions::new();
    options.set_at(pos as f64);
    handle
        .read_with_u8_array_and_options(buffer.as_mut_slice(), &options)
        .map_err(|error| js_handle_limbo_error(owner, "OPFS read", &error, ErrorKind::Other))
        .and_then(number_to_i32)
}

fn preflight_write_range(
    pos: u64,
    lengths: impl IntoIterator<Item = usize>,
) -> Result<usize, CompletionError> {
    let total = lengths.into_iter().try_fold(0_usize, |total, length| {
        total.checked_add(length).ok_or(CompletionError::ShortWrite)
    })?;
    completion_count(total)?;
    if total == 0 {
        return Ok(0);
    }
    validate_position(pos).map_err(limbo_to_completion)?;
    let total_u64 = u64::try_from(total).map_err(|_| CompletionError::ShortWrite)?;
    let end = pos
        .checked_add(total_u64)
        .ok_or(CompletionError::ShortWrite)?;
    if end > MAX_SAFE_INTEGER {
        return Err(CompletionError::IOError(
            ErrorKind::InvalidInput,
            "OPFS write end exceeds JavaScript safe integer",
        ));
    }
    Ok(total)
}

fn write_all(
    mut pos: u64,
    mut bytes: &[u8],
    owner: OwnerId,
    session: SessionId,
    id: HandleId,
) -> Result<usize, CompletionError> {
    let expected = bytes.len();
    let mut total = 0_usize;
    while !bytes.is_empty() {
        let written = write_once(owner, session, id, pos, bytes)?;
        if written == 0 || written > bytes.len() {
            return Err(CompletionError::ShortWrite);
        }
        total = total
            .checked_add(written)
            .ok_or(CompletionError::ShortWrite)?;
        pos = pos
            .checked_add(written as u64)
            .ok_or(CompletionError::ShortWrite)?;
        bytes = &bytes[written..];
    }
    if total == expected {
        Ok(total)
    } else {
        Err(CompletionError::ShortWrite)
    }
}

fn write_once(
    owner: OwnerId,
    session: SessionId,
    id: HandleId,
    pos: u64,
    bytes: &[u8],
) -> Result<usize, CompletionError> {
    validate_position(pos).map_err(limbo_to_completion)?;
    let handle = registered_handle(owner, session, id).map_err(limbo_to_completion)?;
    #[cfg(test)]
    let (chunk_limit, injected_error) = REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        let injected = registry.faults.next_write_error.take().or_else(|| {
            let fault = registry.faults.write_error_after_chunks.as_mut()?;
            if fault.0 == 0 {
                let error = fault.1;
                registry.faults.write_error_after_chunks = None;
                Some(error)
            } else {
                fault.0 -= 1;
                None
            }
        });
        (registry.faults.max_write_chunk, injected)
    });
    #[cfg(not(test))]
    let (chunk_limit, injected_error): (Option<usize>, Option<CompletionError>) = (None, None);
    if let Some(error) = injected_error {
        return Err(error);
    }
    let chunk_len = chunk_limit.unwrap_or(bytes.len()).min(bytes.len());
    if chunk_len == 0 {
        return Ok(0);
    }
    let options = FileSystemReadWriteOptions::new();
    options.set_at(pos as f64);
    let written = handle
        .write_with_u8_array_and_options(&bytes[..chunk_len], &options)
        .map_err(|error| {
            js_handle_completion_error(owner, "OPFS write", &error, ErrorKind::Other)
        })?;
    let written = number_to_i32(written)
        .map(|written| written as usize)
        .map_err(limbo_to_completion)?;
    if written <= chunk_len {
        Ok(written)
    } else {
        Err(CompletionError::ShortWrite)
    }
}

fn completion_count(count: usize) -> Result<i32, CompletionError> {
    i32::try_from(count).map_err(|_| CompletionError::ShortWrite)
}

fn finish_completion(completion: &Completion, result: turso_core::Result<i32>) {
    match result {
        Ok(value) => completion.complete(value),
        Err(error) => completion.error(limbo_to_completion(error)),
    }
}

fn validate_position(value: u64) -> turso_core::Result<()> {
    if value <= MAX_SAFE_INTEGER {
        Ok(())
    } else {
        Err(completion_io_error(
            ErrorKind::InvalidInput,
            "OPFS offset exceeds JavaScript safe integer",
        ))
    }
}

fn number_to_i32(value: f64) -> turso_core::Result<i32> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= i32::MAX as f64 {
        Ok(value as i32)
    } else {
        Err(completion_io_error(
            ErrorKind::InvalidData,
            "invalid OPFS byte count",
        ))
    }
}

fn number_to_u64(value: f64) -> turso_core::Result<u64> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value <= MAX_SAFE_INTEGER as f64
    {
        Ok(value as u64)
    } else {
        Err(completion_io_error(
            ErrorKind::InvalidData,
            "invalid OPFS file size",
        ))
    }
}

fn state_error(error: StateError) -> OpfsError {
    let kind = match error.kind {
        StateErrorKind::Ownership => OpfsErrorKind::Ownership,
        StateErrorKind::Reentrant => OpfsErrorKind::Reentrant,
        StateErrorKind::ActiveReferences => OpfsErrorKind::ActiveReferences,
        StateErrorKind::Poisoned => OpfsErrorKind::Poisoned,
        StateErrorKind::Path | StateErrorKind::Flags => OpfsErrorKind::InvalidName,
        StateErrorKind::Session
        | StateErrorKind::Registration
        | StateErrorKind::Token
        | StateErrorKind::Exhausted => OpfsErrorKind::Lifecycle,
    };
    OpfsError::new(kind, error.message)
}

impl From<StateError> for LimboError {
    fn from(error: StateError) -> Self {
        let kind = match error.kind {
            StateErrorKind::Reentrant | StateErrorKind::ActiveReferences => ErrorKind::WouldBlock,
            StateErrorKind::Path => ErrorKind::NotFound,
            StateErrorKind::Flags => ErrorKind::PermissionDenied,
            StateErrorKind::Ownership
            | StateErrorKind::Session
            | StateErrorKind::Registration
            | StateErrorKind::Token
            | StateErrorKind::Exhausted
            | StateErrorKind::Poisoned => ErrorKind::Other,
        };
        completion_io_error(kind, error.message)
    }
}

fn completion_io_error(kind: ErrorKind, operation: &'static str) -> LimboError {
    CompletionError::IOError(kind, operation).into()
}

fn limbo_to_completion(error: LimboError) -> CompletionError {
    match error {
        LimboError::CompletionError(error) => error,
        _ => CompletionError::IOError(ErrorKind::Other, "OPFS adapter"),
    }
}

fn js_handle_limbo_error(
    owner: OwnerId,
    operation: &'static str,
    value: &JsValue,
    fallback: ErrorKind,
) -> LimboError {
    LimboError::CompletionError(js_handle_completion_error(
        owner, operation, value, fallback,
    ))
}

fn js_handle_completion_error(
    owner: OwnerId,
    operation: &'static str,
    value: &JsValue,
    fallback: ErrorKind,
) -> CompletionError {
    if is_invalid_active_handle_error(value) {
        poison(
            owner,
            "browser reported invalid ownership/state for an active OPFS handle",
        );
    }
    js_completion_error(operation, value, fallback)
}

fn is_invalid_active_handle_error(value: &JsValue) -> bool {
    matches!(
        dom_exception_name(value).as_deref(),
        Some("InvalidStateError") | Some("NoModificationAllowedError")
    )
}

fn js_completion_error(
    operation: &'static str,
    value: &JsValue,
    fallback: ErrorKind,
) -> CompletionError {
    let kind = match dom_exception_name(value).as_deref() {
        Some("QuotaExceededError") => ErrorKind::StorageFull,
        Some("NotFoundError") => ErrorKind::NotFound,
        Some("InvalidStateError") | Some("NoModificationAllowedError") => ErrorKind::Other,
        Some("TypeMismatchError") | Some("InvalidModificationError") => ErrorKind::InvalidInput,
        _ => fallback,
    };
    CompletionError::IOError(kind, operation)
}

fn turso_error(operation: &'static str, error: LimboError) -> OpfsError {
    let kind = match &error {
        LimboError::CompletionError(CompletionError::IOError(ErrorKind::StorageFull, _)) => {
            OpfsErrorKind::StorageFull
        }
        _ => OpfsErrorKind::Turso,
    };
    OpfsError::new(kind, format!("Turso {operation} failed: {error}"))
}

fn js_error(kind: OpfsErrorKind, operation: &'static str, value: &JsValue) -> OpfsError {
    let actual_kind = if dom_exception_name(value).as_deref() == Some("QuotaExceededError") {
        OpfsErrorKind::StorageFull
    } else {
        kind
    };
    let name = dom_exception_name(value).unwrap_or_else(|| "JavaScriptError".into());
    OpfsError::new(actual_kind, format!("{operation} failed ({name})"))
}

fn dom_exception_name(value: &JsValue) -> Option<String> {
    value
        .dyn_ref::<DomException>()
        .map(DomException::name)
        .or_else(|| {
            Reflect::get(value, &JsValue::from_str("name"))
                .ok()
                .and_then(|name| name.as_string())
        })
}

fn poison(owner: OwnerId, reason: &str) {
    let _ = REGISTRY.try_with(|registry| {
        if let Ok(mut registry) = registry.try_borrow_mut() {
            let _ = registry.machine.poison(owner, reason.to_owned());
        }
    });
}

#[cfg(test)]
fn take_open_failure(role: FileRole) -> bool {
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        if registry.faults.fail_open == Some(role) {
            registry.faults.fail_open = None;
            true
        } else {
            false
        }
    })
}

#[cfg(test)]
fn take_reset_failure(fault: ResetFault) -> bool {
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        if registry.faults.reset_fault == Some(fault) {
            registry.faults.reset_fault = None;
            true
        } else {
            false
        }
    })
}

#[cfg(test)]
fn take_close_failure(role: FileRole) -> bool {
    REGISTRY.with(|registry| {
        let mut registry = registry.borrow_mut();
        if registry.faults.fail_close == Some(role) {
            registry.faults.fail_close = None;
            true
        } else {
            false
        }
    })
}

#[allow(dead_code)]
fn assert_send_sync_contract() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<OwnerId>();
    assert_send_sync::<SessionId>();
    assert_send_sync::<HandleId>();
    assert_send_sync::<OpfsIo>();
    assert_send_sync::<OpfsFile>();
}
