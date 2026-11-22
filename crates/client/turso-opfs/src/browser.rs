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
    FileSystemRemoveOptions, FileSystemSyncAccessHandle, WorkerGlobalScope,
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
    /// Moving an older identity's paths to this owner's paths failed.
    Move,
    /// Browser storage reported that its quota was full.
    StorageFull,
    /// The worker-local session is poisoned and cannot be reused.
    Poisoned,
    /// Turso requested a synchronous operation that this adapter forbids.
    Unsupported,
    /// Another context, usually a predecessor worker still being torn down,
    /// kept a database path open for the whole busy-entry wait. A busy open
    /// changed neither file and hands its owner back. A busy wipe or reset may
    /// already have removed the other path and poisons the owner like any
    /// partial wipe, so the worker must be replaced and the next owner wipes
    /// again; a busy [`OpfsOwner::remove_and_release`] still releases the lock.
    Busy,
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
        let id = acquire_database_lock(database_identity, &lock_name, false)
            .await?
            .ok_or_else(|| {
                OpfsError::new(OpfsErrorKind::Lock, "exclusive Web Lock was not granted")
            })?;
        Ok(Self {
            id,
            paths,
            lock_name,
            fresh: false,
            armed: true,
        })
    }

    /// Acquires this identity's exclusive Web Lock only if it is free now,
    /// never queueing behind another holder or waiter.
    ///
    /// Returns `None`, having touched no storage, when the lock is taken.
    pub async fn try_acquire(database_identity: &str) -> Result<Option<Self>, OpfsError> {
        let paths = approved_paths(database_identity)?;
        let lock_name = owner_lock_name(database_identity);
        Ok(acquire_database_lock(database_identity, &lock_name, true)
            .await?
            .map(|id| Self {
                id,
                paths,
                lock_name,
                fresh: false,
                armed: true,
            }))
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
        let deadline = BusyDeadline::start();
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

            let (handle, was_created) =
                match open_sync_handle(&root, paths.get(role), deadline).await {
                    Ok(value) => value,
                    Err(error) => {
                        let adapter_error =
                            entry_error(OpfsErrorKind::Open, "OPFS sync handle open", &error);
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

    /// Deletes both approved paths without recreating them, then releases the
    /// lock. This discards a database that no context uses any more.
    ///
    /// Unlike [`Self::recovery_wipe`], a failed removal does not poison the
    /// registry: the lock is still released, the error is returned, and any
    /// path left behind can be removed by a later attempt.
    pub async fn remove_and_release(self) -> Result<(), OpfsError> {
        REGISTRY
            .with(|registry| {
                registry
                    .borrow_mut()
                    .machine
                    .start_wipe(self.id, self.paths.clone())
            })
            .map_err(state_error)?;
        let removed = remove_paths(&self.paths).await;
        REGISTRY
            .with(|registry| registry.borrow_mut().machine.finish_wipe(self.id))
            .map_err(state_error)?;
        self.release().await?;
        removed
    }

    /// Takes `previous_identity`'s exclusive Web Lock if it is free now, and
    /// holds it until [`PreviousLock::release`] or drop. `None` when another
    /// context holds or awaits it: a context of the build that owns that
    /// identity has its files open, or is about to.
    ///
    /// Holding it keeps that build away from its files while they move here,
    /// while they first open here, and while they move back, so it never opens
    /// half a pair or a pair this build is changing.
    pub async fn lock_previous(
        &self,
        previous_identity: &str,
    ) -> Result<Option<PreviousLock>, OpfsError> {
        let paths = approved_paths(previous_identity)?;
        if paths == self.paths {
            return Err(OpfsError::new(
                OpfsErrorKind::InvalidName,
                "an owner cannot lock its own identity as a previous one",
            ));
        }
        PreviousLock::request(previous_identity.to_owned(), paths).await
    }

    /// Moves the complete main/WAL pair of the identity `previous` locks, an
    /// identity an older build opened, to this owner's paths, so this owner
    /// opens it as existing storage instead of starting empty.
    ///
    /// Main and WAL move under their new names, so no checkpoint is needed and
    /// every committed frame moves with them. Nothing moves when this owner's
    /// main file exists, when the previous pair is incomplete, empty, or does
    /// not have headers Turso opens, or when this browser cannot move OPFS
    /// entries.
    ///
    /// Before the first move, a marker beside this owner's main file records
    /// the previous identity and the size and header of its WAL. It stays until
    /// the first open of the moved files succeeds
    /// ([`ConnectedOpfsSession::finish_adoption`]), so a stop between the two
    /// moves can be completed ([`Self::complete_adoption`]) and files that
    /// never opened can go back ([`Self::return_adoption`]). When the WAL move
    /// fails, the main file is moved back.
    pub async fn adopt(&mut self, previous: &PreviousLock) -> Result<AdoptOutcome, OpfsError> {
        let identity = previous.identity.clone();
        let from = previous.paths.clone();
        let to = self.paths.clone();
        self.in_adoption_phase(adopt_pair(identity, from, to)).await
    }

    /// The adoption into this owner's paths whose first open has not
    /// succeeded yet, if a marker records one. A marker this adapter did not
    /// write completely, or one whose main file never moved here (or moved
    /// back), is removed, with any WAL left beside it, and reads as none.
    pub async fn read_adoption(&mut self) -> Result<Option<Adoption>, OpfsError> {
        let to = self.paths.clone();
        self.in_adoption_phase(read_pending(to)).await
    }

    /// Whether this owner's main file exists. Checked before adopting, so the
    /// usual open, where this build's file already exists, never contends for
    /// another identity's lock.
    pub async fn main_file_exists(&mut self) -> Result<bool, OpfsError> {
        let to = self.paths.clone();
        self.in_adoption_phase(async move {
            let root = adoption_root().await?;
            Ok(existing_file(&root, to.get(FileRole::Main))
                .await?
                .is_some())
        })
        .await
    }

    /// Completes a [`AdoptionState::Split`] adoption, whose main file moved
    /// here and whose WAL did not. A WAL that was empty is recreated here. A
    /// non-empty one moves here only under `previous`, the lock of the identity
    /// the marker names, and only while it still has the size and header the
    /// marker recorded: once the older build reset that identity (it resets a
    /// pair whose main file is missing), its WAL belongs to another database.
    /// Without `previous`, that WAL is not read at all, since the older build
    /// may be using it: the result is [`CompleteOutcome::LockNeeded`].
    pub async fn complete_adoption(
        &mut self,
        previous: Option<&PreviousLock>,
    ) -> Result<CompleteOutcome, OpfsError> {
        let to = self.paths.clone();
        let previous = previous.map(|lock| (lock.identity.clone(), lock.paths.clone()));
        self.in_adoption_phase(complete_pair(to, previous)).await
    }

    /// Moves files an adoption brought to this owner's paths back to the
    /// identity `previous` locks, so the build that wrote them finds them where
    /// it left them, then removes the marker.
    ///
    /// Only a self-contained database goes back, in one rename: this owner's
    /// WAL must be empty (a close checkpoints it), or the result is
    /// [`ReturnOutcome::WalNotEmpty`]; and the previous identity must have no
    /// main file and at most an empty WAL, or it is
    /// [`ReturnOutcome::Occupied`]. Either way nothing moves. A pair that is
    /// not whole here is an error. Once the main file is back the result is
    /// [`ReturnOutcome::Returned`], even if removing this owner's empty WAL or
    /// the marker fails: the next read removes a marker left without a main
    /// file. The caller decides that the files are still what the older build
    /// wrote; this method only moves them.
    pub async fn return_adoption(
        &mut self,
        previous: &PreviousLock,
    ) -> Result<ReturnOutcome, OpfsError> {
        let to = self.paths.clone();
        let from = previous.paths.clone();
        self.in_adoption_phase(return_pair(to, from)).await
    }

    /// Counts one more attempt to decide the adoption into this owner's
    /// paths and returns how many were counted since it began. The count is a
    /// file of its own beside the marker, written whole with eight free slots
    /// before any file moved, so counting overwrites one byte in place, needs
    /// no more storage, works while the marker cannot be read, and never
    /// touches the marker. Once every slot is used it stays at eight without
    /// writing. Fails when nothing sits at the marker's name (a count left
    /// after its marker went belongs to no adoption) or there is no count,
    /// when the count is not
    /// exactly its eight slots (so a count cut short never counts attempts
    /// nobody made), or when it cannot be read or written.
    pub async fn record_attempt(&mut self) -> Result<u8, OpfsError> {
        let to = self.paths.clone();
        self.in_adoption_phase(async move {
            let root = adoption_root().await?;
            if !entry_present(&root, &marker_path(&to)).await? {
                return Err(OpfsError::new(
                    OpfsErrorKind::Write,
                    "no adoption marker beside this owner's paths",
                ));
            }
            let file = existing_file(&root, &attempts_path(&to))
                .await?
                .ok_or_else(|| {
                    OpfsError::new(
                        OpfsErrorKind::Write,
                        "no attempt count beside this owner's paths",
                    )
                })?;
            count_attempt(&file, BusyDeadline::start()).await
        })
        .await
    }

    /// When the adoption into this owner's paths began, read from its marker
    /// alone, for a caller whose [`read_adoption`](Self::read_adoption) failed
    /// after the marker itself read, for example on the files beside it.
    /// `None` when there is no marker, or one that does not read as written
    /// (which is removed, as `read_adoption` removes it).
    pub async fn read_adoption_time(&mut self) -> Result<Option<u64>, OpfsError> {
        let to = self.paths.clone();
        self.in_adoption_phase(async move {
            let root = adoption_root().await?;
            let marker = read_marker(&root, &to, BusyDeadline::start()).await?;
            Ok(marker.map(|marker| marker.adopted_at_ms))
        })
        .await
    }

    /// Removes the adoption marker beside this owner's paths, so the files here
    /// are this owner's own from now on. Does nothing when there is none.
    pub async fn discard_adoption(&mut self) -> Result<(), OpfsError> {
        let to = self.paths.clone();
        self.in_adoption_phase(async move {
            let root = adoption_root().await?;
            remove_marker(&root, &to, BusyDeadline::start()).await
        })
        .await
    }

    /// Runs an adoption step with every other use of this owner's paths in
    /// this worker blocked, as a wipe does, while entries move in or out.
    async fn in_adoption_phase<T>(
        &mut self,
        step: impl std::future::Future<Output = Result<T, OpfsError>>,
    ) -> Result<T, OpfsError> {
        REGISTRY
            .with(|registry| {
                registry
                    .borrow_mut()
                    .machine
                    .start_wipe(self.id, self.paths.clone())
            })
            .map_err(state_error)?;
        let mut guard = AsyncPoisonGuard::new(self.id, "adoption cancelled before completion");
        let outcome = step.await;
        REGISTRY
            .with(|registry| registry.borrow_mut().machine.finish_wipe(self.id))
            .map_err(state_error)?;
        guard.disarm();
        outcome
    }
}

/// What [`OpfsOwner::adopt`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdoptOutcome {
    /// The previous identity's pair now sits at this owner's paths.
    Adopted,
    /// This owner's main file already exists; nothing moved.
    TargetExists,
    /// The previous identity has no complete pair, or both of its files are
    /// empty; nothing moved.
    NothingToAdopt,
    /// A previous file does not have a header Turso opens; nothing moved.
    Unreadable,
    /// This browser cannot move OPFS entries; nothing moved.
    Unsupported,
    /// The previous identity's whole pair has a marker beside it: an
    /// adoption into it whose first open has not succeeded, or whose marker
    /// could not be removed. Its build decides those files first, and they
    /// may still go back further, so nothing moved.
    PreviousAdopting,
}

/// An adoption into an owner's paths whose first open has not succeeded yet.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Adoption {
    /// The identity the files came from.
    pub previous_identity: String,
    /// Which of the files moved.
    pub state: AdoptionState,
    /// When the adoption began, in milliseconds since the Unix epoch by this
    /// browser's clock.
    pub adopted_at_ms: u64,
}

