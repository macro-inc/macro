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

const PROPERTY_QUERY: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { hasMore items { id entity {
        __typename
        ... on GraphqlSoupDocument { id properties { id displayName } }
    } } } }
}"#;

const PROPERTY_MUTATION: &str = r#"mutation SetEntityProperty($input: SetEntityPropertyInput!) {
    setEntityProperty(input: $input) { id displayName }
}"#;

#[wasm_bindgen_test]
async fn optimistic_write_round_trip() {
    destroy_cache("wasm-shell-optimistic".into()).await.unwrap();
    let engine = open_cache("wasm-shell-optimistic".into(), None)
        .await
        .unwrap();

    let vars = serde_json::json!({"input": {"limit": 1}});
    let base = serde_json::json!({
        "user": { "id": "user-1", "soup": { "hasMore": false, "items": [{
            "id": "item-1",
            "entity": {
                "__typename": "GraphqlSoupDocument",
                "id": "doc-1",
                "properties": [{ "id": "prop-1", "displayName": "Status" }]
            }
        }] } }
    });
    JsFuture::from(engine.write_query(
        None,
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        js(base),
        None,
    ))
    .await
    .unwrap();
    // Register op 1 against the property record.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "hit");

    let mutation_vars = serde_json::json!({"input": {
        "entityType": "DOCUMENT",
        "entityId": "doc-1",
        "propertyDefinitionId": "def-1",
        "value": { "string": "x" }
    }});

    // Begin: op 1 is affected, a string transaction id comes back.
    let begin = JsFuture::from(engine.begin_optimistic_write(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_vars.clone()),
        js(serde_json::json!({ "setEntityProperty": { "id": "prop-1", "displayName": "Stage" } })),
    ))
    .await
    .unwrap();
    let begin: serde_json::Value = serde_wasm_bindgen::from_value(begin).unwrap();
    let txn = begin["transactionId"].as_str().unwrap().to_string();
    assert_eq!(begin["affectedOps"], serde_json::json!(["tab1:1"]));
    assert_eq!(
        begin["changed"],
        serde_json::json!(["GraphqlSoupProperty:prop-1"])
    );

    // The optimistic layer is visible through reads.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(
        read["data"]["user"]["soup"]["items"][0]["entity"]["properties"][0]["displayName"],
        serde_json::json!("Stage")
    );

    // Commit with the real response; the layer flushes durably.
    let commit = JsFuture::from(engine.commit_optimistic_write(
        txn.clone(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_vars.clone()),
        js(serde_json::json!({ "setEntityProperty": { "id": "prop-1", "displayName": "Stage!" } })),
    ))
    .await
    .unwrap();
    let commit: serde_json::Value = serde_wasm_bindgen::from_value(commit).unwrap();
    assert_eq!(
        commit["changed"],
        serde_json::json!(["GraphqlSoupProperty:prop-1"])
    );
    assert_eq!(commit["affectedOps"], serde_json::json!(["tab1:1"]));

    // Settled transactions reject further commits/rollbacks.
    let err = JsFuture::from(engine.rollback_optimistic_write(txn)).await;
    assert!(err.is_err());
    // Malformed ids reject too.
    let err = JsFuture::from(engine.rollback_optimistic_write("not-a-number".into())).await;
    assert!(err.is_err());

    JsFuture::from(engine.close()).await.unwrap();
    destroy_cache("wasm-shell-optimistic".into()).await.unwrap();
}
