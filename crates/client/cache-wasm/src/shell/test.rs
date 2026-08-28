use super::*;
use serde::de::DeserializeOwned;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_dedicated_worker);

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

const OPTIMISTIC_DOCUMENT_MUTATION: &str = r#"mutation RenameEntities($inputs: [RenameEntityInput!]!) {
    renameEntities(inputs: $inputs) {
        results {
            __typename
            ... on GraphqlMutationSuccess {
                effects {
                    __typename
                    ... on SoupUpdated {
                        item {
                            __typename
                            id
                            displayName
                            ... on GraphqlSoupDocument {
                                ownerId
                                projectId
                                fileType
                                createdAt
                                updatedAt
                            }
                        }
                    }
                }
            }
        }
    }
}"#;

const SOUP_UPDATES_SUBSCRIPTION: &str = r#"subscription SoupUpdates {
    soupUpdates {
        __typename
        ... on SoupUpdated {
            item {
                __typename
                id
                displayName
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                }
            }
        }
    }
}"#;

const RECORD_FRAGMENT: &str = r#"fragment CachedDocument on GraphqlSoupDocument {
    id
}"#;

const REALTIME_DOCUMENT_FRAGMENT: &str = r#"fragment RealtimeDocument on GraphqlSoupDocument {
    id
    displayName
    ownerId
}"#;

fn js(json: serde_json::Value) -> JsValue {
    use serde::Serialize;
    json.serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .expect("serialize test value")
}

fn write_context(origin_op_id: Option<&str>) -> JsValue {
    js(serde_json::json!({
        "originOpId": origin_op_id,
        "registration": null
    }))
}

fn from_js<T: DeserializeOwned>(value: JsValue) -> T {
    serde_wasm_bindgen::from_value(value).expect("deserialize wasm result")
}

async fn resolved(promise: js_sys::Promise) -> JsValue {
    JsFuture::from(promise).await.expect("promise resolves")
}

async fn assert_closed(promise: js_sys::Promise) {
    let error = JsFuture::from(promise)
        .await
        .expect_err("closed method rejects");
    let message = js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .expect("Error.message")
        .as_string()
        .expect("message is a string");
    assert_eq!(message, "cache engine is closed");
}

async fn assert_reset_required(promise: js_sys::Promise) {
    let error = JsFuture::from(promise)
        .await
        .expect_err("reset-required method rejects");
    assert!(error.is_instance_of::<js_sys::Error>());
    assert_eq!(
        js_sys::Reflect::get(&error, &JsValue::from_str(RESET_REQUIRED_MARKER))
            .expect("reset marker")
            .as_bool(),
        Some(true)
    );
    let message = js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .expect("Error.message")
        .as_string()
        .expect("message is a string");
    assert_eq!(message, RESET_REQUIRED_MESSAGE);
}

fn variables() -> serde_json::Value {
    serde_json::json!({"input": {"limit": 1}})
}

fn soup_data(document_id: &str) -> serde_json::Value {
    serde_json::json!({
        "user": {
            "id": "user-1",
            "soup": {
                "nextCursor": null,
                "items": [{
                    "__typename": "GraphqlSoupDocument",
                    "id": document_id
                }]
            }
        }
    })
}

fn property_base() -> serde_json::Value {
    property_data("Status")
}

fn property_data(display_name: &str) -> serde_json::Value {
    serde_json::json!({
        "user": { "id": "user-1", "soup": { "nextCursor": null, "items": [{
            "__typename": "GraphqlSoupDocument",
            "id": "doc-1",
            "properties": [{ "id": "prop-1", "displayName": display_name }]
        }] } }
    })
}

fn mutation_variables() -> serde_json::Value {
    serde_json::json!({"input": {
        "entityType": "DOCUMENT",
        "entityId": "doc-1",
        "propertyDefinitionId": "def-1",
        "value": { "string": "x" }
    }})
}

