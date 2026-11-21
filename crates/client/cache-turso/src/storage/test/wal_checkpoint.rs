//! The idle checkpoint under real I/O failures: whatever fails, every
//! committed write survives a crash or a close and the next open.
//!
//! `MemoryIO` keeps every write whether or not it was synced, so these tests
//! cannot lose an unsynced page themselves. They check what decides it in a
//! real file: after a failed checkpoint, Turso never starts the log over the
//! frames it could not sync into the database file.

use super::*;

/// About 3 KB of hex, distinct per write: some 27 WAL frames per write of 50.
fn incompressible(write: usize, index: usize) -> String {
    let mut state = ((write as u64) << 32) | index as u64 | 1;
    (0..375)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            format!("{:08x}", (state >> 32) as u32)
        })
        .collect()
}

const RECORDS: usize = 50;
/// Writes that take the WAL past the 500-frame due mark and stay below
/// Turso's own 1,000.
const DUE_WRITES: usize = 22;
/// Written once before every other write and never again, so a lost early
/// frame shows even when later writes rewrite the other records.
const SENTINEL: &str = "Sentinel:0";
/// The write after the checkpoint.
const AFTER: usize = 1_000;

fn keys() -> Vec<EntityKey<'static>> {
    (0..RECORDS)
        .map(|index| key(&format!("Document:{index}")))
        .collect()
}

fn write(storage: &mut TursoStorage, write: usize) -> Result<(), TursoStorageError> {
    block_on(
        storage.put_batch(
            keys()
                .into_iter()
                .enumerate()
                .map(|(index, key)| (key, record(&incompressible(write, index))))
                .collect(),
        ),
    )
}

fn sentinel() -> Record {
    record(&incompressible(usize::MAX, 0))
}

/// The sentinel and every record of write `write` read back.
fn assert_holds(storage: &TursoStorage, write: usize) {
    assert_eq!(
        block_on(storage.get_batch(&[key(SENTINEL)])).unwrap(),
        vec![Some(sentinel())]
    );
    let expected: Vec<_> = (0..RECORDS)
        .map(|index| Some(record(&incompressible(write, index))))
        .collect();
    assert_eq!(block_on(storage.get_batch(&keys())).unwrap(), expected);
}

fn open(io: &Arc<FaultIo>, path: &str, fresh: bool) -> TursoStorage {
    let io: Arc<dyn IO> = io.clone();
    open_native_database(io, path, "scope", fresh).unwrap().0
}

fn wal_frames(storage: &TursoStorage) -> u64 {
    storage
        .connection
        .checkpoint_over(u64::MAX)
        .unwrap()
        .wal_frames
}

/// A fresh database whose WAL is due for an idle checkpoint, with no
/// checkpoint yet, not even Turso's own.
fn due(io: &Arc<FaultIo>, path: &str) -> TursoStorage {
    let mut storage = open(io, path, true);
    block_on(storage.put_batch(vec![(key(SENTINEL), sentinel())])).unwrap();
    let mut previous = 0;
    for writes in 0..DUE_WRITES {
        write(&mut storage, writes).unwrap();
        let frames = wal_frames(&storage);
        assert!(
            frames > previous,
            "a commit checkpointed at {previous} frames"
        );
        previous = frames;
    }
    assert!(
        previous >= driver::CHECKPOINT_DUE_FRAMES,
        "{previous} frames"
    );
    storage
}

#[derive(Clone, Copy, Debug)]
enum End {
    /// Two more writes, then the process dies without closing.
    WriteAndCrash,
    /// A clean close with no write after the failure.
    Close,
}

