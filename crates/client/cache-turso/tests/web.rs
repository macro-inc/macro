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

#[path = "common/contact_sync.rs"]
mod contact_sync;
#[path = "common/contacts.rs"]
mod contacts;
#[path = "common/people.rs"]
mod people;
#[path = "common/people_sql.rs"]
mod people_sql;

#[wasm_bindgen_test(async)]
async fn authoritative_contact_removal_is_scoped_and_fenced_over_opfs() {
    let owner = OpfsOwner::acquire("cache-contact-sync.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh storage");
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "contact-sync").unwrap();
    let storage = contact_sync::contract(storage).await;
    healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
async fn local_people_sql_executes_over_opfs() {
    let owner = OpfsOwner::acquire("cache-people-sql.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh storage");
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "local-people-sql").unwrap();
    let mut engine = Engine::with_capacity(storage, 16);
    let scope = people_sql::seed(&mut engine, 1_000).await;
    let engine = people_sql::contract(engine, &scope, 1_000).await;
    let engine = contact_sync::verify(engine, &scope, 1_000).await;
    healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
#[ignore = "100k local SQL execution over persisted OPFS"]
async fn local_people_sql_100k_over_opfs() {
    let owner = OpfsOwner::acquire("cache-people-sql-100k.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh storage");
    };
    let session = session.connect().unwrap();
    let clock = session.connection().prepare("SELECT 1").unwrap();
    let start = clock._io().current_time_monotonic();
    let storage = TursoStorage::from_opfs_session(session, "local-people-sql").unwrap();
    let mut engine = Engine::with_capacity(storage, 16);
    let scope = people_sql::seed(&mut engine, 100_000).await;
    console_log!(
        "100k OPFS SQL hydration: {:?}",
        clock._io().current_time_monotonic().duration_since(start)
    );
    let start = clock._io().current_time_monotonic();
    let engine = people_sql::contract(engine, &scope, 100_000).await;
    console_log!(
        "100k OPFS SQL contract: {:?}",
        clock._io().current_time_monotonic().duration_since(start)
    );
    drop(clock);
    let owner = healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("persisted storage");
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "local-people-sql").unwrap();
    let engine = Engine::with_capacity(storage, 16);
    let engine = people_sql::contract(engine, &scope, 100_000).await;
    healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
async fn people_policy_filters_and_ranks_before_limiting_over_opfs() {
    let owner = OpfsOwner::acquire("cache-people-policy.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh storage")
    };
    let mut storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "people-policy").unwrap();
    people::seed(&mut storage, 2_000).await;
    let storage = people::assert_policy(storage).await;
    healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}
#[path = "common/search.rs"]
mod search_streaming;

#[wasm_bindgen_test(async)]
async fn bounded_contact_hydration_and_search_over_opfs() {
    let owner = OpfsOwner::acquire("cache-turso-contacts.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh contact storage must open")
    };
    let storage = TursoStorage::from_opfs_session(session.connect().unwrap(), "contacts").unwrap();
    let mut engine = Engine::with_capacity(storage, 16);
    contacts::hydrate_contacts(&mut engine, 3).await;
    let generation = engine.current_storage_generation().await.unwrap();
    let owner = healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("contact storage must reopen")
    };
    let storage = TursoStorage::from_opfs_session(session.connect().unwrap(), "contacts").unwrap();
    let mut engine = Engine::with_capacity(storage, 16);
    assert_eq!(
        engine.current_storage_generation().await.unwrap(),
        generation
    );
    contacts::assert_contact_search(&mut engine, 1_500).await;
    contacts::assert_account_reset(&mut engine).await;
    healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
async fn streaming_sql_search_matches_reference_ranking_over_opfs() {
    let owner = OpfsOwner::acquire("cache-turso-streamed-search.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh search storage must open")
    };
    let storage =
        TursoStorage::from_opfs_session(session.connect().unwrap(), "search-scope").unwrap();
    let storage = search_streaming::assert_search_contract(storage).await;
    healthy_close(storage.try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

#[wasm_bindgen_test(async)]
#[ignore = "100k-row OPFS search measurement; run with --include-ignored --nocapture"]
async fn search_100k_rows_over_opfs() {
    use cache_core::search::{SearchProfile, SearchRequest};
    let owner = OpfsOwner::acquire("cache-turso-search-100k.db")
        .await
        .unwrap()
        .recovery_wipe()
        .await
        .unwrap();
    let OpenResult::Ready(session) = owner.open().await.unwrap() else {
        panic!("fresh search storage must open")
    };
    let session = session.connect().unwrap();
    // Use the OPFS clock: std::time::Instant is unavailable on browser WASM.
    let clock = session.connection().prepare("SELECT 1").unwrap();
    let mut storage = TursoStorage::from_opfs_session(session, "search-100k").unwrap();
    search_streaming::seed_100k(&mut storage).await;
    let mut engine = Engine::new(storage);
    for query in ["contact", "99999", "no-match", "contact", "99999"] {
        let start = clock._io().current_time_monotonic();
        let result = engine
            .search(&SearchRequest {
                profile: SearchProfile::QuickAccessV1,
                buckets: vec!["document".into()],
                query: query.into(),
                cursor: None,
                limit: 50,
                now_ms: 2_000,
            })
            .await
            .unwrap();
        console_log!(
            "100k OPFS search: query={query:?}, elapsed={:?}, results={}",
            clock._io().current_time_monotonic().duration_since(start),
            result.documents.len()
        );
        assert!(result.documents.len() <= 50);
        assert_eq!(result.documents.is_empty(), query == "no-match");
    }
    drop(clock);
    healthy_close(engine.into_storage().try_close().unwrap())
        .preserve()
        .unwrap()
        .release()
        .await
        .unwrap();
}

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