/// Which files of an [`Adoption`] sit at the owner's paths.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdoptionState {
    /// Both, ready to open.
    Complete,
    /// Only the main file; the WAL is still at the previous identity, or gone.
    /// See [`OpfsOwner::complete_adoption`].
    Split,
}

/// What [`OpfsOwner::complete_adoption`] found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompleteOutcome {
    /// Main file and WAL now sit at this owner's paths.
    Completed,
    /// The WAL that went with the moved main file is gone or was replaced, or
    /// the adoption itself is gone, so the main file alone cannot be opened
    /// safely.
    WalLost,
    /// The WAL is still at the previous identity, and moving it needs that
    /// identity's lock, which the caller did not pass. Nothing was read there.
    LockNeeded,
}

/// What [`OpfsOwner::return_adoption`] did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReturnOutcome {
    /// The database sits at the previous identity again, this owner's paths
    /// are empty and the marker is gone.
    Returned,
    /// The previous identity holds a database again; nothing moved.
    Occupied,
    /// This owner's WAL still holds frames, so the main file alone is not the
    /// whole database; nothing moved.
    WalNotEmpty,
}

/// An exclusive Web Lock on another identity, from
/// [`OpfsOwner::lock_previous`]. Releasing it lets that identity's own build
/// open its files again.
pub struct PreviousLock {
    identity: String,
    paths: Paths,
    /// Resolves the promise the lock callback returned, which releases the
    /// lock.
    release: Option<Function>,
    /// The lock request, which settles once the lock is released.
    settled: Option<Promise>,
}

impl fmt::Debug for PreviousLock {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreviousLock")
            .field("identity", &self.identity)
            .finish_non_exhaustive()
    }
}

impl PreviousLock {
    /// The identity this lock holds.
    pub fn identity(&self) -> &str {
        &self.identity
    }