/// Ends the session as `end` says, reopens, and checks every write since.
fn end_and_reopen(
    io: &Arc<FaultIo>,
    path: &str,
    mut storage: TursoStorage,
    last_written: usize,
    end: End,
) {
    let last = match end {
        End::WriteAndCrash => {
            write(&mut storage, DUE_WRITES).unwrap();
            write(&mut storage, DUE_WRITES + 1).unwrap();
            drop(storage);
            DUE_WRITES + 1
        }
        End::Close => {
            assert_eq!(
                storage.try_close().unwrap(),
                TursoStorageCloseOutcome::Healthy
            );
            last_written
        }
    };
    let mut reopened = open(io, path, false);
    assert_holds(&reopened, last);
    // The reopened WAL takes writes and checkpoints normally.
    write(&mut reopened, last + 1).unwrap();
    reopened.checkpoint_if_due().unwrap();
    assert_eq!(
        reopened.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    assert_holds(&open(io, path, false), last + 1);
}

#[test]
fn a_checkpoint_that_fails_to_sync_keeps_the_log() {
    // The WAL sync fails before any page is copied; the database sync fails
    // after every page is copied but before Turso records them as copied.
    for (fault, end) in [IoFault::Sync, IoFault::DatabaseSync]
        .into_iter()
        .flat_map(|fault| [End::WriteAndCrash, End::Close].map(|end| (fault, end)))
    {
        let io = FaultIo::new();
        let path = format!("checkpoint-sync-{fault:?}-{end:?}.db");
        let mut storage = due(&io, &path);
        let before = wal_frames(&storage);
        io.arm(fault);
        assert_eq!(
            storage.checkpoint_if_due(),
            Err(TursoStorageError::Database)
        );
        assert!(io.is_clear(), "the checkpoint never hit {fault:?}");

        // The next write appends: Turso did not start the log over frames
        // that may be missing from the database file.
        write(&mut storage, AFTER).unwrap();
        assert!(wal_frames(&storage) > before);
        end_and_reopen(&io, &path, storage, AFTER, end);
    }
}

#[test]
fn a_checkpoint_lets_the_next_write_start_the_log_over() {
    for end in [End::WriteAndCrash, End::Close] {
        let io = FaultIo::new();
        let path = format!("checkpoint-restart-{end:?}.db");
        let mut storage = due(&io, &path);
        let before = wal_frames(&storage);
        let checkpoint = storage.checkpoint_if_due().unwrap();
        assert!(checkpoint.ran, "{checkpoint:?}");
        assert_eq!(checkpoint.wal_frames, before);
        assert_eq!(checkpoint.backfilled_frames, before);

        write(&mut storage, AFTER).unwrap();
        assert!(wal_frames(&storage) < before / 4);
        end_and_reopen(&io, &path, storage, AFTER, end);
    }
}

#[test]
fn checkpoint_failures_never_fence_the_storage() {
    let io = FaultIo::new();
    let mut storage = due(&io, "checkpoint-no-fence.db");
    io.arm(IoFault::DatabaseSync);
    assert_eq!(
        storage.checkpoint_if_due(),
        Err(TursoStorageError::Database)
    );
    write(&mut storage, DUE_WRITES).unwrap();
    let retried = storage.checkpoint_if_due().unwrap();
    assert!(retried.ran, "{retried:?}");
    assert_eq!(retried.backfilled_frames, retried.wal_frames, "{retried:?}");
    assert_holds(&storage, DUE_WRITES);
    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
}

#[test]
fn a_due_wal_with_nothing_new_to_copy_keeps_the_page_cache() {
    let io = FaultIo::new();
    let storage = due(&io, "checkpoint-page-cache.db");
    let last = DUE_WRITES - 1;
    let checkpoint = storage.checkpoint_if_due().unwrap();
    assert!(checkpoint.ran, "{checkpoint:?}");
    // Any checkpoint changes the WAL's state, and Turso drops a connection's
    // cached pages when it next reads, as after its own checkpoint in COMMIT.
    assert_holds(&storage, last);
    let warm = io.reads();
    assert_holds(&storage, last);
    assert_eq!(
        io.reads(),
        warm,
        "a second read is served from the page cache"
    );

    // Until the next write the WAL stays due with nothing to copy; the call
    // skips it rather than run a checkpoint that drops the cached pages.
    let again = storage.checkpoint_if_due().unwrap();
    assert_eq!(
        again,
        WalCheckpoint {
            ran: false,
            wal_frames: checkpoint.wal_frames,
            backfilled_frames: 0
        }
    );
    let before = io.reads();
    assert_holds(&storage, last);
    assert_eq!(io.reads(), before, "the idle call dropped cached pages");
}
