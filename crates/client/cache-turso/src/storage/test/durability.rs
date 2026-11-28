//! A connection whose COMMIT does not flush, as the browser's
//! (`synchronous = NORMAL`): a queue write is on disk when it returns, a
//! cache write may be lost to a power loss, and a power loss leaves the
//! database as of an earlier commit, never a broken one.
//!
//! `PowerIo` keeps a file's writes only once the file is synced, and a
//! power loss drops the rest. The WAL flush the browser makes through its
//! OPFS handle is a sync of the WAL file here.

use super::*;
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;

struct PowerFile {
    live: Mutex<Vec<u8>>,
    /// What a power loss leaves: the file as of its last sync.
    durable: Mutex<Vec<u8>>,
}

impl PowerFile {
    fn sync_now(&self) {
        *self.durable.lock().unwrap() = self.live.lock().unwrap().clone();
    }
}

impl File for PowerFile {
    fn lock_file(&self, _exclusive: bool) -> turso_core::Result<()> {
        Ok(())
    }

    fn unlock_file(&self) -> turso_core::Result<()> {
        Ok(())
    }

    fn pread(&self, pos: u64, completion: Completion) -> turso_core::Result<Completion> {
        let live = self.live.lock().unwrap();
        let buffer = completion.as_read().buf();
        let start = (pos as usize).min(live.len());
        let read = buffer.len().min(live.len() - start);
        buffer.as_mut_slice()[..read].copy_from_slice(&live[start..start + read]);
        drop(live);
        completion.complete(read as i32);
        Ok(completion)
    }

    fn pwrite(
        &self,
        pos: u64,
        buffer: Arc<Buffer>,
        completion: Completion,
    ) -> turso_core::Result<Completion> {
        let bytes = buffer.as_slice();
        let mut live = self.live.lock().unwrap();
        let end = pos as usize + bytes.len();
        if live.len() < end {
            live.resize(end, 0);
        }
        live[pos as usize..end].copy_from_slice(bytes);
        drop(live);
        completion.complete(bytes.len() as i32);
        Ok(completion)
    }

    fn sync(
        &self,
        completion: Completion,
        _sync_type: FileSyncType,
    ) -> turso_core::Result<Completion> {
        self.sync_now();
        completion.complete(0);
        Ok(completion)
    }

    fn size(&self) -> turso_core::Result<u64> {
        Ok(self.live.lock().unwrap().len() as u64)
    }

    fn truncate(&self, len: u64, completion: Completion) -> turso_core::Result<Completion> {
        self.live.lock().unwrap().resize(len as usize, 0);
        completion.complete(0);
        Ok(completion)
    }

    fn has_hole(&self, _pos: usize, _len: usize) -> turso_core::Result<bool> {
        Ok(false)
    }

    fn punch_hole(&self, _pos: usize, _len: usize) -> turso_core::Result<()> {
        Ok(())
    }
}

/// The files of one database, named `path`. Turso shares a database among
/// the opens of one path in a process, so each test and each power loss
/// takes a path of its own.
struct PowerIo {
    path: String,
    clock: MemoryIO,
    files: Mutex<HashMap<String, Arc<PowerFile>>>,
}

impl PowerIo {
    fn new(path: &str) -> Arc<Self> {
        Arc::new(Self {
            path: path.to_owned(),
            clock: MemoryIO::new(),
            files: Mutex::default(),
        })
    }

    fn wal(&self) -> Arc<PowerFile> {
        self.file(&format!("{}-wal", self.path))
    }

    fn file(&self, path: &str) -> Arc<PowerFile> {
        self.files.lock().unwrap()[path].clone()
    }

    /// The files as the disk holds them after the power comes back, under a
    /// new path.
    fn after_power_loss(&self) -> Arc<Self> {
        let path = format!("after-{}", self.path);
        let files = self
            .files
            .lock()
            .unwrap()
            .iter()
            .map(|(name, file)| {
                let durable = file.durable.lock().unwrap().clone();
                (
                    format!("after-{name}"),
                    Arc::new(PowerFile {
                        live: Mutex::new(durable.clone()),
                        durable: Mutex::new(durable),
                    }),
                )
            })
            .collect();
        Arc::new(Self {
            path,
            clock: MemoryIO::new(),
            files: Mutex::new(files),
        })
    }
}

impl Clock for PowerIo {
    fn current_time_monotonic(&self) -> MonotonicInstant {
        self.clock.current_time_monotonic()
    }

    fn current_time_wall_clock(&self) -> WallClockInstant {
        self.clock.current_time_wall_clock()
    }
}

impl IO for PowerIo {
    fn open_file(
        &self,
        path: &str,
        flags: OpenFlags,
        _direct: bool,
    ) -> turso_core::Result<Arc<dyn File>> {
        let mut files = self.files.lock().unwrap();
        if let Some(file) = files.get(path) {
            return Ok(file.clone());
        }
        if !flags.contains(OpenFlags::Create) {
            return Err(CompletionError::IOError(std::io::ErrorKind::NotFound, "open").into());
        }
        let file = Arc::new(PowerFile {
            live: Mutex::new(Vec::new()),
            durable: Mutex::new(Vec::new()),
        });
        files.insert(path.to_owned(), file.clone());
        Ok(file)
    }

    fn remove_file(&self, path: &str) -> turso_core::Result<()> {
        self.files.lock().unwrap().remove(path);
        Ok(())
    }

    fn file_id(&self, path: &str) -> turso_core::Result<FileId> {
        Ok(FileId::from_path_hash(path))
    }

    fn supports_shared_wal_coordination(&self) -> bool {
        false
    }
}

