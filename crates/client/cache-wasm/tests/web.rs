//! Browser tests for the wasm shell (JsValue boundary + async mutex).
//! Run like cache-idb's tests (see workspace README).

#![cfg(target_arch = "wasm32")]

use cache_wasm::{destroy_cache, open_cache};
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const QUERY: &str = r#"query Soup($input: SoupInput!) {
    user {
        id
        soup(input: $input) {
            nextCursor
            items {
                __typename
                id
            }
        }
    }
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
        "user": {
            "id": "user-1",
            "soup": {
                "nextCursor": null,
                "items": [{ "__typename": "GraphqlSoupDocument", "id": "doc-1" }]
            }
        }
    });

    // Miss first.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        JsValue::UNDEFINED,
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

    let identity = JsFuture::from(engine.bound_identity()).await.unwrap();
    let identity: Option<String> = serde_wasm_bindgen::from_value(identity).unwrap();
    assert_eq!(identity.as_deref(), Some("user-1"));

    // Hit now; data is a plain JS object round-tripped exactly.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        JsValue::UNDEFINED,
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "hit");
    assert_eq!(read["data"], data);

    // Variables-only inspection crosses the wasm boundary without
    // materializing the selected value.
    let variants = JsFuture::from(engine.inspect_query_variants(
        QUERY.into(),
        Some("Soup".into()),
        js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
    ))
    .await
    .unwrap();
    let variants: serde_json::Value = serde_wasm_bindgen::from_value(variants).unwrap();
    assert_eq!(variants[0]["variables"], vars);
    assert!(variants[0].get("value").is_none());

    // Full generated-query inspection also materializes the selected value.
    let inspected = JsFuture::from(engine.inspect_query(
        QUERY.into(),
        Some("Soup".into()),
        js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
        js(serde_json::json!([])),
    ))
    .await
    .unwrap();
    let inspected: serde_json::Value = serde_wasm_bindgen::from_value(inspected).unwrap();
    assert_eq!(inspected[0]["variables"], vars);
    assert_eq!(inspected[0]["value"], data["user"]["soup"]);

    // Cross-instance invalidation path: evict + report local dependents.
    let affected =
        JsFuture::from(engine.invalidate_keys(vec!["GraphqlSoupDocument:doc-1".to_string()]))
            .await
            .unwrap();
    let affected: Vec<String> = serde_wasm_bindgen::from_value(affected).unwrap();
    assert_eq!(affected, vec!["tab1:1".to_string()]);

    // External invalidation keeps the shared cold-tier record, while local
    // mutation invalidation removes it from both tiers.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        JsValue::UNDEFINED,
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "hit");

    JsFuture::from(engine.delete_keys(vec!["GraphqlSoupDocument:doc-1".to_string()]))
        .await
        .unwrap();
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(vars),
        JsValue::UNDEFINED,
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(read["kind"], "miss");

    // Lifecycle: close the connection, then deletion completes (would hang
    // on a live connection without versionchange auto-close).
    JsFuture::from(engine.close()).await.unwrap();
    destroy_cache("wasm-shell-test".into()).await.unwrap();
}