    async fn request(identity: String, paths: Paths) -> Result<Option<Self>, OpfsError> {
        let lock_error =
            |operation, error: &JsValue| js_error(OpfsErrorKind::Lock, operation, error);
        let worker = js_sys::global()
            .dyn_into::<DedicatedWorkerGlobalScope>()
            .map_err(|error| lock_error("DedicatedWorker lock scope", &error))?;
        let manager = Reflect::get(worker.navigator().as_ref(), &JsValue::from_str("locks"))
            .map_err(|error| lock_error("Web Lock manager", &error))?;
        let request = Reflect::get(&manager, &JsValue::from_str("request"))
            .and_then(|value| value.dyn_into::<Function>())
            .map_err(|error| lock_error("Web Lock request function", &error))?;
        let options = Object::new();
        for (key, value) in [
            ("mode", JsValue::from_str("exclusive")),
            ("ifAvailable", JsValue::TRUE),
        ] {
            Reflect::set(options.as_ref(), &JsValue::from_str(key), &value)
                .map_err(|error| lock_error("Web Lock options", &error))?;
        }
        let mut release = None;
        let held = Promise::new(&mut |resolve, _reject| release = Some(resolve));
        let mut granted = None;
        let answered = Promise::new(&mut |resolve, _reject| granted = Some(resolve));
        let (Some(release), Some(granted)) = (release, granted) else {
            return Err(OpfsError::new(
                OpfsErrorKind::Lock,
                "Promise executor did not run synchronously",
            ));
        };
        // Resolves `held` unless this request hands it to a `PreviousLock`, so
        // a request dropped before it returns, or one that fails, lets the
        // lock go as soon as the browser grants it.
        let release = ReleaseOnDrop(Some(release));
        let callback = Closure::once_into_js(move |lock: JsValue| -> Promise {
            let acquired = !lock.is_null() && !lock.is_undefined();
            let _ = granted.call1(&JsValue::UNDEFINED, &JsValue::from_bool(acquired));
            if acquired {
                held
            } else {
                Promise::resolve(&JsValue::UNDEFINED)
            }
        });
        let settled = request
            .call3(
                &manager,
                &JsValue::from_str(&owner_lock_name(&identity)),
                options.as_ref(),
                &callback,
            )
            .and_then(|value| value.dyn_into::<Promise>())
            .map_err(|error| lock_error("Web Lock request", &error))?;
        // The callback answers before the request settles; a request that
        // fails before calling it rejects instead.
        let answer = JsFuture::from(Promise::race(&js_sys::Array::of2(&answered, &settled)))
            .await
            .map_err(|error| lock_error("Web Lock answer", &error))?;
        if answer.as_bool() != Some(true) {
            return Ok(None);
        }
        Ok(Some(Self {
            identity,
            paths,
            release: release.disarm(),
            settled: Some(settled),
        }))
    }

    /// Releases the lock and waits until the browser has let it go.
    pub async fn release(mut self) -> Result<(), OpfsError> {
        if let Some(release) = self.release.take() {
            release
                .call0(&JsValue::UNDEFINED)
                .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock release", &error))?;
        }
        if let Some(settled) = self.settled.take() {
            JsFuture::from(settled)
                .await
                .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock release", &error))?;
        }
        Ok(())
    }
}

impl Drop for PreviousLock {
    fn drop(&mut self) {
        // Let the lock go without waiting; nothing here touches files.
        if let Some(release) = self.release.take() {
            let _ = release.call0(&JsValue::UNDEFINED);
        }
    }
}

/// The resolver of a lock callback's promise, called on drop unless taken.
struct ReleaseOnDrop(Option<Function>);

impl ReleaseOnDrop {
    fn disarm(mut self) -> Option<Function> {
        self.0.take()
    }
}

impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        if let Some(release) = self.0.take() {
            let _ = release.call0(&JsValue::UNDEFINED);
        }
    }
}

