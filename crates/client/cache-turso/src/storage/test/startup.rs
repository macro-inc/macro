use super::*;

#[test]
fn native_file_storage_keeps_temporary_tables_in_memory_and_a_larger_page_cache() {
    let directory = tempfile::tempdir().unwrap();
    let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
    for _ in 0..2 {
        let storage = database.open("scope").unwrap();
        assert_eq!(storage.connection.get_temp_store(), TempStore::Memory);
        let rows = driver::query(&storage.connection(), "PRAGMA cache_size", Vec::new()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(required_i64(&rows[0], 0).unwrap(), NATIVE_PAGE_CACHE_PAGES);
        storage.try_close().unwrap();
    }
}

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

#[test]
fn previous_format_drops_records_and_keeps_pending_writes() {
    block_on(async {
        let database = TursoMemoryDatabase::new("previous-format-migration.db");
        let mut storage = database.open("scope").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("persisted"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();

        mark_previous_format(&storage, &cache_namespace_at("scope", 3));
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![None],
            "records from the previous format are dropped"
        );
        assert_eq!(
            storage.load_mutation_queue().await.unwrap(),
            pending,
            "queued mutations and their optimistic layers survive"
        );
        assert_eq!(
            namespace(&storage),
            cache_namespace("scope"),
            "the migration rewrites the namespace"
        );
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );

        // The migrated database reopens without another migration or reset.
        let storage = database.open("scope").unwrap();
        assert_eq!(
            storage.load_mutation_queue().await.unwrap(),
            pending,
            "a second open keeps the migrated queue"
        );
        assert_eq!(namespace(&storage), cache_namespace("scope"));
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

fn namespace(storage: &TursoStorage) -> String {
    let rows = driver::query(
        &storage.connection(),
        "SELECT value FROM meta WHERE key = 'namespace'",
        Vec::new(),
    )
    .unwrap();
    required_text(&rows[0], 0).unwrap()
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn migrating_a_file_reclaims_space_and_keeps_pending_writes() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.turso");
        let database = TursoFileDatabase::new(&path).unwrap();
        let mut storage = database.open("scope").unwrap();
        storage
            .put_batch(vec![(
                key("Thing:1"),
                record(&"review line\n".repeat(20_000)),
            )])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        mark_previous_format(&storage, &cache_namespace_at("scope", 3));
        storage.try_close().unwrap();
        let before = std::fs::metadata(&path).unwrap().len();
        assert!(before > 100_000, "fixture file was only {before} bytes");

        let storage = database.open("scope").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Thing:0")]).await.unwrap(),
            vec![None],
            "records from the previous format are dropped"
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(namespace(&storage), cache_namespace("scope"));
        storage.try_close().unwrap();

        let after = std::fs::metadata(&path).unwrap().len();
        assert!(
            after < before / 2,
            "compaction should reclaim space: {before} -> {after}"
        );
        let storage = database.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        storage.try_close().unwrap();
    });
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn failed_compaction_keeps_the_migrated_database() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.turso");
        let database = TursoFileDatabase::new(&path).unwrap();
        let mut storage = database.open("scope").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("persisted"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        mark_previous_format(&storage, &cache_namespace_at("scope", 3));
        storage.try_close().unwrap();

        // A directory at the compaction target makes VACUUM INTO fail. The
        // migration is already committed, so its retained queue must survive.
        let compact_path = path.with_extension("migrated");
        std::fs::create_dir(&compact_path).unwrap();
        let storage = database.open("scope").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Thing:1")]).await.unwrap(),
            vec![None]
        );
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        storage.try_close().unwrap();
        std::fs::remove_dir(&compact_path).unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(namespace(&storage), cache_namespace("scope"));
        storage.try_close().unwrap();
    });
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn failed_swap_keeps_the_migrated_database() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.turso");
        let database = TursoFileDatabase::new(&path).unwrap();
        let mut storage = database.open("scope").unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("persisted"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        mark_previous_format(&storage, &cache_namespace_at("scope", 3));
        storage.try_close().unwrap();

        // A directory at the backup path fails the move of the original, which
        // must leave the migrated database openable.
        let backup_path = path.with_extension("backup");
        std::fs::create_dir(&backup_path).unwrap();
        let storage = database.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        storage.try_close().unwrap();
        std::fs::remove_dir(&backup_path).unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        assert_eq!(namespace(&storage), cache_namespace("scope"));
        storage.try_close().unwrap();
    });
}

#[test]
fn used_database_reopens_with_the_pinned_schema_digest() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let mut storage = database.open("scope").unwrap();
        let created = schema_digest(&storage.connection()).unwrap();
        storage
            .put_batch(vec![(key("Thing:1"), record("kept"))])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        let reopened = schema_digest(&storage.connection()).unwrap();
        validate_frozen_schema(&storage.connection()).unwrap();
        validate_statements(&storage.connection()).unwrap();
        assert_eq!(created, reopened);
        assert_eq!(
            reopened,
            Some(FRESH_SCHEMA_DIGEST),
            "update FRESH_SCHEMA_DIGEST to {:#034x}",
            reopened.unwrap_or_default(),
        );
    });
}

#[test]
fn fresh_schema_passes_every_open_check() {
    let storage = TursoStorage::open_in_memory("scope").unwrap();
    let connection = storage.connection();
    assert!(has_fresh_schema(&connection).unwrap());
    validate_frozen_schema(&connection).unwrap();
    validate_statements(&connection).unwrap();
}

#[test]
fn changed_schema_takes_the_full_checks_on_reopen() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let storage = database.open("scope").unwrap();
        raw_execute(&storage, "DROP INDEX search_documents_browse_idx", vec![]);
        assert!(!has_fresh_schema(&storage.connection()).unwrap());
        storage.try_close().unwrap();

        expect_reset_reason(database.open("scope"), PhysicalResetReason::Compatibility);
    });
}
