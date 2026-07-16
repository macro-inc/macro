//! Browser tests for the IndexedDB backend. Run with:
//! `wasm-pack test --headless --chrome cache-idb`
//! (or `--firefox`). Not part of native `cargo test`.

#![cfg(target_arch = "wasm32")]

use cache_core::codec::cache_database_name;
use cache_core::engine::{Engine, ReadResult};
use cache_core::entity_index::{EntityBucket, EntityIndexCursor, EntityIndexQuery};
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_idb::IdbStorage;
use idb::{Factory, TransactionMode};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn record(name: &str) -> Record {
    let mut r = Record::default();
    r.fields
        .insert("name".into(), CacheValue::String(name.into()));
    r
}

fn key(s: &str) -> EntityKey {
    EntityKey(s.to_string())
}

fn indexed_document(viewed_at: &str, file_type: Option<&str>, subtype: Option<&str>) -> Record {
    let mut record = record("Document");
    record.fields.insert(
        "__typename".into(),
        CacheValue::String("GraphqlSoupDocument".into()),
    );
    record
        .fields
        .insert("viewedAt".into(), CacheValue::String(viewed_at.into()));
    if let Some(file_type) = file_type {
        record
            .fields
            .insert("fileType".into(), CacheValue::String(file_type.into()));
    }
    if let Some(subtype) = subtype {
        record.fields.insert(
            "subType".into(),
            CacheValue::Object(
                [("kind".into(), CacheValue::String(subtype.into()))]
                    .into_iter()
                    .collect(),
            ),
        );
    }
    record
}