#[cfg(test)]
thread_local! {
    /// Stops an adoption between its two moves, as a stopped process would.
    static STOP_BETWEEN_MOVES: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// Makes the WAL move of the next adoption fail.
    static FAIL_WAL_MOVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// When not zero, the prefix read this many reads from now returns one
    /// byte fewer than asked, as a read that fails part-way does.
    static SHORT_READ: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
    /// Makes the next attempt count write fail, as a storage error would.
    static FAIL_ATTEMPT_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

async fn existing_file(
    root: &FileSystemDirectoryHandle,
    path: &str,
) -> Result<Option<FileSystemFileHandle>, OpfsError> {
    match JsFuture::from(root.get_file_handle(path)).await {
        Ok(file) => file
            .dyn_into::<FileSystemFileHandle>()
            .map(Some)
            .map_err(|error| js_error(OpfsErrorKind::Move, "OPFS entry kind", &error)),
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(js_error(OpfsErrorKind::Move, "OPFS entry lookup", &error)),
    }
}

/// Whether anything sits at `path`, a directory included.
async fn entry_present(root: &FileSystemDirectoryHandle, path: &str) -> Result<bool, OpfsError> {
    match JsFuture::from(root.get_file_handle(path)).await {
        Ok(_) => Ok(true),
        Err(error) if is_not_found(&error) => Ok(false),
        Err(error) if dom_exception_name(&error).as_deref() == Some("TypeMismatchError") => {
            Ok(true)
        }
        Err(error) => Err(js_error(OpfsErrorKind::Read, "OPFS entry lookup", &error)),
    }
}

/// Creates `path` as an empty file if it does not exist.
async fn create_empty(root: &FileSystemDirectoryHandle, path: &str) -> Result<(), OpfsError> {
    let options = FileSystemGetFileOptions::new();
    options.set_create(true);
    JsFuture::from(root.get_file_handle_with_options(path, &options))
        .await
        .map(drop)
        .map_err(|error| js_error(OpfsErrorKind::Recreate, "OPFS empty file create", &error))
}

/// `FileSystemHandle.move`, absent in browsers that cannot rename OPFS entries.
fn move_function(file: &FileSystemFileHandle) -> Option<Function> {
    Reflect::get(file.as_ref(), &JsValue::from_str("move"))
        .ok()?
        .dyn_into::<Function>()
        .ok()
}

/// Renames `file` within `root`.
async fn move_entry(
    root: &FileSystemDirectoryHandle,
    file: &FileSystemFileHandle,
    name: &str,
    deadline: BusyDeadline,
) -> Result<(), OpfsError> {
    let move_function = move_function(file).ok_or_else(|| {
        OpfsError::new(
            OpfsErrorKind::Move,
            "FileSystemHandle.move is not available",
        )
    })?;
    let name = JsValue::from_str(name);
    retry_busy_entry(deadline, || {
        move_function
            .call2(file.as_ref(), root.as_ref(), &name)
            .and_then(|value| value.dyn_into::<Promise>())
            .unwrap_or_else(|error| Promise::reject(&error))
    })
    .await
    .map(|_| ())
    .map_err(|error| entry_error(OpfsErrorKind::Move, "OPFS entry move", &error))
}

async fn adoption_root() -> Result<FileSystemDirectoryHandle, OpfsError> {
    worker_root()
        .await
        .map_err(|error| js_error(OpfsErrorKind::Move, "OPFS move root open", &error))
}

/// Which of `paths` exist, by role.
async fn present_files(
    root: &FileSystemDirectoryHandle,
    paths: &Paths,
) -> Result<[Option<FileSystemFileHandle>; 2], OpfsError> {
    Ok([
        existing_file(root, paths.get(FileRole::Main)).await?,
        existing_file(root, paths.get(FileRole::Wal)).await?,
    ])
}

/// Checks this owner's main file before reading the previous pair, so the
/// usual open, where this build's file already exists, costs one lookup.
/// Nothing else creates these paths meanwhile: this owner holds their lock,
/// and the caller holds the previous identity's.
async fn adopt_pair(
    previous_identity: String,
    from: Paths,
    to: Paths,
) -> Result<AdoptOutcome, OpfsError> {
    let root = adoption_root().await?;
    let deadline = BusyDeadline::start();
    if existing_file(&root, to.get(FileRole::Main))
        .await?
        .is_some()
    {
        return Ok(AdoptOutcome::TargetExists);
    }
    let [Some(main), Some(wal)] = present_files(&root, &from).await? else {
        // No whole pair at `from`, with or without a marker: a marker there
        // is an adoption into `from` stopped before its moves finished, or a
        // wipe stopped after removing its pair. Any whole pair that adoption
        // named is still at its own name, where the caller looks next; a
        // split has none, so nothing moves and the build of `from` completes
        // it.
        return Ok(AdoptOutcome::NothingToAdopt);
    };
    // Moving a whole pair with a marker would leave the marker behind: once
    // the files sit elsewhere, the previous identity's build removes a
    // marker without a main file, and a pair that came back would no longer
    // say where it came from or which version it was moved at.
    if existing_file(&root, &marker_path(&from)).await?.is_some() {
        return Ok(AdoptOutcome::PreviousAdopting);
    }
    let wal_fingerprint = match pair_headers(&main, &wal, deadline).await? {
        PairHeaders::Empty => return Ok(AdoptOutcome::NothingToAdopt),
        PairHeaders::Unreadable => return Ok(AdoptOutcome::Unreadable),
        PairHeaders::Readable(wal) => wal,
    };
    if move_function(&main).is_none() {
        return Ok(AdoptOutcome::Unsupported);
    }
    // A WAL without its main file is unusable: an open of this owner resets
    // it. Remove it so the previous WAL can take its name.
    remove_if_present(&root, to.get(FileRole::Wal), false, deadline).await?;
    let marker = Marker {
        previous_identity,
        wal: wal_fingerprint,
        // Dates are whole milliseconds; one before the epoch reads as it.
        adopted_at_ms: js_sys::Date::now() as u64,
    };
    write_marker(&root, &to, &marker, deadline).await?;
    move_entry(&root, &main, to.get(FileRole::Main), deadline).await?;
    #[cfg(test)]
    if STOP_BETWEEN_MOVES.with(|stop| stop.replace(false)) {
        return Err(OpfsError::new(
            OpfsErrorKind::Move,
            "injected stop between moves",
        ));
    }
    #[cfg(test)]
    let moved = if FAIL_WAL_MOVE.with(|fail| fail.replace(false)) {
        Err(OpfsError::new(
            OpfsErrorKind::Move,
            "injected WAL move failure",
        ))
    } else {
        move_entry(&root, &wal, to.get(FileRole::Wal), deadline).await
    };
    #[cfg(not(test))]
    let moved = move_entry(&root, &wal, to.get(FileRole::Wal), deadline).await;
    if let Err(error) = moved {
        // Put the main file back so the previous pair stays whole. If that
        // fails too, the marker stays and the adoption reads as split.
        if move_entry(&root, &main, from.get(FileRole::Main), deadline)
            .await
            .is_ok()
        {
            let _ = remove_marker(&root, &to, deadline).await;
        }
        return Err(error);
    }
    Ok(AdoptOutcome::Adopted)
}

async fn read_pending(to: Paths) -> Result<Option<Adoption>, OpfsError> {
    let root = adoption_root().await?;
    let deadline = BusyDeadline::start();
    let Some(marker) = read_marker(&root, &to, deadline).await? else {
        return Ok(None);
    };
    let [main, wal] = present_files(&root, &to).await?;
    if main.is_none() {
        // The main file never moved here, or moved back: whatever WAL sits
        // here cannot be opened, and the marker records nothing that happened.
        remove_if_present(&root, to.get(FileRole::Wal), false, deadline).await?;
        remove_marker(&root, &to, deadline).await?;
        return Ok(None);
    }
    Ok(Some(Adoption {
        previous_identity: marker.previous_identity,
        state: if wal.is_some() {
            AdoptionState::Complete
        } else {
            AdoptionState::Split
        },
        adopted_at_ms: marker.adopted_at_ms,
    }))
}

async fn complete_pair(
    to: Paths,
    previous: Option<(String, Paths)>,
) -> Result<CompleteOutcome, OpfsError> {
    let root = adoption_root().await?;
    let deadline = BusyDeadline::start();
    let Some(marker) = read_marker(&root, &to, deadline).await? else {
        return Ok(CompleteOutcome::WalLost);
    };
    match present_files(&root, &to).await? {
        [Some(_), Some(_)] => return Ok(CompleteOutcome::Completed),
        [Some(_), None] => {}
        [None, _] => return Ok(CompleteOutcome::WalLost),
    }
    if marker.wal.size == 0 {
        create_empty(&root, to.get(FileRole::Wal)).await?;
        return Ok(CompleteOutcome::Completed);
    }
    let Some((identity, from)) = previous else {
        return Ok(CompleteOutcome::LockNeeded);
    };
    if identity != marker.previous_identity {
        return Err(OpfsError::new(
            OpfsErrorKind::InvalidName,
            "the lock held is not the identity the adoption marker names",
        ));
    }
    let Some(wal) = existing_file(&root, from.get(FileRole::Wal)).await? else {
        return Ok(CompleteOutcome::WalLost);
    };
    let (size, header) = file_prefix(&wal, WAL_HEADER_LEN, deadline).await?;
    if size != marker.wal.size || header != marker.wal.header {
        return Ok(CompleteOutcome::WalLost);
    }
    move_entry(&root, &wal, to.get(FileRole::Wal), deadline).await?;
    Ok(CompleteOutcome::Completed)
}

async fn return_pair(to: Paths, from: Paths) -> Result<ReturnOutcome, OpfsError> {
    let root = adoption_root().await?;
    let deadline = BusyDeadline::start();
    let [Some(main), Some(wal)] = present_files(&root, &to).await? else {
        return Err(OpfsError::new(
            OpfsErrorKind::Move,
            "this owner has no whole pair to return",
        ));
    };
    if file_prefix(&wal, 0, deadline).await?.0 != 0 {
        return Ok(ReturnOutcome::WalNotEmpty);
    }
    let [previous_main, previous_wal] = present_files(&root, &from).await?;
    if previous_main.is_some() {
        return Ok(ReturnOutcome::Occupied);
    }
    if let Some(previous_wal) = &previous_wal
        && file_prefix(previous_wal, 0, deadline).await?.0 != 0
    {
        return Ok(ReturnOutcome::Occupied);
    }
    // A marker there beside no main file is an adoption into the older
    // identity stopped before its main file moved, or a wipe stopped after
    // removing it. It goes first, as the next read there would remove it, so
    // the pair coming back is never taken for the files that adoption was
    // moving.
    remove_marker(&root, &from, deadline).await?;
    if previous_wal.is_none() {
        // The pair is whole the moment the main file arrives.
        create_empty(&root, from.get(FileRole::Wal)).await?;
    }
    move_entry(&root, &main, from.get(FileRole::Main), deadline).await?;
    // The pair went back. A stop or a failure from here on leaves a marker
    // without a main file, which the next read removes together with this
    // empty WAL, so cleaning up is best effort and never says the files are
    // still here.
    let _ = remove_if_present(&root, to.get(FileRole::Wal), false, deadline).await;
    let _ = remove_marker(&root, &to, deadline).await;
    Ok(ReturnOutcome::Returned)
}

/// The first bytes of an SQLite database file.
const DATABASE_HEADER: &[u8; 16] = b"SQLite format 3\0";
/// The size of an SQLite database header.
const DATABASE_HEADER_LEN: usize = 100;
/// The two magic numbers an SQLite WAL header starts with, big-endian.
const WAL_MAGICS: [[u8; 4]; 2] = [[0x37, 0x7f, 0x06, 0x82], [0x37, 0x7f, 0x06, 0x83]];
/// The WAL format version every SQLite WAL header carries.
const WAL_FORMAT_VERSION: u32 = 3_007_000;
/// The size of an SQLite WAL header.
const WAL_HEADER_LEN: usize = 32;

/// A WAL's size and its first [`WAL_HEADER_LEN`] bytes (fewer when it is
/// shorter). The header carries random salts a reset changes, so a WAL that
/// still matches is the one recorded.
#[derive(Clone, Debug, PartialEq, Eq)]
struct WalFingerprint {
    size: u64,
    header: Vec<u8>,
}

enum PairHeaders {
    /// Both files are empty: the pair never held a database.
    Empty,
    /// Each non-empty file has a header Turso opens, with matching page sizes,
    /// and a non-empty main file holds whole pages and a readable first page.
    Readable(WalFingerprint),
    /// A non-empty file has a header Turso rejects.
    Unreadable,
}

/// Reads the headers of the previous pair, so a file Turso could not open is
/// never moved in to fail this owner's open.
async fn pair_headers(
    main: &FileSystemFileHandle,
    wal: &FileSystemFileHandle,
    deadline: BusyDeadline,
) -> Result<PairHeaders, OpfsError> {
    let (main_size, main_head) = file_prefix(main, DATABASE_HEADER_LEN + 1, deadline).await?;
    let (wal_size, wal_head) = file_prefix(wal, WAL_HEADER_LEN, deadline).await?;
    if main_size == 0 && wal_size == 0 {
        return Ok(PairHeaders::Empty);
    }
    let main_page = (main_size > 0).then(|| {
        database_page_size(&main_head)
            .filter(|&page| first_page_readable(main_size, &main_head, page))
    });
    let wal_page = (wal_size > 0).then(|| wal_page_size(&wal_head));
    let readable = match (main_page, wal_page) {
        (Some(None), _) | (_, Some(None)) | (None, None) => false,
        (Some(Some(main)), Some(Some(wal))) => main == wal,
        (Some(Some(_)), None) | (None, Some(Some(_))) => true,
    };
    Ok(if readable {
        PairHeaders::Readable(WalFingerprint {
            size: wal_size,
            header: wal_head,
        })
    } else {
        PairHeaders::Unreadable
    })
}

fn be_u16(bytes: &[u8], at: usize) -> Option<u16> {
    bytes
        .get(at..at + 2)?
        .try_into()
        .ok()
        .map(u16::from_be_bytes)
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    bytes
        .get(at..at + 4)?
        .try_into()
        .ok()
        .map(u32::from_be_bytes)
}

/// A page size SQLite allows: a power of two from 512 to 65536.
fn valid_page_size(size: u32) -> bool {
    (512..=65_536).contains(&size) && size.is_power_of_two()
}

/// The page size of a database header Turso opens, as its open checks it:
/// a whole header, magic, page size, equal read and write versions it knows,
/// usable space, the fixed payload fractions, and a UTF-8 or unset text
/// encoding.
fn database_page_size(header: &[u8]) -> Option<u32> {
    if header.len() < DATABASE_HEADER_LEN
        || header.get(..DATABASE_HEADER.len())? != DATABASE_HEADER.as_slice()
    {
        return None;
    }
    // 1 stands for 65536, which does not fit the field.
    let page_size = match be_u16(header, 16)? {
        1 => 65_536,
        size => u32::from(size),
    };
    let &[
        write_version,
        read_version,
        reserved,
        max_embed,
        min_embed,
        leaf,
    ] = header.get(18..24)?
    else {
        return None;
    };
    let encoding = be_u32(header, 56)?;
    (valid_page_size(page_size)
        && write_version == read_version
        && matches!(write_version, 1 | 2)
        && page_size.saturating_sub(u32::from(reserved)) >= 480
        && (max_embed, min_embed, leaf) == (64, 32, 32)
        && matches!(encoding, 0 | 1))
    .then_some(page_size)
}

/// Whether a database file of `size` bytes, starting with `head`, holds whole
/// pages of `page_size` and a first page Turso reads as a table b-tree page
/// (interior or leaf), as its open and first schema read require.
fn first_page_readable(size: u64, head: &[u8], page_size: u32) -> bool {
    let page_size = u64::from(page_size);
    size >= page_size
        && size.is_multiple_of(page_size)
        && matches!(head.get(DATABASE_HEADER_LEN), Some(0x05 | 0x0d))
}

/// The page size of a WAL header Turso opens: a whole header, magic, format
/// version and a valid page size.
fn wal_page_size(header: &[u8]) -> Option<u32> {
    if header.len() < WAL_HEADER_LEN {
        return None;
    }
    let magic = header.get(..4)?;
    let page_size = be_u32(header, 8)?;
    (WAL_MAGICS.iter().any(|known| magic == known.as_slice())
        && be_u32(header, 4)? == WAL_FORMAT_VERSION
        && valid_page_size(page_size))
    .then_some(page_size)
}

/// A file's size and up to its first `len` bytes.
async fn file_prefix(
    file: &FileSystemFileHandle,
    len: usize,
    deadline: BusyDeadline,
) -> Result<(u64, Vec<u8>), OpfsError> {
    let handle = retry_busy_entry(deadline, || file.create_sync_access_handle())
        .await
        .and_then(|value| value.dyn_into::<FileSystemSyncAccessHandle>())
        .map_err(|error| entry_error(OpfsErrorKind::Read, "OPFS header open", &error))?;
    let read = read_prefix(&handle, len);
    let closed = close_sync_handle(&handle);
    let read = read.map_err(|error| js_error(OpfsErrorKind::Read, "OPFS header read", &error))?;
    closed.map_err(|error| js_error(OpfsErrorKind::Read, "OPFS header close", &error))?;
    Ok(read)
}

/// A file's size and up to its first `len` bytes. A read that returns fewer
/// bytes than the file holds there failed part-way, which the File System
/// standard reports as a shorter count, so it is an error: read as content, a
/// cut-off marker or WAL header would look like one that is not there.
fn read_prefix(handle: &FileSystemSyncAccessHandle, len: usize) -> Result<(u64, Vec<u8>), JsValue> {
    // OPFS sizes are non-negative integers below 2^53.
    let size = handle.get_size()? as u64;
    let expected = usize::try_from(size).map_or(len, |size| size.min(len));
    let mut bytes = vec![0; expected];
    if expected > 0 {
        let options = FileSystemReadWriteOptions::new();
        options.set_at(0.0);
        let read = handle.read_with_u8_array_and_options(&mut bytes, &options)?;
        #[cfg(test)]
        let read = if SHORT_READ.with(|short| short.replace(short.get().saturating_sub(1)) == 1) {
            read - 1.0
        } else {
            read
        };
        if read as usize != expected {
            return Err(JsValue::from_str("short OPFS read"));
        }
    }
    Ok((size, bytes))
}

/// Suffix of the marker file that records an adoption into an identity until
/// its first open succeeds. No approved identity ends with it.
const ADOPTION_MARKER_SUFFIX: &str = "-adopting";
/// Suffix of the file beside a marker that counts the attempts made to
/// decide its adoption. No approved identity ends with it either.
const ATTEMPTS_SUFFIX: &str = "-adopting-attempts";
/// The first bytes of every marker, so no other file reads as one.
const MARKER_MAGIC: &[u8] = b"turso-opfs adoption v1\n";
/// A marker holds one identity, a WAL header and a time; anything longer was
/// not written here.
const MAX_MARKER_BYTES: usize = 4096;
/// The attempt count as written before any file moves: one free slot per
/// attempt it can count, so counting overwrites a byte in place and needs no
/// more storage.
const FREE_ATTEMPTS: [u8; 8] = [FREE_ATTEMPT_BYTE; 8];
/// An attempt slot no attempt has used.
const FREE_ATTEMPT_BYTE: u8 = b'-';
/// Written over a free slot for each attempt [`OpfsOwner::record_attempt`]
/// counts.
const ATTEMPT_BYTE: u8 = b'+';

/// What a marker records: where the files came from, the WAL that went with
/// the main file, and when the adoption began. Written once, never changed.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Marker {
    previous_identity: String,
    wal: WalFingerprint,
    adopted_at_ms: u64,
}

