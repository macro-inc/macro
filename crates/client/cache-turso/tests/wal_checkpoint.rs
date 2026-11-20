#![cfg(not(target_arch = "wasm32"))]

//! Moving the WAL checkpoint out of COMMIT (`TursoStorage::defer_checkpoints`).

use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoFileDatabase, TursoStorage, TursoStorageCloseOutcome, WalCheckpoint};
use pollster::block_on;
use std::path::{Path, PathBuf};

/// A WAL frame: its 24-byte header and one 4 KB page.
const FRAME_BYTES: u64 = 24 + 4096;
/// Records per write; each value fills most of a page, so a write appends
/// about this many frames.
const RECORDS_PER_WRITE: usize = 50;

/// About 3 KB that payload compression cannot shrink, distinct per write.
fn incompressible(write: usize, index: usize) -> String {
    let mut state = (write as u64) << 32 | index as u64 | 1;
    (0..375)
        .map(|_| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            format!("{:08x}", (state >> 32) as u32)
        })
        .collect()
}

fn record(write: usize, index: usize) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    record.fields.insert(
        "value".into(),
        CacheValue::String(incompressible(write, index)),
    );
    (EntityKey(format!("Document:{index}").into()), record)
}

fn write(storage: &mut TursoStorage, write: usize) {
    block_on(
        storage.put_batch(
            (0..RECORDS_PER_WRITE)
                .map(|index| record(write, index))
                .collect(),
        ),
    )
    .unwrap();
}

fn wal_frames(database_path: &Path) -> u64 {
    let mut wal = database_path.as_os_str().to_owned();
    wal.push("-wal");
    std::fs::metadata(PathBuf::from(wal)).map_or(0, |metadata| metadata.len() / FRAME_BYTES)
}

fn open(directory: &tempfile::TempDir) -> (TursoFileDatabase, PathBuf) {
    let path = directory.path().join("cache.turso");
    (TursoFileDatabase::new(&path).unwrap(), path)
}

#[test]
fn deferred_commits_leave_the_checkpoint_to_the_idle_call() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();
    storage.defer_checkpoints();

    // Past Turso's 1,000-frame threshold, a COMMIT would have checkpointed
    // and the next write restarted the WAL; deferred, the WAL keeps growing.
    // Some 26 frames a write: 60 writes pass 1,500 frames.
    let mut writes = 0;
    while writes < 60 {
        write(&mut storage, writes);
        writes += 1;
    }
    let before = wal_frames(&path);
    assert!(before >= 1_500, "the WAL holds {before} frames");

    let checkpoint = storage.checkpoint_if_due().unwrap();
    assert!(checkpoint.ran && checkpoint.truncated, "{checkpoint:?}");
    assert_eq!(checkpoint.wal_frames, before, "{checkpoint:?}");
    // Every frame was left to this call: no COMMIT backfilled any of them.
    assert_eq!(checkpoint.backfilled_frames, before, "{checkpoint:?}");
    assert_eq!(wal_frames(&path), 0, "the checkpoint truncates the WAL");

    // Nothing left to do, and writes after a truncation start a new WAL.
    assert_eq!(
        storage.checkpoint_if_due().unwrap(),
        WalCheckpoint {
            ran: false,
            truncated: false,
            wal_frames: 0,
            backfilled_frames: 0
        }
    );
    write(&mut storage, writes);
    assert!(wal_frames(&path) > 0);
    let below = storage.checkpoint_if_due().unwrap();
    assert!(!below.ran && below.wal_frames > 0, "{below:?}");

    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    assert_eq!(wal_frames(&path), 0, "close still checkpoints");

    let storage = database.open("scope").unwrap();
    let keys: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| record(writes, index).0)
        .collect();
    let expected: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| Some(record(writes, index).1))
        .collect();
    assert_eq!(block_on(storage.get_batch(&keys)).unwrap(), expected);
    storage.try_close().unwrap();
}

#[test]
fn a_host_that_never_idles_still_bounds_the_wal() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();
    storage.defer_checkpoints();

    let mut largest = 0;
    let mut truncations = 0;
    let mut previous = 0;
    for writes in 0..200 {
        write(&mut storage, writes);
        let frames = wal_frames(&path);
        if frames < previous {
            truncations += 1;
        }
        largest = largest.max(frames);
        previous = frames;
    }
    assert!(truncations >= 1, "the ceiling never checkpointed");
    assert!(
        largest < 4_000 + 2 * RECORDS_PER_WRITE as u64,
        "the WAL grew to {largest} frames"
    );
    assert!(
        largest >= 3_900,
        "commits checkpointed early, at {largest} frames"
    );

    let keys: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| record(199, index).0)
        .collect();
    let expected: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| Some(record(199, index).1))
        .collect();
    assert_eq!(block_on(storage.get_batch(&keys)).unwrap(), expected);
    storage.try_close().unwrap();
}

#[test]
fn without_deferral_turso_checkpoints_inside_commits() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();

    let mut largest = 0;
    for writes in 0..60 {
        write(&mut storage, writes);
        largest = largest.max(wal_frames(&path));
    }
    // The WAL file is restarted in place, not truncated, so its length stays
    // near Turso's threshold rather than growing with every write.
    assert!(largest < 1_000 + 2 * RECORDS_PER_WRITE as u64, "{largest}");
    let checkpoint = storage.checkpoint_if_due().unwrap();
    assert!(
        checkpoint.wal_frames < 1_000 + 2 * RECORDS_PER_WRITE as u64,
        "{checkpoint:?}"
    );
    storage.try_close().unwrap();
}
