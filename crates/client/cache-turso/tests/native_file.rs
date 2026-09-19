#![cfg(not(target_arch = "wasm32"))]

use cache_core::normalize::RecordUpdates;
use cache_core::queue::{
    MutationRequest, NewQueuedMutation, PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoFileDatabase, TursoStorageCloseOutcome};
use pollster::block_on;

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn record(value: &str) -> Record {
    let mut record = Record::default();
    record
        .fields
        .insert("value".into(), CacheValue::String(value.into()));
    record
}

#[test]
fn filesystem_database_persists_across_close_and_reopen() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();

        let mut storage = database.open("scope-1").unwrap();
        storage
            .put_batch(vec![(key("Document:1"), record("persisted"))])
            .await
            .unwrap();
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );

        let storage = database.open("scope-1").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Document:1")]).await.unwrap(),
            vec![Some(record("persisted"))]
        );
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn filesystem_database_preserves_the_mutation_queue() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();

        let mut storage = database.open("scope-1").unwrap();
        let mutation_id = storage
            .enqueue_mutation(NewQueuedMutation {
                uuid: uuid::Uuid::new_v4(),
                mutation: StoredMutation::new(
                    MutationRequest {
                        query: "mutation Persist { persist }".into(),
                        operation_name: Some("Persist".into()),
                        variables_json: r#"{"value":1}"#.into(),
                        identity: Some("identity".into()),
                    },
                    42,
                ),
                optimistic: PersistedOptimisticLayer {
                    optimistic_data_json: r#"{"persist":true}"#.into(),
                    normalized_updates: RecordUpdates::default(),
                },
            })
            .await
            .unwrap();
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );

        let storage = database.open("scope-1").unwrap();
        let queue = storage.load_mutation_queue().await.unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].id, mutation_id);
        assert_eq!(
            queue[0].mutation.request.operation_name.as_deref(),
            Some("Persist")
        );
        assert_eq!(queue[0].mutation.created_at_ms, 42);
        assert_eq!(
            queue[0].optimistic.optimistic_data_json,
            r#"{"persist":true}"#
        );
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn open_or_reset_replaces_an_incompatible_scope() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();

        let mut storage = database.open("scope-1").unwrap();
        storage
            .put_batch(vec![(key("Document:1"), record("old-scope"))])
            .await
            .unwrap();
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );

        let error = database.open("scope-2").unwrap_err();
        assert!(error.requires_physical_reset());

        let storage = database.open_or_reset("scope-2").unwrap();
        assert_eq!(
            storage.get_batch(&[key("Document:1")]).await.unwrap(),
            vec![None]
        );
        assert_eq!(
            storage.try_close().unwrap(),
            TursoStorageCloseOutcome::Healthy
        );
    });
}

#[test]
fn open_or_reset_replaces_invalid_database_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cache.turso");
    std::fs::write(&path, b"not a sqlite database").unwrap();
    let database = TursoFileDatabase::new(path).unwrap();

    let storage = database.open_or_reset("scope-1").unwrap();
    assert_eq!(
        storage.try_close().unwrap(),
        TursoStorageCloseOutcome::Healthy
    );
}