impl Marker {
    /// Magic, identity length (u16) and bytes, WAL size (u64), header length
    /// (u8) and bytes, then the adoption time (u64), all big-endian.
    fn encode(&self) -> Option<Vec<u8>> {
        let identity = self.previous_identity.as_bytes();
        let identity_len = u16::try_from(identity.len()).ok()?;
        let header_len = u8::try_from(self.wal.header.len()).ok()?;
        let mut bytes = MARKER_MAGIC.to_vec();
        bytes.extend_from_slice(&identity_len.to_be_bytes());
        bytes.extend_from_slice(identity);
        bytes.extend_from_slice(&self.wal.size.to_be_bytes());
        bytes.push(header_len);
        bytes.extend_from_slice(&self.wal.header);
        bytes.extend_from_slice(&self.adopted_at_ms.to_be_bytes());
        (bytes.len() <= MAX_MARKER_BYTES).then_some(bytes)
    }

    /// The marker `bytes` hold, or `None` when they do not hold one exactly.
    fn decode(bytes: &[u8]) -> Option<Self> {
        let rest = bytes.strip_prefix(MARKER_MAGIC)?;
        let (identity_len, rest) = rest.split_first_chunk::<2>()?;
        let (identity, rest) =
            rest.split_at_checked(usize::from(u16::from_be_bytes(*identity_len)))?;
        let (size, rest) = rest.split_first_chunk::<8>()?;
        let (header_len, rest) = rest.split_first()?;
        let (header, rest) = rest.split_at_checked(usize::from(*header_len))?;
        let (adopted_at_ms, rest) = rest.split_first_chunk::<8>()?;
        let wal = WalFingerprint {
            size: u64::from_be_bytes(*size),
            header: header.to_vec(),
        };
        let valid_header = header.len() <= WAL_HEADER_LEN
            && u64::try_from(header.len()).ok() == Some(wal.size.min(WAL_HEADER_LEN as u64));
        (valid_header && rest.is_empty()).then_some(())?;
        Some(Self {
            previous_identity: String::from_utf8(identity.to_vec()).ok()?,
            wal,
            adopted_at_ms: u64::from_be_bytes(*adopted_at_ms),
        })
    }
}