fn queued(name: &str) -> NewQueuedMutation {
    NewQueuedMutation {
        mutation: StoredMutation::new(
            MutationRequest {
                query: "mutation Rename { rename { id } }".into(),
                operation_name: Some("Rename".into()),
                variables_json: format!(r#"{{"name":"{name}"}}"#),
                identity: Some("user-1".into()),
            },
            10,
        ),
        optimistic: PersistedOptimisticLayer {
            optimistic_data_json: format!(r#"{{"rename":{{"name":"{name}"}}}}"#),
            normalized_updates: [(key("A:1"), record(name))].into(),
        },
    }
}

#[wasm_bindgen_test]
async fn put_get_delete_roundtrip() {
    IdbStorage::destroy("test-rt").await.unwrap();
    let mut s = IdbStorage::open("test-rt").await.unwrap();

    s.put_batch(vec![(key("A:1"), record("a")), (key("B:2"), record("b"))])
        .await
        .unwrap();

    let got = s
        .get_batch(&[key("A:1"), key("C:3"), key("B:2")])
        .await
        .unwrap();
    assert_eq!(got[0].as_ref().unwrap(), &record("a"));
    assert!(got[1].is_none());
    assert_eq!(got[2].as_ref().unwrap(), &record("b"));

    s.put_batch(vec![(key("A:1"), record("a2"))]).await.unwrap();
    let got = s.get_batch(&[key("A:1")]).await.unwrap();
    assert_eq!(got[0].as_ref().unwrap(), &record("a2"));

    s.delete_batch(&[key("A:1")]).await.unwrap();
    assert!(s.get_batch(&[key("A:1")]).await.unwrap()[0].is_none());

    s.clear().await.unwrap();
    assert!(s.get_batch(&[key("B:2")]).await.unwrap()[0].is_none());
}

#[wasm_bindgen_test]
async fn persists_quick_access_index_metadata() {
    let scope = "test-index-metadata";
    IdbStorage::destroy(scope).await.unwrap();
    let mut storage = IdbStorage::open(scope).await.unwrap();
    let entity_key = key("GraphqlSoupDocument:doc-1");
    let task_key = key("GraphqlSoupDocument:task-1");
    let note_key = key("GraphqlSoupDocument:note-1");
    storage
        .put_batch(vec![
            (
                entity_key.clone(),
                indexed_document("1970-01-01T00:00:03Z", None, None),
            ),
            (
                task_key.clone(),
                indexed_document("1970-01-01T00:00:03Z", Some("md"), Some("task")),
            ),
            (
                note_key.clone(),
                indexed_document("1970-01-01T00:00:02Z", Some("md"), None),
            ),
        ])
        .await
        .unwrap();

    let all = storage
        .query_entity_index(&EntityIndexQuery {
            buckets: Vec::new(),
            cursor: None,
            limit: 2,
            include_total_count: false,
        })
        .await
        .unwrap();
    assert_eq!(
        all.iter()
            .map(|entry| entry.entity_key.clone())
            .collect::<Vec<_>>(),
        vec![entity_key.clone(), task_key.clone()]
    );
    let selected = storage
        .query_entity_index(&EntityIndexQuery {
            buckets: vec![EntityBucket::Document],
            cursor: Some(EntityIndexCursor {
                sort_timestamp: all[0].sort_timestamp,
                entity_key: all[0].entity_key.clone(),
            }),
            limit: 3,
            include_total_count: false,
        })
        .await
        .unwrap();
    assert_eq!(
        selected
            .iter()
            .map(|entry| entry.entity_key.clone())
            .collect::<Vec<_>>(),
        vec![task_key, note_key]
    );

    let factory = Factory::new().unwrap();
    let database = factory
        .open(&cache_database_name(scope), Some(2))
        .unwrap()
        .await
        .unwrap();
    let transaction = database
        .transaction(&["records"], TransactionMode::ReadOnly)
        .unwrap();
    let records = transaction.object_store("records").unwrap();
    assert_eq!(
        records
            .index("records_by_sort")
            .unwrap()
            .count(None)
            .unwrap()
            .await
            .unwrap(),
        3
    );
    assert_eq!(
        records
            .index("records_by_bucket_sort")
            .unwrap()
            .count(None)
            .unwrap()
            .await
            .unwrap(),
        3
    );

    let envelope = records
        .get(JsValue::from_str(&entity_key.0))
        .unwrap()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        js_sys::Reflect::get(&envelope, &JsValue::from_str("bucket"))
            .unwrap()
            .as_string()
            .as_deref(),
        Some("document")
    );
    assert_eq!(
        js_sys::Reflect::get(&envelope, &JsValue::from_str("sortTimestamp"))
            .unwrap()
            .as_f64(),
        Some(3_000.0)
    );
    transaction.commit().unwrap().await.unwrap();
    database.close();
    storage.close();
}

#[wasm_bindgen_test]
async fn persists_across_reopen() {
    IdbStorage::destroy("test-persist").await.unwrap();
    let mut s = IdbStorage::open("test-persist").await.unwrap();
    s.put_batch(vec![(key("A:1"), record("a"))]).await.unwrap();
    s.close();

    let s = IdbStorage::open("test-persist").await.unwrap();
    let got = s.get_batch(&[key("A:1")]).await.unwrap();
    assert_eq!(got[0].as_ref().unwrap(), &record("a"));
}

#[wasm_bindgen_test]
async fn mutation_queue_persists_and_settles_atomically() {
    IdbStorage::destroy("test-queue").await.unwrap();
    let mut storage = IdbStorage::open("test-queue").await.unwrap();
    let id = storage
        .enqueue_mutation(queued("optimistic"))
        .await
        .unwrap();
    storage.close();

    let mut storage = IdbStorage::open("test-queue").await.unwrap();
    let loaded = storage.load_mutation_queue().await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, id);
    let claimed = storage
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 20,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    assert!(
        storage
            .complete_mutation(
                id,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claimed.lease_generation,
                },
                vec![(key("A:1"), record("server"))],
            )
            .await
            .unwrap()
    );
    assert!(storage.load_mutation_queue().await.unwrap().is_empty());
    assert_eq!(
        storage.get_batch(&[key("A:1")]).await.unwrap()[0],
        Some(record("server"))
    );
}

#[wasm_bindgen_test]
async fn engine_over_idb() {
    IdbStorage::destroy("test-engine").await.unwrap();
    let storage = IdbStorage::open("test-engine").await.unwrap();
    let mut engine = Engine::new(storage);

    let query = r#"query Soup($input: SoupInput!) {
        user { id soup(input: $input) { nextCursor hasMore items { id } } }
    }"#;
    let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
        unreachable!()
    };
    let data = serde_json::json!({
        "user": { "id": "user-1", "soup": { "nextCursor": null, "hasMore": false, "items": [{"id": "doc-1"}] } }
    });

    engine
        .write_query(None, query, Some("Soup"), &vars, &data, None)
        .await
        .unwrap();
    let ReadResult::Hit { data: cached } = engine
        .read_query(None, query, Some("Soup"), &vars)
        .await
        .unwrap()
    else {
        panic!("expected hit");
    };
    assert_eq!(cached, data);
}
