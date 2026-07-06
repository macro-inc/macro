//! Browser tests for the IndexedDB backend. Run with:
//! `wasm-pack test --headless --chrome cache-idb`
//! (or `--firefox`). Not part of native `cargo test`.

#![cfg(target_arch = "wasm32")]

use cache_core::engine::{Engine, ReadResult};
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
        .write_query(None, query, Some("Soup"), &vars, &data)
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
