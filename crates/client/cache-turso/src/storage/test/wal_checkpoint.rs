use super::*;
use crate::driver::{CheckpointFault, arm_checkpoint_failure};

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

fn write(storage: &mut TursoStorage, write: usize) -> Result<(), TursoStorageError> {
    block_on(
        storage.put_batch(
            (0..50)
                .map(|index| {
                    (
                        key(&format!("Document:{index}")),
                        record(&incompressible(write, index)),
                    )
                })
                .collect(),
        ),
    )
}

fn deferred(directory: &tempfile::TempDir) -> TursoStorage {
    let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
    let storage = database.open("scope").unwrap();
    storage.defer_checkpoints();
    storage
}

const UNCERTAIN: TursoStorageError =
    TursoStorageError::reset(PhysicalResetReason::TransactionOutcomeUncertain);

fn assert_fenced(mut storage: TursoStorage) {
    assert_eq!(write(&mut storage, usize::MAX), Err(UNCERTAIN));
    assert_eq!(storage.checkpoint_if_due(), Err(UNCERTAIN));
    assert!(matches!(
        storage.try_close(),
        Ok(TursoStorageCloseOutcome::ResetRequired(
            PhysicalResetReason::TransactionOutcomeUncertain
        ))
    ));
}

#[test]
fn a_failed_idle_checkpoint_fences_the_storage() {
    let directory = tempfile::tempdir().unwrap();
    let mut storage = deferred(&directory);
    for writes in 0..60 {
        write(&mut storage, writes).unwrap();
    }
    arm_checkpoint_failure(CheckpointFault::Fail);
    assert_eq!(storage.checkpoint_if_due(), Err(UNCERTAIN));
    assert_fenced(storage);
}

#[test]
fn a_failed_ceiling_checkpoint_fails_the_write_and_fences_the_storage() {
    let directory = tempfile::tempdir().unwrap();
    let mut storage = deferred(&directory);
    arm_checkpoint_failure(CheckpointFault::Fail);
    let failed = (0..400).find(|&writes| write(&mut storage, writes).is_err());
    assert!(failed.is_some_and(|writes| writes >= 120), "{failed:?}");
    assert_fenced(storage);
}

#[test]
fn a_failed_close_checkpoint_reports_a_reset() {
    let directory = tempfile::tempdir().unwrap();
    let mut storage = deferred(&directory);
    write(&mut storage, 0).unwrap();
    arm_checkpoint_failure(CheckpointFault::Fail);
    assert!(matches!(
        storage.try_close(),
        Ok(TursoStorageCloseOutcome::ResetRequired(
            PhysicalResetReason::TransactionOutcomeUncertain
        ))
    ));
}
