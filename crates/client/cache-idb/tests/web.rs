//! Browser tests for the IndexedDB backend. Run with:
//! `wasm-pack test --headless --chrome cache-idb`
//! (or `--firefox`). Not part of native `cargo test`.

#![cfg(target_arch = "wasm32")]

use cache_core::engine::{Engine, ReadResult};
use cache_core::queue::{
    MutationClaimRequest, MutationClaimToken, MutationRequest, NewQueuedMutation,
    PersistedOptimisticLayer, StoredMutation,
};
use cache_core::record_selection::RecordSelection;
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_idb::IdbStorage;
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
async fn scans_selected_record_types_in_key_order() {
    let scope = "test-record-scan";
    IdbStorage::destroy(scope).await.unwrap();
    let mut storage = IdbStorage::open(scope).await.unwrap();
    storage
        .put_batch(vec![
            (key("TypeB:2"), record("b2")),
            (key("Other:1"), record("other")),
            (key("TypeA:2"), record("a2")),
            (key("TypeA:1"), record("a1")),
        ])
        .await
        .unwrap();

    let first = storage
        .scan_records(&["TypeB".into(), "TypeA".into()], None, 2)
        .await
        .unwrap();
    assert_eq!(
        first
            .iter()
            .map(|(key, _)| key.0.as_str())
            .collect::<Vec<_>>(),
        vec!["TypeA:1", "TypeA:2"]
    );
    let second = storage
        .scan_records(&["TypeA".into(), "TypeB".into()], Some(&first[1].0), 2)
        .await
        .unwrap();
    assert_eq!(
        second
            .iter()
            .map(|(key, _)| key.0.as_str())
            .collect::<Vec<_>>(),
        vec!["TypeB:2"]
    );
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

    let selection =
        RecordSelection::parse("fragment Item on GraphqlSoupItem { id }", "Item").unwrap();
    let page = engine.read_records(&selection, None, 10).await.unwrap();
    assert_eq!(page.records, vec![serde_json::json!({"id": "doc-1"})]);
    assert!(page.next_cursor.is_none());
}
