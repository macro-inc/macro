#![cfg(target_arch = "wasm32")]

use cache_core::engine::{Engine, ReadResult};
use cache_core::normalize::RecordUpdates;
use cache_core::queue::{
    MutationRequest, NewQueuedMutation, PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{HealthyTursoStorageClosed, TursoStorage, TursoStorageCloseOutcome};
use turso_opfs::{OpenResult, OpfsOwner};
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_dedicated_worker);

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

fn healthy_close(outcome: TursoStorageCloseOutcome) -> HealthyTursoStorageClosed {
    let TursoStorageCloseOutcome::Healthy(closed) = outcome else {
        panic!("healthy browser storage unexpectedly required reset")
    };
    closed
}

fn queued() -> NewQueuedMutation {
    NewQueuedMutation {
        uuid: uuid::Uuid::new_v4(),
        mutation: StoredMutation::new(
            MutationRequest {
                query: "mutation Browser { update { id } }".into(),
                operation_name: Some("Browser".into()),
                variables_json: "{}".into(),
                identity: None,
            },
            1,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: "{}".into(),
            normalized_updates: RecordUpdates::default(),
        },
    }
}

const ENGINE_QUERY: &str = r#"
query BrowserEngine {
  user {
    id
  }
}
"#;

fn engine_data() -> serde_json::Value {
    serde_json::json!({"user": {"id": "browser-user"}})
}

#[wasm_bindgen_test(async)]
async fn real_engine_over_opfs_consumes_storage_for_preserve_and_reset() {
    let owner = OpfsOwner::acquire("cache-turso-wp06-engine.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("recovery wipe must produce a complete fresh pair")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "engine-scope").unwrap();
    let mut engine = Engine::new(storage);
    engine
        .write_query(
            None,
            ENGINE_QUERY,
            Some("BrowserEngine"),
            &serde_json::Map::new(),
            &engine_data(),
            None,
        )
        .await
        .unwrap();
    let owner = healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap();

    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("preserved engine database must reopen")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "engine-scope").unwrap();
    let mut engine = Engine::new(storage);
    let ReadResult::Hit { data } = engine
        .read_query(
            None,
            ENGINE_QUERY,
            Some("BrowserEngine"),
            &serde_json::Map::new(),
        )
        .await
        .unwrap()
    else {
        panic!("reopened OPFS engine must read its durable record")
    };
    assert_eq!(data, engine_data());
    let owner = healthy_close(engine.into_storage().try_close().unwrap())
        .reset()
        .await
        .unwrap();

    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("reset engine database must reopen fresh")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "engine-scope").unwrap();
    let mut replacement = Engine::new(storage);
    assert!(matches!(
        replacement
            .read_query(
                None,
                ENGINE_QUERY,
                Some("BrowserEngine"),
                &serde_json::Map::new(),
            )
            .await
            .unwrap(),
        ReadResult::Miss
    ));
    healthy_close(replacement.into_storage().try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
async fn incompatible_opfs_initialization_exposes_reset_only_and_cannot_preserve() {
    let owner = OpfsOwner::acquire("cache-turso-wp06-browser.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("recovery wipe must produce a complete fresh pair")
    };
    let mut storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "browser-scope").unwrap();
    storage
        .put_batch(vec![
            (key("ROOT_QUERY"), record("root")),
            (key("Type0:1"), record("prefix")),
            (key("Type:9"), record("ordinary")),
        ])
        .await
        .unwrap();
    let mutation_id = storage.enqueue_mutation(queued()).await.unwrap();
    let owner = healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap();

    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("preserved complete pair must reopen")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "browser-scope").unwrap();
    assert_eq!(
        storage
            .get_batch(&[key("Type0:1"), key("Type:9")])
            .await
            .unwrap(),
        [Some(record("prefix")), Some(record("ordinary"))]
    );
    assert_eq!(
        storage.load_mutation_queue().await.unwrap()[0].id,
        mutation_id
    );

    let owner = healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("preserved complete pair must reopen for compatibility validation")
    };
    let failure =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "wrong-browser-scope")
            .unwrap_err();
    assert!(failure.error().requires_physical_reset());
    let owner = failure.reset().await.unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("physical reset must recreate a complete fresh pair")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "browser-scope").unwrap();
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.get_batch(&[key("Type:9")]).await.unwrap(),
        vec![None]
    );
    healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}