fn realtime_document_data(document_id: &str) -> serde_json::Value {
    serde_json::json!({
        "soupUpdates": [{
            "__typename": "SoupUpdated",
            "item": {
                "__typename": "GraphqlSoupDocument",
                "id": document_id,
                "displayName": "Realtime document",
                "ownerId": "macro|user@example.com",
                "projectId": null,
                "fileType": "md",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-02T00:00:00.000Z"
            }
        }]
    })
}

fn optimistic_document_data(document_id: &str) -> serde_json::Value {
    serde_json::json!({
        "renameEntities": {
            "results": [{
                "__typename": "GraphqlMutationSuccess",
                "effects": [{
                    "__typename": "SoupUpdated",
                    "item": {
                        "__typename": "GraphqlSoupDocument",
                        "id": document_id,
                        "displayName": "Optimistic document",
                        "ownerId": "macro|user@example.com",
                        "projectId": null,
                        "fileType": "md",
                        "createdAt": "2026-01-01T00:00:00.000Z",
                        "updatedAt": "2026-01-03T00:00:00.000Z"
                    }
                }]
            }]
        }
    })
}

fn exact_document_filter(document_id: &str) -> serde_json::Value {
    const NIL_ID: &str = "00000000-0000-0000-0000-000000000000";
    serde_json::json!({
        "filters": {
            "calendarEventFilter": { "literal": { "id": NIL_ID } },
            "documentFilter": { "literal": { "id": document_id } },
            "projectFilter": { "literal": { "projectIdSelf": NIL_ID } },
            "chatFilter": { "literal": { "chatId": NIL_ID } },
            "emailFilter": { "tree": { "literal": { "threadId": NIL_ID } } },
            "channelFilter": { "literal": { "channelId": NIL_ID } },
            "channelThreadFilter": { "literal": { "threadId": NIL_ID } },
            "callFilter": { "literal": { "callId": NIL_ID } },
            "crmCompanyFilter": { "literal": { "id": NIL_ID } },
            "foreignEntityFilter": { "literal": { "id": NIL_ID } }
        },
        "sortMethod": "UPDATED_AT",
        "sortDirection": "DESC",
        "limit": 20
    })
}

async fn fresh_engine(scope: &str) -> CacheEngine {
    destroy_cache(scope.into())
        .await
        .expect("wipe test database");
    open_cache(scope.into(), None).await.expect("open cache")
}