/// The browser's connection on `io`: NORMAL COMMITs, checkpoints of its own,
/// and a WAL flush that counts its calls.
fn open_browser_like(io: &Arc<PowerIo>, fresh: bool) -> (TursoStorage, Arc<AtomicUsize>) {
    let dyn_io: Arc<dyn IO> = io.clone();
    let mut storage = open_native_database(dyn_io, &io.path, "scope", fresh)
        .unwrap()
        .0;
    storage.connection.disable_turso_checkpoints();
    storage
        .connection
        .set_sync_mode(turso_core::SyncMode::Normal);
    let flushes = Arc::new(AtomicUsize::new(0));
    let wal = io.wal();
    let counted = flushes.clone();
    storage.set_wal_flush(Arc::new(move || {
        counted.fetch_add(1, Ordering::SeqCst);
        wal.sync_now();
        Ok(())
    }));
    (storage, flushes)
}

fn cache_write(storage: &mut TursoStorage, name: &str, value: &str) {
    block_on(storage.put_batch(vec![(key(name), record(value))])).unwrap();
}

fn read(storage: &TursoStorage, name: &str) -> Option<Record> {
    block_on(storage.get_batch(&[key(name)])).unwrap().remove(0)
}

fn claim_request(now_ms: i64) -> MutationClaimRequest {
    MutationClaimRequest {
        owner: "runner".into(),
        now_ms,
        lease_expires_at_ms: now_ms + 30_000,
    }
}

#[test]
fn only_queue_writes_flush_and_a_power_loss_keeps_them_and_a_prefix_of_the_rest() {
    let io = PowerIo::new("durability-prefix.db");
    let (mut storage, flushes) = open_browser_like(&io, true);
    let wal = io.wal();
    let synced = || wal.durable.lock().unwrap().len();
    let opened = flushes.load(Ordering::SeqCst);

    // A cache write commits without a flush.
    let synced_before = synced();
    cache_write(&mut storage, "Document:before", "before");
    assert_eq!(flushes.load(Ordering::SeqCst), opened);
    assert_eq!(synced(), synced_before, "a cache COMMIT synced the WAL");

    // The enqueue and its claim are one transaction and one flush, which
    // also makes the cache write before them durable.
    let (upsert, claimed) = block_on(storage.upsert_mutation_and_claim(
        queued("Queued"),
        1,
        OptimisticUpsertReconciliation::default(),
        claim_request(1),
    ))
    .unwrap();
    let claimed = claimed.unwrap().expect("the new head is runnable");
    assert_eq!(claimed.queued.id, upsert.id);
    assert_eq!(flushes.load(Ordering::SeqCst), opened + 1);

    // A settlement flushes once more; a read and a cache write do not.
    let token = MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    };
    assert!(block_on(storage.defer_mutation(upsert.id, token, 5, "retry".into(), false)).unwrap());
    assert_eq!(flushes.load(Ordering::SeqCst), opened + 2);
    assert!(read(&storage, "Document:before").is_some());
    cache_write(&mut storage, "Document:after", "after");
    assert_eq!(flushes.load(Ordering::SeqCst), opened + 2);

    // The power goes: the deferred mutation and the cache write before it
    // are there, the unflushed cache write after it is not, and the file
    // opens as a whole database.
    drop(storage);
    let io = io.after_power_loss();
    let (storage, _) = open_browser_like(&io, false);
    let queue = block_on(storage.load_mutation_queue()).unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, upsert.id);
    assert_eq!(queue[0].mutation.next_attempt_at_ms, Some(5));
    assert_eq!(queue[0].mutation.lease_owner, None);
    assert_eq!(read(&storage, "Document:before"), Some(record("before")));
    assert_eq!(read(&storage, "Document:after"), None);
    storage.check_integrity().unwrap();
}

#[test]
fn a_claim_that_fails_with_its_upsert_leaves_the_upsert_durable() {
    let io = PowerIo::new("durability-claim.db");
    let (mut storage, flushes) = open_browser_like(&io, true);
    let opened = flushes.load(Ordering::SeqCst);
    storage.arm_fault(TestFault::After {
        site: TestFaultSite::Claim,
        index: 0,
    });
    let (upsert, claimed) = block_on(storage.upsert_mutation_and_claim(
        queued("Queued"),
        1,
        OptimisticUpsertReconciliation::default(),
        claim_request(1),
    ))
    .unwrap();
    assert!(matches!(claimed, Err(TursoStorageError::Database)));
    // The rolled-back transaction flushed nothing; the upsert alone did.
    assert_eq!(flushes.load(Ordering::SeqCst), opened + 1);

    drop(storage);
    let io = io.after_power_loss();
    let (storage, _) = open_browser_like(&io, false);
    let queue = block_on(storage.load_mutation_queue()).unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, upsert.id);
    assert_eq!(queue[0].mutation.lease_owner, None);
}

#[test]
fn a_failed_flush_makes_the_queue_write_s_outcome_uncertain() {
    let io = PowerIo::new("durability-flush-error.db");
    let dyn_io: Arc<dyn IO> = io.clone();
    let mut storage = open_native_database(dyn_io, &io.path, "scope", true)
        .unwrap()
        .0;
    storage.connection.disable_turso_checkpoints();
    storage
        .connection
        .set_sync_mode(turso_core::SyncMode::Normal);
    storage.set_wal_flush(Arc::new(|| Err(())));
    let error = block_on(storage.enqueue_mutation(queued("Queued"))).unwrap_err();
    assert!(matches!(
        error,
        TursoStorageError::PhysicalResetRequired(PhysicalResetReason::TransactionOutcomeUncertain)
    ));
    // The storage latched the reset.
    assert!(block_on(storage.load_mutation_queue()).is_err());
}
