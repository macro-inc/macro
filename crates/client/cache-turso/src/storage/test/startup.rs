use super::*;

#[test]
fn reopen_skips_full_integrity_scan_and_preserves_pending_writes() {
    block_on(async {
        let database = TursoMemoryDatabase::new("startup-without-full-scan.db");
        let mut storage = database.open("scope").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("persisted"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        storage.try_close().unwrap();

        // Reopening must not execute quick_check. The existing driver fault
        // stays armed until the explicitly requested diagnostic below.
        driver::arm_reset_failure("PRAGMA quick_check");
        let storage = database.open("scope").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![Some(record("persisted"))]
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        expect_reset_reason(
            storage.check_integrity(),
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        expect_reset_reason(
            storage.get_batch(&[key("Thing:1")]).await,
            PhysicalResetReason::TransactionOutcomeUncertain,
        );
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::ResetRequired(
                PhysicalResetReason::TransactionOutcomeUncertain
            )
        );
    });
}

#[test]
fn explicit_integrity_check_preserves_records_and_pending_writes() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("explicit-integrity").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("persisted"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();

        storage.check_integrity().unwrap();

        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![Some(record("persisted"))]
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}