async fn close_and_destroy(engine: &CacheEngine, scope: &str) {
    resolved(engine.close()).await;
    destroy_cache(scope.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn operations_preserve_js_boundary_interner_and_ordering() {
    const SCOPE: &str = "cache-wasm-wp07-operations";
    let engine = fresh_engine(SCOPE).await;
    let vars = variables();

    for operation in ["tab:z", "tab:a"] {
        let read: serde_json::Value = from_js(
            resolved(engine.read_query(
                Some(operation.into()),
                QUERY.into(),
                Some("Soup".into()),
                js(vars.clone()),
                JsValue::UNDEFINED,
            ))
            .await,
        );
        assert_eq!(read["kind"], "miss");
    }

    let write: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(Some("tab:writer")),
            QUERY.into(),
            Some("Soup".into()),
            js(vars.clone()),
            js(soup_data("doc-1")),
            Some("user-1".into()),
        ))
        .await,
    );
    assert_eq!(write["affectedOps"], serde_json::json!(["tab:z", "tab:a"]));
    assert_eq!(write["reset"], false);

    let identity: Option<String> = from_js(resolved(engine.bound_identity()).await);
    assert_eq!(identity.as_deref(), Some("user-1"));

    let selected: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            RECORD_FRAGMENT.into(),
            "CachedDocument".into(),
            js(serde_json::json!(["GraphqlSoupDocument:doc-1"])),
        ))
        .await,
    );
    assert_eq!(
        selected["records"][0]["recordKey"],
        "GraphqlSoupDocument:doc-1"
    );
    assert_eq!(selected["records"][0]["record"]["id"], "doc-1");

    let variants: serde_json::Value = from_js(
        resolved(engine.inspect_query_variants(
            QUERY.into(),
            Some("Soup".into()),
            js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
        ))
        .await,
    );
    assert_eq!(variants[0]["variables"], vars);
    assert!(variants[0].get("value").is_none());

    let inspected: serde_json::Value = from_js(
        resolved(engine.inspect_query(
            QUERY.into(),
            Some("Soup".into()),
            js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
            js(serde_json::json!([])),
        ))
        .await,
    );
    assert_eq!(inspected[0]["variables"], vars);
    assert_eq!(inspected[0]["value"], soup_data("doc-1")["user"]["soup"]);

    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:z".into()),
            QUERY.into(),
            Some("Soup".into()),
            js(vars.clone()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "hit");
    assert_eq!(read["data"], soup_data("doc-1"));
    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:a".into()),
            QUERY.into(),
            Some("Soup".into()),
            js(vars.clone()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "hit");

    let affected: serde_json::Value =
        from_js(resolved(engine.invalidate_keys(vec!["GraphqlSoupDocument:doc-1".into()])).await);
    assert_eq!(
        affected["affectedOps"],
        serde_json::json!(["tab:z", "tab:a"])
    );

    resolved(engine.delete_keys(vec!["GraphqlSoupDocument:doc-1".into()])).await;
    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:z".into()),
            QUERY.into(),
            Some("Soup".into()),
            js(vars),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "miss");

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn realtime_soup_items_are_locally_filterable_without_a_query_fetch() {
    const SCOPE: &str = "cache-wasm-realtime-local-filter";
    const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";
    let engine = fresh_engine(SCOPE).await;

    resolved(engine.write_query(
        write_context(None),
        SOUP_UPDATES_SUBSCRIPTION.into(),
        Some("SoupUpdates".into()),
        js(serde_json::json!({})),
        js(realtime_document_data(DOCUMENT_ID)),
        None,
    ))
    .await;

    // This asks only the local predicate index; no Soup query response has
    // been fetched or written before the realtime item is returned.
    let filtered: serde_json::Value =
        from_js(resolved(engine.entity_filter(js(exact_document_filter(DOCUMENT_ID)))).await);
    assert_eq!(
        filtered,
        serde_json::json!({
            "kind": "complete",
            "revision": "1",
            "keys": [format!("GraphqlSoupDocument:{DOCUMENT_ID}")],
            "optimistic": false
        })
    );

    let selected: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            REALTIME_DOCUMENT_FRAGMENT.into(),
            "RealtimeDocument".into(),
            js(filtered["keys"].clone()),
        ))
        .await,
    );
    assert_eq!(selected["revision"], "1");
    assert_eq!(selected["records"][0]["record"]["id"], DOCUMENT_ID);
    assert_eq!(
        selected["records"][0]["record"]["displayName"],
        "Realtime document"
    );

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn optimistic_soup_item_is_filterable_after_enqueue_reopen_and_rollback() {
    const SCOPE: &str = "cache-wasm-optimistic-local-filter";
    const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000002";
    let engine = fresh_engine(SCOPE).await;

    let enqueue: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            OPTIMISTIC_DOCUMENT_MUTATION.into(),
            Some("RenameEntities".into()),
            js(serde_json::json!({
                "inputs": [{
                    "entity": { "type": "DOCUMENT", "id": DOCUMENT_ID },
                    "displayName": "Optimistic document"
                }]
            })),
            js(optimistic_document_data(DOCUMENT_ID)),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            1.0,
            "optimistic-filter-runner".into(),
            0.0,
            100.0,
        ))
        .await,
    );
    assert_eq!(enqueue["initialClaim"]["kind"], "claimed");
    let transaction_id = enqueue["transactionId"].as_str().unwrap().to_owned();
    let generation = enqueue["initialClaim"]["mutation"]["leaseGeneration"]
        .as_str()
        .unwrap()
        .to_owned();

    let filtered: serde_json::Value =
        from_js(resolved(engine.entity_filter(js(exact_document_filter(DOCUMENT_ID)))).await);
    assert_eq!(filtered["kind"], "complete");
    assert_eq!(
        filtered["keys"],
        serde_json::json!([format!("GraphqlSoupDocument:{DOCUMENT_ID}")])
    );
    assert_eq!(filtered["optimistic"], true);

    resolved(engine.close()).await;
    let reopened = open_cache(SCOPE.into(), None)
        .await
        .expect("reopen preserved optimistic shadow index");
    let filtered: serde_json::Value =
        from_js(resolved(reopened.entity_filter(js(exact_document_filter(DOCUMENT_ID)))).await);
    assert_eq!(
        filtered["keys"],
        serde_json::json!([format!("GraphqlSoupDocument:{DOCUMENT_ID}")])
    );
    assert_eq!(filtered["optimistic"], true);

    resolved(reopened.rollback_optimistic_write(
        transaction_id,
        "optimistic-filter-runner".into(),
        generation,
    ))
    .await;
    let filtered: serde_json::Value =
        from_js(resolved(reopened.entity_filter(js(exact_document_filter(DOCUMENT_ID)))).await);
    assert_eq!(filtered["keys"], serde_json::json!([]));
    assert_eq!(filtered["optimistic"], false);

    close_and_destroy(&reopened, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn entity_resolvers_cross_the_js_boundary() {
    const SCOPE: &str = "cache-wasm-wp07-entity-resolver";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
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
    .await;

    let direct_query = r#"query Email($input: EmailThreadInput!) {
        user { id emailThread(input: $input) { __typename id } }
    }"#;
    let result: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:entity".into()),
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
        .await,
    );
    assert_eq!(result["kind"], "hit");
    assert_eq!(result["data"]["user"]["emailThread"]["id"], "thread-1");

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn queue_and_optimistic_layers_survive_preserve_reopen_in_id_order() {
    const SCOPE: &str = "cache-wasm-wp07-queue-reopen";
    let engine = fresh_engine(SCOPE).await;
    let vars = variables();
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        js(property_base()),
        None,
    ))
    .await;

    let first: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "First" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            1.0,
            "first-owner".into(),
            0.0,
            50.0,
        ))
        .await,
    );
    assert_eq!(first["initialClaim"]["kind"], "claimed");

    let second: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "Second" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            2.0,
            "second-owner".into(),
            0.0,
            50.0,
        ))
        .await,
    );
    assert_eq!(second["initialClaim"]["kind"], "not-runnable");
    let first_id = first["transactionId"].as_str().unwrap().to_owned();
    let second_id = second["transactionId"].as_str().unwrap().to_owned();

    resolved(engine.close()).await;
    let reopened = open_cache(SCOPE.into(), None)
        .await
        .expect("reopen preserved cache");
    let optimistic: serde_json::Value = from_js(
        resolved(reopened.read_query(
            Some("tab:queue".into()),
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(vars.clone()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(
        optimistic["data"]["user"]["soup"]["items"][0]["properties"][0]["displayName"],
        "Second"
    );

    let first_claim: serde_json::Value =
        from_js(resolved(reopened.claim_next_mutation("reopener".into(), 50.0, 100.0)).await);
    assert_eq!(first_claim["transactionId"], first_id);
    resolved(reopened.rollback_optimistic_write(
        first_id,
        "reopener".into(),
        first_claim["leaseGeneration"].as_str().unwrap().into(),
    ))
    .await;

    let second_claim: serde_json::Value =
        from_js(resolved(reopened.claim_next_mutation("reopener".into(), 50.0, 100.0)).await);
    assert_eq!(second_claim["transactionId"], second_id);
    resolved(reopened.rollback_optimistic_write(
        second_id,
        "reopener".into(),
        second_claim["leaseGeneration"].as_str().unwrap().into(),
    ))
    .await;

    let base: serde_json::Value = from_js(
        resolved(reopened.read_query(
            Some("tab:queue".into()),
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(vars),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(
        base["data"]["user"]["soup"]["items"][0]["properties"][0]["displayName"],
        "Status"
    );

    close_and_destroy(&reopened, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn optimistic_commit_reports_affected_ops_and_rejects_settled_or_malformed_ids() {
    const SCOPE: &str = "cache-wasm-wp07-optimistic-commit";
    let engine = fresh_engine(SCOPE).await;
    let vars = variables();
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        js(property_base()),
        None,
    ))
    .await;
    resolved(engine.read_query(
        Some("tab:optimistic".into()),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(vars.clone()),
        JsValue::UNDEFINED,
    ))
    .await;

    let enqueue: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "Stage" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            123.0,
            "runner".into(),
            10.0,
            1_000.0,
        ))
        .await,
    );
    let transaction_id = enqueue["transactionId"].as_str().unwrap().to_owned();
    let generation = enqueue["initialClaim"]["mutation"]["leaseGeneration"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        enqueue["affectedOps"],
        serde_json::json!(["tab:optimistic"])
    );

    let commit: serde_json::Value = from_js(
        resolved(engine.commit_optimistic_write(
            transaction_id.clone(),
            "runner".into(),
            generation.clone(),
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "Stage!" }
            })),
        ))
        .await,
    );
    assert_eq!(
        commit["changed"],
        serde_json::json!(["GraphqlProperty:prop-1"])
    );
    assert_eq!(commit["affectedOps"], serde_json::json!(["tab:optimistic"]));

    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:optimistic".into()),
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(vars),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(
        read["data"]["user"]["soup"]["items"][0]["properties"][0]["displayName"],
        "Stage!"
    );

    assert!(
        JsFuture::from(engine.rollback_optimistic_write(
            transaction_id,
            "runner".into(),
            generation,
        ))
        .await
        .is_err()
    );
    assert!(
        JsFuture::from(engine.rollback_optimistic_write(
            "not-a-number".into(),
            "runner".into(),
            "1".into(),
        ))
        .await
        .is_err()
    );

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn destroy_recovery_wipes_records_and_queue() {
    const SCOPE: &str = "cache-wasm-wp07-destroy";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        Some("user-1".into()),
    ))
    .await;
    resolved(engine.enqueue_optimistic_mutation(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Queued" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "destroy-owner".into(),
        0.0,
        100.0,
    ))
    .await;
    resolved(engine.close()).await;

    destroy_cache(SCOPE.into()).await.expect("recovery wipe");
    let replacement = open_cache(SCOPE.into(), None)
        .await
        .expect("open replacement");
    let read: serde_json::Value = from_js(
        resolved(replacement.read_query(
            None,
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "miss");
    let identity: Option<String> = from_js(resolved(replacement.bound_identity()).await);
    assert_eq!(identity, None);
    let claimed =
        resolved(replacement.claim_next_mutation("replacement".into(), 100.0, 200.0)).await;
    assert!(claimed.is_undefined() || claimed.is_null());

    close_and_destroy(&replacement, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn recovery_open_wipes_existing_data_before_opening_fresh_turso() {
    const SCOPE: &str = "cache-wasm-wp08-recovery-open";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("must-be-wiped")),
        Some("user-1".into()),
    ))
    .await;
    resolved(engine.close()).await;

    let replacement = open_cache_for_recovery(SCOPE.into(), None)
        .await
        .expect("atomic recovery open");
    let read: serde_json::Value = from_js(
        resolved(replacement.read_query(
            None,
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "miss");
    let identity: Option<String> = from_js(resolved(replacement.bound_identity()).await);
    assert_eq!(identity, None);

    close_and_destroy(&replacement, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn incompatible_initialization_resets_and_identity_reset_does_not_latch() {
    const SCOPE: &str = "cache-wasm-wp07-resets";
    let owner = OpfsOwner::acquire(&database_identity(SCOPE))
        .await
        .expect("acquire incompatible database")
        .recovery_wipe()
        .await
        .expect("start incompatible database fresh");
    let OpenResult::Ready(session) = owner.open().await.expect("open incompatible database") else {
        panic!("recovery wipe creates a complete pair")
    };
    let incompatible = TursoStorage::from_opfs_session(
        session.connect().expect("connect incompatible database"),
        "different-scope",
    )
    .expect("initialize incompatible metadata");
    let TursoStorageCloseOutcome::Healthy(closed) = incompatible
        .try_close()
        .expect("close incompatible database")
    else {
        panic!("new incompatible database is otherwise healthy")
    };
    closed
        .preserve()
        .expect("preserve incompatible metadata")
        .release()
        .await
        .expect("release incompatible owner");

    let engine = open_cache(SCOPE.into(), None)
        .await
        .expect("incompatible initialization is reset and reopened");
    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            None,
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "miss");

    let first_identity: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            js(soup_data("identity-a")),
            Some("identity-a".into()),
        ))
        .await,
    );
    assert_eq!(first_identity["reset"], false);
    let normal_identity_reset: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            js(soup_data("identity-b")),
            Some("identity-b".into()),
        ))
        .await,
    );
    assert_eq!(normal_identity_reset["reset"], true);
    let identity: Option<String> = from_js(resolved(engine.bound_identity()).await);
    assert_eq!(identity.as_deref(), Some("identity-b"));

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn storage_reset_errors_latch_and_block_hot_read_write_and_control_methods() {
    const SCOPE: &str = "cache-wasm-wp07-reset-latch";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("reset-latch")),
        Some("identity".into()),
    ))
    .await;
    resolved(engine.invalidate_keys(vec!["GraphqlSoupDocument:reset-latch".into()])).await;
    engine.arm_storage_fault(TestStorageFault::GetBatch).await;

    assert_reset_required(engine.read_query(
        Some("tab:latched".into()),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        JsValue::UNDEFINED,
    ))
    .await;
    assert_reset_required(engine.bound_identity()).await;
    assert_reset_required(engine.invalidate_keys(vec!["GraphqlSoupDocument:any".into()])).await;
    assert_reset_required(engine.external_reset()).await;
    assert_reset_required(engine.teardown_operation("tab:latched".into())).await;
    assert_reset_required(engine.read_query(
        None,
        QUERY.into(),
        Some("Soup".into()),
        JsValue::from_str("malformed variables must not mask the latch"),
        JsValue::UNDEFINED,
    ))
    .await;
    assert_reset_required(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("blocked")),
        None,
    ))
    .await;
    assert_reset_required(engine.clear()).await;

    resolved(engine.physical_reset()).await;
    let identity: Option<String> = from_js(resolved(engine.bound_identity()).await);
    assert_eq!(identity, None);

    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        None,
    ))
    .await;
    engine
        .arm_storage_fault(TestStorageFault::ClaimNextMutation)
        .await;
    assert_reset_required(engine.enqueue_optimistic_mutation(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Nested" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "nested-owner".into(),
        0.0,
        100.0,
    ))
    .await;
    assert_reset_required(engine.bound_identity()).await;

    resolved(engine.physical_reset()).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn physical_reset_serializes_recreates_and_preserves_interner_registration() {
    const SCOPE: &str = "cache-wasm-wp07-physical-reset";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        None,
    ))
    .await;
    resolved(engine.read_query(
        Some("tab:retained".into()),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        JsValue::UNDEFINED,
    ))
    .await;
    let retained_id = *engine
        .ops
        .borrow()
        .by_name
        .get("tab:retained")
        .expect("operation is interned before reset");
    resolved(engine.enqueue_optimistic_mutation(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Queued" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "reset-owner".into(),
        0.0,
        100.0,
    ))
    .await;

    let concurrent = js_sys::Array::new();
    concurrent.push(&engine.physical_reset());
    concurrent.push(&engine.write_query(
        write_context(None),
        PROPERTY_QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(property_base()),
        None,
    ));
    JsFuture::from(js_sys::Promise::all(&concurrent))
        .await
        .expect("concurrent call waits for physical reset and uses the replacement");

    assert_eq!(
        engine.ops.borrow().by_name.get("tab:retained"),
        Some(&retained_id)
    );
    let claimed = resolved(engine.claim_next_mutation("replacement".into(), 100.0, 200.0)).await;
    assert!(claimed.is_undefined() || claimed.is_null());

    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            Some("tab:retained".into()),
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["kind"], "hit");
    let write: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(Some("tab:writer")),
            PROPERTY_QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            js(property_data("Updated")),
            None,
        ))
        .await,
    );
    assert_eq!(write["affectedOps"], serde_json::json!(["tab:retained"]));

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn zero_hot_capacity_rejects_before_opfs_and_does_not_leak_the_lock() {
    const SCOPE: &str = "cache-wasm-wp07-zero-capacity";
    destroy_cache(SCOPE.into())
        .await
        .expect("clean capacity test");
    let error = match open_cache(SCOPE.into(), Some(0)).await {
        Ok(_) => panic!("zero capacity must reject"),
        Err(error) => error,
    };
    assert!(error.is_instance_of::<js_sys::Error>());
    let message = js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .unwrap()
        .as_string()
        .unwrap();
    assert_eq!(message, "hot capacity must be greater than zero");

    let engine = open_cache(SCOPE.into(), Some(1))
        .await
        .expect("valid open succeeds after rejected capacity");
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn every_method_rejects_after_consuming_close() {
    const SCOPE: &str = "cache-wasm-wp07-closed";
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.close()).await;

    assert_closed(engine.bound_identity()).await;
    assert_closed(engine.read_query(
        None,
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        JsValue::UNDEFINED,
    ))
    .await;
    assert_closed(engine.read_records_by_keys(
        RECORD_FRAGMENT.into(),
        "CachedDocument".into(),
        js(serde_json::json!(["GraphqlSoupDocument:doc-1"])),
    ))
    .await;
    assert_closed(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("closed")),
        None,
    ))
    .await;
    assert_closed(engine.enqueue_optimistic_mutation(
        None,
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Closed" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "closed".into(),
        1.0,
        2.0,
    ))
    .await;
    assert_closed(engine.inspect_query_variants(
        QUERY.into(),
        Some("Soup".into()),
        js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
    ))
    .await;
    assert_closed(engine.inspect_query(
        QUERY.into(),
        Some("Soup".into()),
        js(serde_json::json!([{"field": "user"}, {"field": "soup"}])),
        js(serde_json::json!([])),
    ))
    .await;
    assert_closed(engine.claim_next_mutation("closed".into(), 1.0, 2.0)).await;
    assert_closed(engine.defer_optimistic_write(
        "1".into(),
        "closed".into(),
        "1".into(),
        2.0,
        "closed".into(),
    ))
    .await;
    assert_closed(engine.commit_optimistic_write(
        "1".into(),
        "closed".into(),
        "1".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Closed" }
        })),
    ))
    .await;
    assert_closed(engine.rollback_optimistic_write("1".into(), "closed".into(), "1".into())).await;
    assert_closed(engine.invalidate_keys(vec!["GraphqlSoupDocument:1".into()])).await;
    assert_closed(engine.delete_keys(vec!["GraphqlSoupDocument:1".into()])).await;
    assert_closed(engine.refresh_optimistic_queue()).await;
    assert_closed(engine.external_reset()).await;
    assert_closed(engine.teardown_operation("closed:1".into())).await;
    assert_closed(engine.clear()).await;
    assert_closed(engine.physical_reset()).await;
    assert_closed(engine.close()).await;

    destroy_cache(SCOPE.into())
        .await
        .expect("destroy closed cache");
}

#[wasm_bindgen_test(async)]
async fn calls_serialize_and_owner_lock_excludes_a_second_open() {
    const SCOPE: &str = "cache-wasm-wp07-serialization-lock";
    let engine = fresh_engine(SCOPE).await;
    assert!(open_cache(SCOPE.into(), None).await.is_err());

    let writes = js_sys::Array::new();
    writes.push(&engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("first")),
        None,
    ));
    writes.push(&engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("second")),
        None,
    ));
    JsFuture::from(js_sys::Promise::all(&writes))
        .await
        .expect("overlapping calls serialize without reentrancy");

    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            None,
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(read["data"], soup_data("second"));

    resolved(engine.close()).await;
    let reopened = open_cache(SCOPE.into(), None)
        .await
        .expect("close releases owner lock");
    close_and_destroy(&reopened, SCOPE).await;
}