/// How many attempts the count `slots` holds after one more, and where that
/// one is written: the first free slot, or nowhere once every slot is used.
fn next_attempt(slots: &[u8; FREE_ATTEMPTS.len()]) -> (u8, Option<usize>) {
    let used = slots
        .iter()
        .filter(|&&byte| byte != FREE_ATTEMPT_BYTE)
        .count();
    let free = slots.iter().position(|&byte| byte == FREE_ATTEMPT_BYTE);
    let counted = used + usize::from(free.is_some());
    (u8::try_from(counted).unwrap_or(u8::MAX), free)
}

/// Counts one more attempt in the count `file` and returns how many it
/// holds.
async fn count_attempt(
    file: &FileSystemFileHandle,
    deadline: BusyDeadline,
) -> Result<u8, OpfsError> {
    let handle = retry_busy_entry(deadline, || file.create_sync_access_handle())
        .await
        .and_then(|value| value.dyn_into::<FileSystemSyncAccessHandle>())
        .map_err(|error| entry_error(OpfsErrorKind::Write, "OPFS attempt count open", &error))?;
    let written = write_attempt(&handle);
    let closed = close_sync_handle(&handle);
    let count =
        written.map_err(|error| js_error(OpfsErrorKind::Write, "OPFS attempt count", &error))?;
    closed.map_err(|error| js_error(OpfsErrorKind::Write, "OPFS attempt count close", &error))?;
    Ok(count)
}

fn write_attempt(handle: &FileSystemSyncAccessHandle) -> Result<u8, JsValue> {
    // One byte more than a count holds, so a longer file fails too.
    let (_, slots) = read_prefix(handle, FREE_ATTEMPTS.len() + 1)?;
    let slots = <[u8; FREE_ATTEMPTS.len()]>::try_from(slots.as_slice())
        .map_err(|_| JsValue::from_str("the attempt count is not its eight slots"))?;
    let (count, free) = next_attempt(&slots);
    if let Some(slot) = free.and_then(|slot| u32::try_from(slot).ok()) {
        write_byte_at(handle, ATTEMPT_BYTE, f64::from(slot))?;
    }
    Ok(count)
}

