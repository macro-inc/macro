#![cfg(not(target_arch = "wasm32"))]

//! The idle WAL checkpoint (`TursoStorage::checkpoint_if_due`).

use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoFileDatabase, TursoStorage, TursoStorageCloseOutcome};
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

fn assert_reads(storage: &TursoStorage, write: usize) {
    let keys: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| record(write, index).0)
        .collect();
    let expected: Vec<_> = (0..RECORDS_PER_WRITE)
        .map(|index| Some(record(write, index).1))
        .collect();
    assert_eq!(block_on(storage.get_batch(&keys)).unwrap(), expected);
}

#[test]
fn the_idle_call_copies_the_wal_before_a_commit_would() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();

    // Some 27 frames a write: not due until about the 19th.
    let mut writes = 0;
    let checkpoint = loop {
        write(&mut storage, writes);
        writes += 1;
        let checkpoint = storage.checkpoint_if_due().unwrap();
        if checkpoint.ran {
            break checkpoint;
        }
        assert!(checkpoint.wal_frames < 500, "{checkpoint:?}");
        assert!(writes < 40, "never due");
    };
    // Every frame was left to this call: no COMMIT copied any of them.
    assert!(checkpoint.wal_frames >= 500, "{checkpoint:?}");
    assert_eq!(checkpoint.backfilled_frames, checkpoint.wal_frames);
    assert_eq!(wal_frames(&path), checkpoint.wal_frames);

    // The next write starts the log over.
    write(&mut storage, writes);
    let after = storage.checkpoint_if_due().unwrap();
    assert!(!after.ran && after.wal_frames < 100, "{after:?}");
    assert!(wal_frames(&path) < 100);

    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
    assert_eq!(wal_frames(&path), 0, "close still checkpoints");
    let storage = database.open("scope").unwrap();
    assert_reads(&storage, writes);
    storage.try_close().unwrap();
}

#[test]
fn a_host_that_idles_between_writes_never_checkpoints_in_a_commit() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();

    let mut checkpoints = 0;
    let mut largest = 0;
    for writes in 0..200 {
        write(&mut storage, writes);
        largest = largest.max(wal_frames(&path));
        let checkpoint = storage.checkpoint_if_due().unwrap();
        if checkpoint.ran {
            checkpoints += 1;
            // A COMMIT that had checkpointed would leave less to copy.
            assert_eq!(
                checkpoint.backfilled_frames, checkpoint.wal_frames,
                "{checkpoint:?}"
            );
        }
    }
    assert!(checkpoints >= 8, "{checkpoints} checkpoints");
    assert!(
        largest < 500 + 2 * RECORDS_PER_WRITE as u64,
        "the WAL grew to {largest} frames"
    );
    assert_reads(&storage, 199);
    storage.try_close().unwrap();
}

#[test]
fn without_idle_calls_turso_still_checkpoints_inside_commits() {
    let directory = tempfile::tempdir().unwrap();
    let (database, path) = open(&directory);
    let mut storage = database.open("scope").unwrap();

    let mut largest = 0;
    for writes in 0..60 {
        write(&mut storage, writes);
        largest = largest.max(wal_frames(&path));
    }
    // The COMMIT past 1,000 frames checkpoints and the next write starts the
    // log over, so the file never grows far past that.
    assert!(largest >= 1_000, "{largest}");
    assert!(largest < 1_000 + 2 * RECORDS_PER_WRITE as u64, "{largest}");
    assert_reads(&storage, 59);
    storage.try_close().unwrap();
}
