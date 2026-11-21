use super::*;

#[test]
fn schema_11_cache_is_replaced_without_migrating_pending_writes() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let mut engine = cache_core::engine::Engine::new(database.open("scope").unwrap());
        let previous_generation = engine.current_storage_generation().await.unwrap();
        let mut storage = engine.into_storage();
        storage
            .put_batch(vec![(key("Thing:1"), record("old"))])
            .await
            .unwrap();
        storage
            .enqueue_mutation(queued("BeforeUpgrade"))
            .await
            .unwrap();
        raw_execute(&storage, "DROP INDEX search_documents_browse_idx", vec![]);
        raw_execute(
            &storage,
            "CREATE INDEX search_documents_browse_idx ON search_documents(profile, bucket, timestamp_ms DESC, __typename, id)",
            vec![],
        );
        raw_execute(
            &storage,
            "UPDATE meta SET value = '11' WHERE key = 'storage_schema_version'",
            vec![],
        );
        storage.try_close().unwrap();

        expect_reset_reason(database.open("scope"), PhysicalResetReason::Compatibility);
        let mut storage = database.open_or_reset("scope").unwrap();
        assert_eq!(storage.get_batch(&[key("Thing:1")]).await.unwrap(), [None]);
        assert!(storage.load_mutation_queue().await.unwrap().is_empty());
        assert_eq!(
            raw_scalar(
                &storage,
                "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'storage_schema_version'"
            ),
            i64::from(STORAGE_SCHEMA_VERSION)
        );
        storage
            .enqueue_mutation(queued("AfterUpgrade"))
            .await
            .unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        let mut engine = cache_core::engine::Engine::new(storage);
        let generation = engine.current_storage_generation().await.unwrap();
        assert_ne!(generation, previous_generation);
        engine.into_storage().try_close().unwrap();

        let storage = database.open_or_reset("scope").unwrap();
        assert_eq!(storage.load_mutation_queue().await.unwrap(), pending);
        let mut engine = cache_core::engine::Engine::new(storage);
        assert_eq!(
            engine.current_storage_generation().await.unwrap(),
            generation
        );
        engine.into_storage().try_close().unwrap();
    });
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

        mark_previous_format(&storage, "scope");
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

/// Rewrites every record as the previous format stored it: untagged postcard
/// bytes under the previous namespace.
fn mark_previous_format(storage: &TursoStorage, scope: &str) {
    let rows = driver::query(
        &storage.connection(),
        "SELECT __typename, id, value FROM records",
        Vec::new(),
    )
    .unwrap();
    for row in rows {
        let typename = required_text(&row, 0).unwrap();
        let id = required_text(&row, 1).unwrap();
        let Value::Blob(bytes) = required_value(&row, 2).unwrap() else {
            panic!("records.value must be a blob");
        };
        let legacy = match bytes.first() {
            Some(0) => bytes[1..].to_vec(),
            Some(1) => miniz_oxide::inflate::decompress_to_vec(&bytes[1..]).unwrap(),
            other => panic!("unexpected record encoding {other:?} for {typename}:{id}"),
        };
        raw_execute(
            storage,
            "UPDATE records SET value = ?1 WHERE __typename = ?2 AND id = ?3",
            vec![Value::from_blob(legacy), text(&typename), text(&id)],
        );
    }
    raw_execute(
        storage,
        "UPDATE meta SET value = ?1 WHERE key = 'namespace'",
        vec![text(&cache_namespace_at(scope, 3))],
    );
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
                record(&"review line\n".repeat(40_000)),
            )])
            .await
            .unwrap();
        storage.enqueue_mutation(queued("Pending")).await.unwrap();
        let pending = storage.load_mutation_queue().await.unwrap();
        mark_previous_format(&storage, "scope");
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
        mark_previous_format(&storage, "scope");
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
        mark_previous_format(&storage, "scope");
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