/// Writes `byte` at `offset` in the file behind `handle` and flushes it.
fn write_byte_at(
    handle: &FileSystemSyncAccessHandle,
    byte: u8,
    offset: f64,
) -> Result<(), JsValue> {
    #[cfg(test)]
    if FAIL_ATTEMPT_WRITE.with(|fail| fail.replace(false)) {
        return Err(JsValue::from_str("injected OPFS write failure"));
    }
    let options = FileSystemReadWriteOptions::new();
    options.set_at(offset);
    let written = handle.write_with_u8_array_and_options(&[byte], &options)?;
    if written as usize != 1 {
        return Err(JsValue::from_str("short OPFS write"));
    }
    handle.flush()
}

fn marker_path(paths: &Paths) -> String {
    format!("{}{ADOPTION_MARKER_SUFFIX}", paths.get(FileRole::Main))
}

fn attempts_path(paths: &Paths) -> String {
    format!("{}{ATTEMPTS_SUFFIX}", paths.get(FileRole::Main))
}

/// Removes the marker beside `to`, then tries its attempt count once (see
/// [`remove_count`]). The marker's name is this adapter's own, so whatever
/// sits there goes, a directory included.
async fn remove_marker(
    root: &FileSystemDirectoryHandle,
    to: &Paths,
    deadline: BusyDeadline,
) -> Result<(), OpfsError> {
    remove_if_present(root, &marker_path(to), true, deadline).await?;
    remove_count(root, to).await;
    Ok(())
}

/// Removes the attempt count beside `paths`, whatever sits at its name, as
/// cleanup only: one try, without waiting on a busy entry, so it never
/// spends the busy wait of the step around it, and a failure is ignored. A
/// count left without its marker counts nothing, as
/// [`OpfsOwner::record_attempt`] counts only beside a marker, and the next
/// adoption writes a fresh count before its marker.
async fn remove_count(root: &FileSystemDirectoryHandle, paths: &Paths) {
    let _ = remove_if_present(root, &attempts_path(paths), true, BusyDeadline::passed()).await;
}

/// Records a fresh attempt count, then `marker`, beside `to`, flushing both
/// before any file moves, so a marker never sits beside a count an earlier
/// adoption left.
async fn write_marker(
    root: &FileSystemDirectoryHandle,
    to: &Paths,
    marker: &Marker,
    deadline: BusyDeadline,
) -> Result<(), OpfsError> {
    let bytes = marker
        .encode()
        .ok_or_else(|| OpfsError::new(OpfsErrorKind::Write, "adoption marker is too long"))?;
    write_whole_file(root, &attempts_path(to), &FREE_ATTEMPTS, deadline).await?;
    write_whole_file(root, &marker_path(to), &bytes, deadline).await
}

/// Creates or replaces the file `path` with exactly `bytes`, flushed.
async fn write_whole_file(
    root: &FileSystemDirectoryHandle,
    path: &str,
    bytes: &[u8],
    deadline: BusyDeadline,
) -> Result<(), OpfsError> {
    let (handle, _) = open_sync_handle(root, path, deadline)
        .await
        .map_err(|error| entry_error(OpfsErrorKind::Write, "OPFS adoption file open", &error))?;
    let written = write_whole(&handle, bytes);
    let closed = close_sync_handle(&handle);
    written.map_err(|error| js_error(OpfsErrorKind::Write, "OPFS adoption file write", &error))?;
    closed.map_err(|error| js_error(OpfsErrorKind::Write, "OPFS adoption file close", &error))
}

fn write_whole(handle: &FileSystemSyncAccessHandle, bytes: &[u8]) -> Result<(), JsValue> {
    handle.truncate_with_f64(0.0)?;
    let options = FileSystemReadWriteOptions::new();
    options.set_at(0.0);
    let written = handle.write_with_u8_array_and_options(bytes, &options)?;
    if written as usize != bytes.len() {
        return Err(JsValue::from_str("short OPFS write"));
    }
    handle.flush()
}