#[wasm_bindgen_test]
async fn entity_resolvers_cross_the_js_boundary() {
    destroy_cache("wasm-shell-entity-resolver".into())
        .await
        .unwrap();
    let engine = open_cache("wasm-shell-entity-resolver".into(), None)
        .await
        .unwrap();
    let soup_variables = serde_json::json!({"input": {"limit": 1}});
    JsFuture::from(engine.write_query(
        None,
        QUERY.into(),
        Some("Soup".into()),
        js(soup_variables),
        js(serde_json::json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "nextCursor": null,
                    "items": [{
                        "__typename": "GraphqlSoupEmailThread",
                        "id": "thread-1"
                    }]
                }
            }
        })),
        None,
    ))
    .await
    .unwrap();

    let direct_query = r#"query Email($input: EmailThreadInput!) {
        user { id emailThread(input: $input) { __typename id } }
    }"#;
    let result = JsFuture::from(engine.read_query(
        Some("tab1:entity".into()),
        direct_query.into(),
        Some("Email".into()),
        js(serde_json::json!({"input": {"threadId": "thread-1"}})),
        js(serde_json::json!([{
            "parentType": "GraphqlUser",
            "fieldName": "emailThread",
            "targetType": "GraphqlSoupEmailThread",
            "argumentPath": ["input", "threadId"]
        }])),
    ))
    .await
    .unwrap();
    let result: serde_json::Value = serde_wasm_bindgen::from_value(result).unwrap();
    assert_eq!(result["kind"], "hit");
    assert_eq!(result["data"]["user"]["emailThread"]["id"], "thread-1");

    JsFuture::from(engine.close()).await.unwrap();
    destroy_cache("wasm-shell-entity-resolver".into())
        .await
        .unwrap();
}

const PROPERTY_QUERY: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor items {
        __typename
        id
        ... on GraphqlSoupDocument { properties { id displayName } }
    } } }
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
        "user": { "id": "user-1", "soup": { "nextCursor": null, "items": [{
            "__typename": "GraphqlSoupDocument",
            "id": "doc-1",
            "properties": [{ "id": "prop-1", "displayName": "Status" }]
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
        JsValue::UNDEFINED,
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

    // Enqueue: op 1 is affected and the strict head is already claimed.
    let enqueue = JsFuture::from(engine.enqueue_optimistic_mutation(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_vars.clone()),
        js(serde_json::json!({ "setEntityProperty": { "id": "prop-1", "displayName": "Stage" } })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        123.0,
        "runner".into(),
        10.0,
        1_000.0,
    ))
    .await
    .unwrap();
    let enqueue: serde_json::Value = serde_wasm_bindgen::from_value(enqueue).unwrap();
    let txn = enqueue["transactionId"].as_str().unwrap().to_string();
    assert_eq!(enqueue["affectedOps"], serde_json::json!(["tab1:1"]));
    assert_eq!(
        enqueue["changed"],
        serde_json::json!(["GraphqlProperty:prop-1"])
    );
    assert_eq!(enqueue["initialClaim"]["kind"], "claimed");
    assert_eq!(enqueue["initialClaim"]["mutation"]["transactionId"], txn);

    // The optimistic layer is visible through reads.
    let read = JsFuture::from(engine.read_query(
        Some("tab1:1".into()),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        JsValue::UNDEFINED,
    ))
    .await
    .unwrap();
    let read: serde_json::Value = serde_wasm_bindgen::from_value(read).unwrap();
    assert_eq!(
        read["data"]["user"]["soup"]["items"][0]["properties"][0]["displayName"],
        serde_json::json!("Stage")
    );

    let generation = enqueue["initialClaim"]["mutation"]["leaseGeneration"]
        .as_str()
        .unwrap()
        .to_string();

    // Commit with the real response; the layer flushes durably.
    let commit = JsFuture::from(engine.commit_optimistic_write(
        txn.clone(),
        "runner".into(),
        generation.clone(),
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
        serde_json::json!(["GraphqlProperty:prop-1"])
    );
    assert_eq!(commit["affectedOps"], serde_json::json!(["tab1:1"]));

    // Settled transactions reject further commits/rollbacks.
    let err =
        JsFuture::from(engine.rollback_optimistic_write(txn, "runner".into(), generation)).await;
    assert!(err.is_err());
    // Malformed ids reject too.
    let err = JsFuture::from(engine.rollback_optimistic_write(
        "not-a-number".into(),
        "runner".into(),
        "1".into(),
    ))
    .await;
    assert!(err.is_err());

    JsFuture::from(engine.close()).await.unwrap();
    destroy_cache("wasm-shell-optimistic".into()).await.unwrap();
}
