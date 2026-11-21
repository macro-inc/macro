//! Deferred checkpoints under real I/O failures: whatever fails, every
//! committed write survives a crash or a close and the next open.

use super::*;
use crate::driver::{CheckpointFault, arm_before_truncate, arm_checkpoint_failure};

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
/// Writes that take the WAL past the 1,000-frame due threshold.
const DUE_WRITES: usize = 60;

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

/// Every record holds what write `write` stored.
fn assert_holds(storage: &TursoStorage, write: usize) {
    let expected: Vec<_> = (0..RECORDS)
        .map(|index| Some(record(&incompressible(write, index))))
        .collect();
    assert_eq!(block_on(storage.get_batch(&keys())).unwrap(), expected);
}

fn open(io: &Arc<FaultIo>, path: &str, fresh: bool) -> TursoStorage {
    let io: Arc<dyn IO> = io.clone();
    let (storage, _) = open_native_database(io, path, "scope", fresh).unwrap();
    storage.defer_checkpoints();
    storage
}

fn due(io: &Arc<FaultIo>, path: &str) -> TursoStorage {
    let mut storage = open(io, path, true);
    for writes in 0..DUE_WRITES {
        write(&mut storage, writes).unwrap();
    }
    storage
}

#[derive(Clone, Copy, Debug)]
enum End {
    /// Two more writes, then the process dies without closing.
    WriteAndCrash,
    /// A clean close with no write after the failure.
    Close,
}

/// Ends the session as `end` says, reopens, and checks the last write.
fn end_and_reopen(io: &Arc<FaultIo>, path: &str, mut storage: TursoStorage, end: End) {
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
            DUE_WRITES - 1
        }
    };
    let mut reopened = open(io, path, false);
    assert_holds(&reopened, last);
    // The reopened WAL takes writes and checkpoints normally.
    write(&mut reopened, last + 1).unwrap();
    let checkpoint = reopened.checkpoint_if_due().unwrap();
    assert!(!checkpoint.ran || checkpoint.truncated, "{checkpoint:?}");
    assert_eq!(
        reopened.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    assert_holds(&open(io, path, false), last + 1);
}

#[test]
fn a_copy_that_fails_to_sync_leaves_every_write_in_the_wal() {
    for end in [End::WriteAndCrash, End::Close] {
        let io = FaultIo::new();
        let path = format!("checkpoint-copy-sync-{end:?}.db");
        let storage = due(&io, &path);
        let before = storage
            .connection
            .checkpoint_over(u64::MAX)
            .unwrap()
            .wal_frames;
        io.arm(IoFault::Sync);
        assert_eq!(
            storage.checkpoint_if_due(),
            Err(TursoStorageError::Database)
        );
        assert!(io.is_clear(), "the copy never synced");
        // The log was never restarted: the WAL still holds every frame.
        let after = storage
            .connection
            .checkpoint_over(u64::MAX)
            .unwrap()
            .wal_frames;
        assert_eq!(after, before);
        end_and_reopen(&io, &path, storage, end);
    }
}

#[test]
fn a_truncation_that_fails_after_the_log_restarts_loses_nothing() {
    for fault in [IoFault::Truncate, IoFault::Sync] {
        for end in [End::WriteAndCrash, End::Close] {
            let io = FaultIo::new();
            let path = format!("checkpoint-truncate-{fault:?}-{end:?}.db");
            let storage = due(&io, &path);
            let armed = io.clone();
            arm_before_truncate(move || armed.arm(fault));
            let checkpoint = storage.checkpoint_if_due().unwrap();
            assert!(
                io.is_clear(),
                "the truncating checkpoint never hit the fault"
            );
            assert!(checkpoint.ran && !checkpoint.truncated, "{checkpoint:?}");
            assert_eq!(checkpoint.backfilled_frames, checkpoint.wal_frames);
            // Turso had already restarted the log when the I/O failed.
            let frames = storage
                .connection
                .checkpoint_over(u64::MAX)
                .unwrap()
                .wal_frames;
            assert_eq!(frames, 0, "{fault:?} failed before the log restarted");
            end_and_reopen(&io, &path, storage, end);
        }
    }
}

#[test]
fn checkpoint_failures_never_fence_the_storage() {
    let io = FaultIo::new();
    let mut storage = due(&io, "checkpoint-no-fence.db");
    arm_checkpoint_failure(CheckpointFault::FailCopy);
    assert_eq!(
        storage.checkpoint_if_due(),
        Err(TursoStorageError::Database)
    );
    write(&mut storage, DUE_WRITES).unwrap();
    let retried = storage.checkpoint_if_due().unwrap();
    assert!(retried.ran && retried.truncated, "{retried:?}");
    assert_holds(&storage, DUE_WRITES);
    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
}