/// The marker beside `to`. One that this adapter did not write completely, or
/// that names an identity it could not have adopted, is removed and reads as
/// none: it was cut off before any file moved, or was never a marker.
async fn read_marker(
    root: &FileSystemDirectoryHandle,
    to: &Paths,
    deadline: BusyDeadline,
) -> Result<Option<Marker>, OpfsError> {
    let path = marker_path(to);
    let Some(file) = existing_file(root, &path).await? else {
        return Ok(None);
    };
    let (size, bytes) = file_prefix(&file, MAX_MARKER_BYTES + 1, deadline).await?;
    let marker = (bytes.len() as u64 == size)
        .then(|| Marker::decode(&bytes))
        .flatten()
        .filter(|marker| approved_paths(&marker.previous_identity).is_ok_and(|from| from != *to));
    if marker.is_none() {
        remove_marker(root, to, deadline).await?;
    }
    Ok(marker)
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

    /// Ends the adoption that brought these files to this identity, once
    /// their first open has succeeded: removes the adoption marker, so these
    /// files are this identity's own and nothing returns them to the identity
    /// they came from. Does nothing when no adoption is pending.
    pub async fn finish_adoption(&self) -> Result<(), OpfsError> {
        let root = adoption_root().await?;
        remove_marker(&root, &self.paths, BusyDeadline::start()).await
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
    MainRemoved,
    MarkerRemoved,
    MainRecreated,
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
    write_calls: usize,
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
            // OPFS has no native writev: one browser call per WAL page can
            // dominate COMMIT. Coalesce only this vector, with bounded scratch
            // space; write_all still handles partial writes and sync is unchanged.
            crate::write_batch::write_batches(
                buffers.iter().map(|buffer| buffer.as_slice()),
                |bytes| {
                    let written = write_all(pos, bytes, self.owner, self.session, self.handle)?;
                    total = total
                        .checked_add(written)
                        .ok_or(CompletionError::ShortWrite)?;
                    pos = pos
                        .checked_add(written as u64)
                        .ok_or(CompletionError::ShortWrite)?;
                    Ok(())
                },
            )?;
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
        || database_name.ends_with(ADOPTION_MARKER_SUFFIX)
        || database_name.ends_with(ATTEMPTS_SUFFIX)
        || database_name.contains(['/', '\\', '\0'])
    {
        return Err(OpfsError::new(
            OpfsErrorKind::InvalidName,
            "database identity must be a direct child and must not use the reserved -wal or -adopting suffix",
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

/// Requests the exclusive lock, queueing unless `if_available` is set. With
/// `if_available`, returns `None` without an owner when the lock is taken.
async fn acquire_database_lock(
    database_identity: &str,
    lock_name: &str,
    if_available: bool,
) -> Result<Option<OwnerId>, OpfsError> {
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
    // The Web Locks API rejects an abort signal combined with ifAvailable. An
    // ifAvailable request settles at once, so it needs no cancellation.
    if if_available {
        Reflect::set(
            options.as_ref(),
            &JsValue::from_str("ifAvailable"),
            &JsValue::TRUE,
        )
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock ifAvailable", &error))?;
    } else {
        Reflect::set(
            options.as_ref(),
            &JsValue::from_str("signal"),
            controller.signal().as_ref(),
        )
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock abort signal", &error))?;
    }

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
        if (lock.is_null() || lock.is_undefined()) && if_available {
            // Another context holds or awaits the lock; nothing was claimed.
            let _ = callback_resolve.call1(&JsValue::UNDEFINED, &JsValue::FALSE);
            return Promise::resolve(&JsValue::UNDEFINED);
        }
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

    let granted = JsFuture::from(acquired)
        .await
        .map_err(|error| js_error(OpfsErrorKind::Lock, "Web Lock acquisition", &error))?;
    if granted.as_bool() == Some(false) {
        REGISTRY.with(|registry| registry.borrow_mut().pending_lock = None);
        guard.disarm();
        return Ok(None);
    }

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
    Ok(Some(owner))
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

/// How long one open or removal waits for a predecessor to release the files.
///
/// Chromium can grant the canonical owner Web Lock to a successor before it
/// releases the file lock of a predecessor that is still being torn down, such
/// as a page's cache worker terminated during `pagehide`. Production logs show
/// that gap outlasting two seconds. Every holder of a sync handle on these
/// paths first holds that Web Lock, so while this worker holds it,
/// `NoModificationAllowedError` from an entry operation is a draining
/// predecessor, not evidence about the files. The wait stays well inside the
/// coordinator's 20 second database-open watchdog.
#[cfg(not(test))]
const BUSY_ENTRY_WAIT_MS: f64 = 10_000.0;
#[cfg(test)]
const BUSY_ENTRY_WAIT_MS: f64 = 400.0;
const BUSY_ENTRY_FIRST_DELAY_MS: i32 = 2;
const BUSY_ENTRY_MAX_DELAY_MS: i32 = 512;

/// The end of one operation's busy-entry wait, shared by both paths.
#[derive(Clone, Copy)]
struct BusyDeadline(f64);

impl BusyDeadline {
    fn start() -> Self {
        Self(performance_now() + BUSY_ENTRY_WAIT_MS)
    }

    /// A deadline already past, so a busy entry is tried once.
    fn passed() -> Self {
        Self(f64::NEG_INFINITY)
    }
}

/// Runs an idempotent OPFS entry operation, retrying only a busy entry until
/// `deadline`.
async fn retry_busy_entry(
    deadline: BusyDeadline,
    mut operation: impl FnMut() -> Promise,
) -> Result<JsValue, JsValue> {
    let mut delay = BUSY_ENTRY_FIRST_DELAY_MS;
    loop {
        match JsFuture::from(operation()).await {
            Err(error) if is_entry_busy(&error) => {
                let remaining = deadline.0 - performance_now();
                if remaining <= 0.0 {
                    return Err(error);
                }
                sleep_ms(delay.min(remaining.ceil() as i32)).await?;
                delay = (delay * 2).min(BUSY_ENTRY_MAX_DELAY_MS);
            }
            result => return result,
        }
    }
}

fn is_entry_busy(value: &JsValue) -> bool {
    dom_exception_name(value).as_deref() == Some("NoModificationAllowedError")
}

/// Classifies an entry that stayed busy until its deadline as
/// [`OpfsErrorKind::Busy`], keeping the usual message.
fn entry_error(kind: OpfsErrorKind, operation: &'static str, value: &JsValue) -> OpfsError {
    if is_entry_busy(value) {
        OpfsError::new(
            OpfsErrorKind::Busy,
            format!("{operation} failed (NoModificationAllowedError)"),
        )
    } else {
        js_error(kind, operation, value)
    }
}

async fn sleep_ms(delay: i32) -> Result<(), JsValue> {
    let worker = js_sys::global().dyn_into::<WorkerGlobalScope>()?;
    let mut scheduled = Ok(0);
    let timer = Promise::new(&mut |resolve, _reject| {
        scheduled = worker.set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, delay);
    });
    scheduled?;
    JsFuture::from(timer).await.map(|_| ())
}

async fn open_sync_handle(
    root: &FileSystemDirectoryHandle,
    path: &str,
    deadline: BusyDeadline,
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
    let handle = retry_busy_entry(deadline, || file.create_sync_access_handle())
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
    let deadline = BusyDeadline::start();
    let root = worker_root()
        .await
        .map_err(|error| js_error(OpfsErrorKind::Remove, "OPFS reset root open", &error))?;
    // The files go before the adoption marker: a stop between leaves a marker
    // beside no main file, which the next read removes as stale. Removed
    // first, the marker would leave moved files that may not be at this
    // identity's version reading as its own, to a newer build that moves them
    // and compares their version when it gives them back.
    for role in FileRole::ALL {
        remove_if_present(&root, paths.get(role), recursive, deadline).await?;
        #[cfg(test)]
        if role == FileRole::Main && take_reset_failure(ResetFault::MainRemoved) {
            return Err(OpfsError::new(
                OpfsErrorKind::Remove,
                "injected failure after removing the main path",
            ));
        }
    }
    remove_marker(&root, paths, deadline).await?;
    #[cfg(test)]
    if take_reset_failure(ResetFault::MarkerRemoved) {
        return Err(OpfsError::new(
            OpfsErrorKind::Remove,
            "injected failure after removing the adoption marker",
        ));
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
        if role == FileRole::Main && take_reset_failure(ResetFault::MainRecreated) {
            return Err(OpfsError::new(
                OpfsErrorKind::Recreate,
                "injected failure after recreating the main path",
            ));
        }
    }
    Ok(())
}

/// Removes both approved paths, attempting each even if the other fails,
/// then, once both are gone, any adoption marker beside them, and tries the
/// attempt count once. The files go first, as in [`reset_paths`]: a file
/// that stays keeps its marker, so moved files whose first open never
/// succeeded never read as this identity's own to a later adoption.
async fn remove_paths(paths: &Paths) -> Result<(), OpfsError> {
    let deadline = BusyDeadline::start();
    let root = worker_root()
        .await
        .map_err(|error| js_error(OpfsErrorKind::Remove, "OPFS remove root open", &error))?;
    let mut first_error = None;
    for role in FileRole::ALL {
        if let Err(error) = remove_if_present(&root, paths.get(role), true, deadline).await {
            first_error.get_or_insert(error);
        }
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    remove_marker(&root, paths, deadline).await
}

async fn remove_if_present(
    root: &FileSystemDirectoryHandle,
    path: &str,
    recursive: bool,
    deadline: BusyDeadline,
) -> Result<(), OpfsError> {
    let options = FileSystemRemoveOptions::new();
    options.set_recursive(recursive);
    match retry_busy_entry(deadline, || root.remove_entry_with_options(path, &options)).await {
        Ok(_) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(error) => Err(entry_error(
            OpfsErrorKind::Remove,
            "OPFS path remove",
            &error,
        )),
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
        registry.faults.write_calls += 1;
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
