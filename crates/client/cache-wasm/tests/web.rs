//! Browser tests for the wasm shell (JsValue boundary + async mutex).
//! Run like cache-idb's tests (see workspace README).

#![cfg(target_arch = "wasm32")]

use cache_wasm::{destroy_cache, open_cache};
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const QUERY: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor hasMore items { id } } }
}"#;

fn js(json: serde_json::Value) -> JsValue {
    use serde::Serialize;
    json.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap()
}

#[wasm_bindgen_test]
async fn write_then_read_through_js_boundary() {
    destroy_cache("wasm-shell-test".into()).await.unwrap();
    let engine = open_cache("wasm-shell-test".into(), None).await.unwrap();

    let vars = serde_json::json!({"input": {"limit": 1}});
    let data = serde_json::json!({
        "user": { "id": "user-1", "soup": { "nextCursor": null, "hasMore": false, "items": [{"id": "doc-1"}] } }
    });

    // Miss first.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "miss");

    // Write via op 2 (tagged with the viewer identity), expect op 1
    // affected (registered on the miss).
    let write = JsFuture::from(engine.write_query(
        Some("tab1:2".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        js(data.clone()),
        Some("user-1".into()),
    ))
    .await
    .unwrap();
    let write: serde_json::Value = serde_wasm_bindgen::from_value(write).unwrap();
    assert!(!write["changed"].as_array().unwrap().is_empty());
    assert_eq!(write["affectedOps"], serde_json::json!(["tab1:1"]));
    assert_eq!(write["reset"], serde_json::json!(false));

    // Hit now; data is a plain JS object round-tripped exactly.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "hit");
    assert_eq!(read["data"], data);

    // Cross-instance invalidation path: evict + report local dependents.
    let affected =
        JsFuture::from(engine.invalidate_keys(vec!["GraphqlSoupItem:doc-1".to_string()]))
            .await
            .unwrap();
    let affected: Vec<String> = serde_wasm_bindgen::from_value(affected).unwrap();
    assert_eq!(affected, vec!["tab1:1".to_string()]);

    // Lifecycle: close the connection, then deletion completes (would hang
    // on a live connection without versionchange auto-close).
    JsFuture::from(engine.close()).await.unwrap();
    destroy_cache("wasm-shell-test".into()).await.unwrap();
}
