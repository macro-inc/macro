use super::*;
use cache_core::predicate::{ProjectionIncompleteKind, ProjectionState};
use cache_core::store::Storage;
use predicate_index::{ExactValue, RecordKey, Token};
use serde::de::DeserializeOwned;
use soup_filter_projection::{SoupCacheProjectionSupplement, encode_cache_projection_supplement};
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_dedicated_worker);

mod hydration_scope;
mod mail_projection;
mod migration_cost;
mod people;

#[wasm_bindgen_test]
fn read_response_conversion_preserves_json_and_revision_strings() {
    let data = serde_json::json!({
        "text": "line\n\"quoted\" 🙂",
        "nested": [null, true, {"value": 1.25}],
        "maxInteger": 9_007_199_254_740_991_i64,
        "minInteger": -9_007_199_254_740_991_i64,
        "largeFloat": 15_588_948_318_755_801_000_f64,
        "negativeZero": -0.0_f64,
    });
    let hit = JsReadResult::Hit { data: data.clone() };
    let actual = read_response_to_js(&hit, [&data]).unwrap();
    assert_eq!(
        js_sys::JSON::stringify(&actual).unwrap(),
        js_sys::JSON::stringify(&to_js(&hit).unwrap()).unwrap()
    );
    let js_data = js_sys::Reflect::get(&actual, &"data".into()).unwrap();
    assert!(js_sys::Object::is(
        &js_sys::Reflect::get(&js_data, &"negativeZero".into()).unwrap(),
        &JsValue::from_f64(-0.0)
    ));
    assert_eq!(
        js_sys::Reflect::get(&js_data, &"largeFloat".into())
            .unwrap()
            .as_f64(),
        Some(15_588_948_318_755_801_000_f64)
    );
    let records = JsRecordSelectionResult {
        revision: u64::MAX.to_string(),
        records: vec![cache_core::record_selection::SelectedRecord {
            identity: cache_core::identity::IdentityStatus {
                mutation_uuid: None,
                pending: false,
            },
            record_key: EntityKey("Thing:one".into()),
            record: data,
        }],
    };
    assert_eq!(
        js_sys::JSON::stringify(
            &read_response_to_js(&records, records.records.iter().map(|r| &r.record)).unwrap()
        )
        .unwrap(),
        js_sys::JSON::stringify(&to_js(&records).unwrap()).unwrap()
    );
    assert_eq!(
        js_sys::JSON::stringify(
            &read_response_to_js(&JsReadResult::Miss, std::iter::empty()).unwrap()
        )
        .unwrap(),
        js_sys::JSON::stringify(&to_js(&JsReadResult::Miss).unwrap()).unwrap()
    );
}

#[wasm_bindgen_test]
fn read_response_conversion_preserves_unsafe_integer_errors() {
    for number in [
        serde_json::json!(9_007_199_254_740_992_u64),
        serde_json::json!(-9_007_199_254_740_992_i64),
        serde_json::json!(i64::MIN),
        serde_json::json!(u64::MAX),
    ] {
        let data = serde_json::json!({"nested": [{"value": number}]});
        let response = JsReadResult::Hit { data: data.clone() };
        assert_eq!(
            read_response_to_js(&response, [&data])
                .unwrap_err()
                .as_string(),
            to_js(&response).unwrap_err().as_string()
        );
    }
}

#[wasm_bindgen_test]
fn watch_patches_reject_unsafe_integers_like_hits() {
    use cache_core::engine::live_query::{LiveFieldPatch, ResponsePathSegment};
    use cache_core::engine::watch_query::QueryUpdate;
    let value = serde_json::json!({"nested": [{"value": 9_007_199_254_740_992_u64}]});
    let hit = QueryUpdate::Hit {
        data: std::sync::Arc::new(value.clone()),
        revision: "1".into(),
    };
    let patch = QueryUpdate::Patch {
        patches: vec![LiveFieldPatch {
            path: vec![ResponsePathSegment::Field("payload".into())],
            value,
        }],
        revision: "2".into(),
    };
    for update in [&hit, &patch] {
        assert_eq!(
            read_response_to_js(update, query_update_values(update))
                .unwrap_err()
                .as_string(),
            to_js(update).unwrap_err().as_string()
        );
    }
}

#[wasm_bindgen_test]
fn build_info_reports_compiled_versions_without_opening_storage() {
    let info: serde_json::Value =
        serde_wasm_bindgen::from_value(cache_build_info().unwrap()).unwrap();
    assert_eq!(info["packageVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(info["schemaHash"], schema_hash());
    assert_eq!(
        info["schemaCompatibilityEpoch"],
        cache_core::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH
    );
    assert_eq!(
        info["formatVersion"],
        cache_core::codec::CACHE_FORMAT_VERSION
    );
    assert_eq!(
        info["storageSchemaVersion"],
        cache_turso::STORAGE_SCHEMA_VERSION
    );
}

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

const SOUP_WITH_PROJECTION_QUERY: &str = r#"query SoupWithProjection($input: SoupInput!) {
    user {
        id
        soup(input: $input) {
            nextCursor
            items {
                isFavorited
                properties { id propertyDefinitionId value { __typename ... on GraphqlSelectOptionPropertyValue { optionIds } } }
                __typename
                id
                cacheProjection @cacheOnly
                notifications { id entityId entityType state }
                displayName
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                    subType { __typename }
                }
            }
        }
    }
}"#;

const SOUP_BACKFILL_WITH_PROJECTION_QUERY: &str = r#"query SoupBackfill($input: SoupInput!) {
    user {
        id
        soup(input: $input) {
            nextCursor
            items {
                isFavorited
                properties { id propertyDefinitionId value { __typename ... on GraphqlSelectOptionPropertyValue { optionIds } } }
                __typename
                id
                cacheProjection @cacheOnly
                notifications { id entityId entityType state }
                displayName
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                    subType { __typename }
                }
            }
        }
    }
}"#;

const SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION: &str = r#"subscription SoupUpdatesWithProjection {
    soupUpdates {
        __typename
        ... on SoupUpdated {
            item {
                isFavorited
                properties { id propertyDefinitionId value { __typename ... on GraphqlSelectOptionPropertyValue { optionIds } } }
                __typename
                id
                cacheProjection @cacheOnly
                notifications { id entityId entityType state }
                displayName
                ... on GraphqlSoupDocument {
                    ownerId
                    projectId
                    fileType
                    createdAt
                    updatedAt
                    subType { __typename }
                }
            }
        }
    }
}"#;

const PARTIAL_DOCUMENT_MUTATION: &str = r#"mutation PartialRename($inputs: [RenameEntityInput!]!) {
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
                            ... on GraphqlSoupDocument { ownerId }
                        }
                    }
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

fn empty_js_write_result() -> JsWriteResult {
    JsWriteResult {
        unchanged_views: None,
        field_changes: None,
        identity_errors: Vec::new(),
        mutation_uuid: None,
        revision: "0".to_string(),
        revision_advanced: false,
        search_changed_buckets: None,
        changed: Vec::new(),
        affected_ops: Vec::new(),
        reset: false,
        revalidations: Vec::new(),
    }
}

#[wasm_bindgen_test]
fn tagged_wire_enum_fields_are_camel_case() {
    let mut committed = empty_js_write_result();
    committed
        .identity_errors
        .push("missing identity response object".into());
    let value =
        serde_json::to_value(JsCommitOptimisticWriteResult::Committed { result: committed })
            .unwrap();
    assert_eq!(value["kind"], "committed");
    assert_eq!(
        value["identityErrors"],
        serde_json::json!(["missing identity response object"])
    );
    assert_eq!(
        serde_json::to_value(JsMutationUpsertKind::ReplacedPending {
            removed_transaction_id: "1".to_string(),
        })
        .unwrap(),
        serde_json::json!({"kind": "replaced-pending", "removedTransactionId": "1"})
    );
    assert_eq!(
        serde_json::to_value(JsMutationUpsertKind::AppendedAfterActive {
            active_transaction_id: "2".to_string(),
        })
        .unwrap(),
        serde_json::json!({"kind": "appended-after-active", "activeTransactionId": "2"})
    );
    assert_eq!(
        serde_json::to_value(JsDeferOptimisticWriteResult::DiscardedSuperseded {
            replacement_transaction_id: "3".to_string(),
            result: empty_js_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "3"
    );
    assert_eq!(
        serde_json::to_value(JsCommitOptimisticWriteResult::CommittedSuperseded {
            replacement_transaction_id: "4".to_string(),
            result: empty_js_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "4"
    );
    assert_eq!(
        serde_json::to_value(JsRollbackOptimisticWriteResult::DiscardedSuperseded {
            replacement_transaction_id: "5".to_string(),
            result: empty_js_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "5"
    );
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

fn v3_document_supplement(
    document_id: &str,
    is_email_attachment: bool,
    is_important: bool,
    status_option_ids: Vec<uuid::Uuid>,
) -> String {
    encode_cache_projection_supplement(&SoupCacheProjectionSupplement::document(
        RecordKey::new(format!("GraphqlSoupDocument:{document_id}")).unwrap(),
        is_email_attachment,
        is_important,
        status_option_ids,
    ))
    .unwrap()
}

fn projected_document_item(
    document_id: &str,
    owner: &str,
    is_email_attachment: bool,
    sub_type: Option<&str>,
    updated_at: i64,
) -> serde_json::Value {
    projected_document_item_with_facts(
        document_id,
        owner,
        is_email_attachment,
        true,
        Vec::new(),
        sub_type,
        updated_at,
    )
}

fn projected_document_item_with_facts(
    document_id: &str,
    owner: &str,
    is_email_attachment: bool,
    is_important: bool,
    status_option_ids: Vec<uuid::Uuid>,
    sub_type: Option<&str>,
    updated_at: i64,
) -> serde_json::Value {
    let sub_type = sub_type.map(|sub_type| {
        let typename = match sub_type {
            "task" => "GraphqlTaskSubType",
            "snippet" => "GraphqlSnippetSubType",
            "skill" => "GraphqlSkillSubType",
            value => panic!("unsupported test subtype {value}"),
        };
        serde_json::json!({ "__typename": typename })
    });
    serde_json::json!({
        "__typename": "GraphqlSoupDocument",
        "id": document_id,
        "notifications": [],
        "isFavorited": false,
        "properties": if status_option_ids.is_empty() { serde_json::json!([]) } else { serde_json::json!([{
            "id": format!("status:{document_id}"),
            "propertyDefinitionId": "00000001-0000-0000-0000-000000000002",
            "value": {"__typename":"GraphqlSelectOptionPropertyValue", "optionIds": status_option_ids},
        }]) },
        "cacheProjection": v3_document_supplement(
            document_id,
            is_email_attachment,
            is_important,
            status_option_ids,
        ),
        "displayName": format!("Document {document_id}"),
        "ownerId": owner,
        "projectId": null,
        "fileType": "md",
        "createdAt": format!("2025-01-01T00:00:00.{:06}Z", updated_at - 1),
        "updatedAt": format!("2025-01-01T00:00:00.{updated_at:06}Z"),
        "subType": sub_type,
    })
}

fn projected_realtime_document_data(
    document_id: &str,
    is_email_attachment: bool,
) -> serde_json::Value {
    serde_json::json!({
        "soupUpdates": [{
            "__typename": "SoupUpdated",
            "item": projected_document_item(
                document_id,
                "macro|user@example.com",
                is_email_attachment,
                None,
                2,
            ),
        }]
    })
}

fn partial_document_mutation_data(document_id: &str) -> serde_json::Value {
    serde_json::json!({
        "renameEntities": {
            "results": [{
                "__typename": "GraphqlMutationSuccess",
                "effects": [{
                    "__typename": "SoupUpdated",
                    "item": {
                        "__typename": "GraphqlSoupDocument",
                        "id": document_id,
                        "displayName": "Mutation document",
                        "ownerId": "macro|user@example.com"
                    }
                }]
            }]
        }
    })
}

async fn projection_state(engine: &CacheEngine, key: &str) -> ProjectionState {
    let state = engine.state.lock().await;
    let storage = state
        .engine
        .as_ref()
        .expect("open cache has an engine")
        .storage();
    storage
        .load_projection_states(&[RecordKey::new(key).unwrap()])
        .await
        .unwrap()
        .into_iter()
        .next()
        .flatten()
        .expect("projection state exists")
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

fn documents_preset_filter(document_filter: serde_json::Value) -> serde_json::Value {
    const NIL_ID: &str = "00000000-0000-0000-0000-000000000000";
    serde_json::json!({
        "filters": {
            "calendarEventFilter": { "literal": { "id": NIL_ID } },
            "documentFilter": document_filter,
            "projectFilter": { "literal": { "projectId": NIL_ID } },
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
        "limit": 100
    })
}

fn my_tasks_filter(owner: &str) -> serde_json::Value {
    const NIL_ID: &str = "00000000-0000-0000-0000-000000000000";
    const STATUS_PROPERTY_ID: &str = "00000001-0000-0000-0000-000000000002";
    serde_json::json!({
        "filters": {
            "calendarEventFilter": { "literal": { "id": NIL_ID } },
            "documentFilter": {
                "and": {
                    "left": { "literal": { "subType": "TASK" } },
                    "right": {
                        "or": {
                            "left": { "literal": { "owner": owner } },
                            "right": { "literal": { "importance": true } }
                        }
                    }
                }
            },
            "projectFilter": { "literal": { "projectId": NIL_ID } },
            "chatFilter": { "literal": { "chatId": NIL_ID } },
            "emailFilter": { "tree": { "literal": { "threadId": NIL_ID } } },
            "channelFilter": { "literal": { "channelId": NIL_ID } },
            "channelThreadFilter": { "literal": { "threadId": NIL_ID } },
            "callFilter": { "literal": { "callId": NIL_ID } },
            "crmCompanyFilter": { "literal": { "id": NIL_ID } },
            "foreignEntityFilter": { "literal": { "id": NIL_ID } },
            "propertiesFilter": {
                "or": {
                    "left": {
                        "literal": {
                            "propertyDefinitionId": STATUS_PROPERTY_ID,
                            "value": {
                                "selectOption": "00000001-0000-0000-0002-000000000001"
                            }
                        }
                    },
                    "right": {
                        "or": {
                            "left": {
                                "literal": {
                                    "propertyDefinitionId": STATUS_PROPERTY_ID,
                                    "value": {
                                        "selectOption": "00000001-0000-0000-0002-000000000002"
                                    }
                                }
                            },
                            "right": {
                                "literal": {
                                    "propertyDefinitionId": STATUS_PROPERTY_ID,
                                    "value": {
                                        "selectOption": "00000001-0000-0000-0002-000000000003"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "sortMethod": "UPDATED_AT",
        "sortDirection": "DESC",
        "limit": 100
    })
}

fn production_documents_preset_filters() -> Vec<(&'static str, serde_json::Value)> {
    let owner = "macro|user@example.com";
    let not_task = serde_json::json!({
        "not": { "literal": { "subType": "TASK" } }
    });
    let not_task_or_snippet = serde_json::json!({
        "not": {
            "or": {
                "left": { "literal": { "subType": "TASK" } },
                "right": { "literal": { "subType": "SNIPPET" } }
            }
        }
    });

    vec![
        (
            "owned/snippets-on",
            documents_preset_filter(serde_json::json!({
                "and": {
                    "left": not_task.clone(),
                    "right": {
                        "and": {
                            "left": { "literal": { "owner": owner } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            })),
        ),
        (
            "owned/snippets-off",
            documents_preset_filter(serde_json::json!({
                "and": {
                    "left": not_task_or_snippet.clone(),
                    "right": {
                        "and": {
                            "left": { "literal": { "owner": owner } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            })),
        ),
        (
            "shared/snippets-on",
            documents_preset_filter(serde_json::json!({
                "and": {
                    "left": not_task.clone(),
                    "right": {
                        "and": {
                            "left": { "not": { "literal": { "owner": owner } } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            })),
        ),
        (
            "shared/snippets-off",
            documents_preset_filter(serde_json::json!({
                "and": {
                    "left": not_task_or_snippet.clone(),
                    "right": {
                        "and": {
                            "left": { "not": { "literal": { "owner": owner } } },
                            "right": { "literal": { "isEmailAttachment": false } }
                        }
                    }
                }
            })),
        ),
        (
            "attachments/snippets-on",
            documents_preset_filter(
                serde_json::json!({ "literal": { "isEmailAttachment": true } }),
            ),
        ),
        (
            "attachments/snippets-off",
            documents_preset_filter(
                serde_json::json!({ "literal": { "isEmailAttachment": true } }),
            ),
        ),
        ("all/snippets-on", documents_preset_filter(not_task)),
        (
            "all/snippets-off",
            documents_preset_filter(not_task_or_snippet),
        ),
    ]
}

async fn test_generation(engine: &CacheEngine) -> Option<String> {
    let authority: serde_json::Value =
        from_js(resolved(engine.current_authority("test-authority".into())).await);
    Some(authority["generation"].as_str().unwrap().to_owned())
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
async fn soup_updated_v3_supplements_advance_revision_and_recompute_documents_presets_locally() {
    const SCOPE: &str = "cache-wasm-realtime-documents-v3";
    const OWNER: &str = "macro|user@example.com";
    const OTHER_OWNER: &str = "macro|shared@example.com";
    const INITIAL: &str = "00000000-0000-0000-0000-000000000001";
    const ORDINARY: &str = "00000000-0000-0000-0000-000000000002";
    const SHARED: &str = "00000000-0000-0000-0000-000000000003";
    const ATTACHMENT: &str = "00000000-0000-0000-0000-000000000004";
    const TASK: &str = "00000000-0000-0000-0000-000000000005";
    const SNIPPET: &str = "00000000-0000-0000-0000-000000000006";
    const SKILL: &str = "00000000-0000-0000-0000-000000000007";
    let key = |id| format!("GraphqlSoupDocument:{id}");
    let engine = fresh_engine(SCOPE).await;

    let network_write: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            SOUP_WITH_PROJECTION_QUERY.into(),
            Some("SoupWithProjection".into()),
            js(serde_json::json!({ "input": { "limit": 100 } })),
            js(serde_json::json!({
                "user": {
                    "id": "user-1",
                    "soup": {
                        "nextCursor": null,
                        "items": [projected_document_item(INITIAL, OWNER, false, None, 10)]
                    }
                }
            })),
            Some("user-1".into()),
        ))
        .await,
    );
    assert_eq!(network_write["revision"], "1");

    let updates = [
        projected_document_item(ORDINARY, OWNER, false, None, 20),
        projected_document_item(SHARED, OTHER_OWNER, false, None, 30),
        projected_document_item(ATTACHMENT, OWNER, true, None, 40),
        projected_document_item(TASK, OWNER, false, Some("task"), 50),
        projected_document_item(SNIPPET, OWNER, false, Some("snippet"), 60),
        projected_document_item(SKILL, OWNER, false, Some("skill"), 70),
    ]
    .into_iter()
    .map(|item| serde_json::json!({ "__typename": "SoupUpdated", "item": item }))
    .collect::<Vec<_>>();
    let subscription_write: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
            Some("SoupUpdatesWithProjection".into()),
            js(serde_json::json!({})),
            js(serde_json::json!({ "soupUpdates": updates })),
            None,
        ))
        .await,
    );
    assert_eq!(subscription_write["revision"], "2");

    // After the one initial Soup response, every membership result below is
    // recomputed only through the real WASM/Turso predicate index. No second
    // Soup query response is executed or written after the subscription.
    for (name, request) in production_documents_preset_filters() {
        let expected = match name {
            "owned/snippets-on" => vec![key(SKILL), key(SNIPPET), key(ORDINARY), key(INITIAL)],
            "owned/snippets-off" => vec![key(SKILL), key(ORDINARY), key(INITIAL)],
            "shared/snippets-on" | "shared/snippets-off" => vec![key(SHARED)],
            "attachments/snippets-on" | "attachments/snippets-off" => {
                vec![key(ATTACHMENT)]
            }
            "all/snippets-on" => vec![
                key(SKILL),
                key(SNIPPET),
                key(ATTACHMENT),
                key(SHARED),
                key(ORDINARY),
                key(INITIAL),
            ],
            "all/snippets-off" => vec![
                key(SKILL),
                key(ATTACHMENT),
                key(SHARED),
                key(ORDINARY),
                key(INITIAL),
            ],
            _ => panic!("unexpected Documents preset fixture {name}"),
        };
        let filtered: serde_json::Value =
            from_js(resolved(engine.entity_filter(js(request))).await);
        assert_eq!(
            filtered,
            serde_json::json!({
                "kind": "complete",
                "revision": "2",
                "keys": expected,
                "optimistic": false,
            }),
            "{name}"
        );
    }

    for (id, expected) in [(TASK, "task"), (SNIPPET, "snippet"), (SKILL, "skill")] {
        let ProjectionState::Complete(document) = projection_state(&engine, &key(id)).await else {
            panic!("GraphQL subtype {expected} must compose a complete projection");
        };
        assert!(document.exact_facts.iter().any(|fact| {
            fact.attribute == Token::new("document-sub-type").unwrap()
                && fact.value == ExactValue::utf8(expected).unwrap()
        }));
    }

    let selected: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            REALTIME_DOCUMENT_FRAGMENT.into(),
            "RealtimeDocument".into(),
            js(serde_json::json!([key(ORDINARY)])),
        ))
        .await,
    );
    assert_eq!(selected["revision"], "2");
    assert_eq!(selected["records"][0]["record"]["id"], ORDINARY);

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn server_baseline_reconciliation_survives_notification_stubs_and_deletions() {
    const SCOPE: &str = "cache-wasm-server-baseline-reconciliation";
    const A: &str = "00000000-0000-0000-0000-000000000001";
    const B: &str = "00000000-0000-0000-0000-000000000002";
    const STUB: &str = "00000000-0000-0000-0000-000000000003";
    let key = |id| format!("GraphqlSoupDocument:{id}");
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(serde_json::json!({"input": {"initial": {"limit": 100}}})),
        js(
            serde_json::json!({"user": {"id": "macro|user@example.com", "soup": {
                "nextCursor": null, "items": [{"__typename": "GraphqlSoupDocument", "id": STUB}]
            }}}),
        ),
        None,
    ))
    .await;
    resolved(engine.write_query(
        write_context(None), SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
        Some("SoupUpdatesWithProjection".into()), js(serde_json::json!({})),
        js(serde_json::json!({"soupUpdates": [
            {"__typename": "SoupUpdated", "item": projected_document_item(A, "macro|user@example.com", false, None, 10)},
            {"__typename": "SoupUpdated", "item": projected_document_item(B, "macro|user@example.com", false, None, 30)}
        ]})), None,
    )).await;
    let mut request = documents_preset_filter(
        serde_json::json!({"literal": {"owner": "macro|user@example.com"}}),
    );
    request["limit"] = serde_json::json!(1);
    let exact: serde_json::Value =
        from_js(resolved(engine.entity_filter(js(request.clone()))).await);
    assert_eq!(exact["kind"], "incomplete");
    request["baseline"] = serde_json::json!([
        {"key": key(A), "sortTimestamp": "2025-01-01T00:00:00.000010Z"},
        {"key": key(STUB), "sortTimestamp": "2025-01-01T00:00:00.000020Z"}
    ]);
    let result: serde_json::Value =
        from_js(resolved(engine.entity_filter(js(request.clone()))).await);
    assert_eq!(
        result,
        serde_json::json!({"kind": "reconciled", "revision": "2", "keys": [key(B), key(STUB), key(A)], "retainedKeys": [key(STUB)], "optimistic": false})
    );
    resolved(engine.delete_keys(vec![key(A), key(STUB)])).await;
    let deleted: serde_json::Value = from_js(resolved(engine.entity_filter(js(request))).await);
    assert_eq!(deleted["keys"], serde_json::json!([key(B)]));
    assert_eq!(deleted["retainedKeys"], serde_json::json!([]));
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn soup_updated_v3_recomputes_my_tasks_importance_and_status_locally() {
    const SCOPE: &str = "cache-wasm-realtime-my-tasks-v3";
    const VIEWER: &str = "macro|viewer@example.com";
    const OWNER_TASK: &str = "00000000-0000-0000-0000-000000000011";
    const ASSIGNED_TASK: &str = "00000000-0000-0000-0000-000000000012";
    const COMPLETED_TASK: &str = "00000000-0000-0000-0000-000000000013";
    let status =
        |suffix| uuid::Uuid::parse_str(&format!("00000001-0000-0000-0002-{suffix:012}")).unwrap();
    let key = |id| format!("GraphqlSoupDocument:{id}");
    let engine = fresh_engine(SCOPE).await;

    let initial: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            SOUP_WITH_PROJECTION_QUERY.into(),
            Some("SoupWithProjection".into()),
            js(serde_json::json!({ "input": { "limit": 100 } })),
            js(serde_json::json!({
                "user": {
                    "id": "user-1",
                    "soup": {
                        "nextCursor": null,
                        "items": [projected_document_item_with_facts(
                            OWNER_TASK,
                            VIEWER,
                            false,
                            false,
                            vec![status(1)],
                            Some("task"),
                            10,
                        )]
                    }
                }
            })),
            Some("user-1".into()),
        ))
        .await,
    );
    let initial_revision = initial["revision"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    assert!(initial_revision > 0);
    assert_eq!(initial["revisionAdvanced"], true);

    let updates = [
        projected_document_item_with_facts(
            ASSIGNED_TASK,
            "macro|other@example.com",
            false,
            true,
            vec![status(2)],
            Some("task"),
            30,
        ),
        projected_document_item_with_facts(
            COMPLETED_TASK,
            "macro|other@example.com",
            false,
            true,
            vec![status(4)],
            Some("task"),
            20,
        ),
    ]
    .into_iter()
    .map(|item| serde_json::json!({ "__typename": "SoupUpdated", "item": item }))
    .collect::<Vec<_>>();
    let realtime: serde_json::Value = from_js(
        resolved(engine.write_query(
            write_context(None),
            SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
            Some("SoupUpdatesWithProjection".into()),
            js(serde_json::json!({})),
            js(serde_json::json!({ "soupUpdates": updates })),
            None,
        ))
        .await,
    );
    let realtime_revision = realtime["revision"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    // Property-owner metadata can advance the revision separately from the
    // normalized write. Filtering must report the final committed revision.
    assert!(realtime_revision > initial_revision);
    assert_eq!(realtime["revisionAdvanced"], true);

    let filtered: serde_json::Value =
        from_js(resolved(engine.entity_filter(js(my_tasks_filter(VIEWER)))).await);
    assert_eq!(
        filtered,
        serde_json::json!({
            "kind": "complete",
            "revision": realtime["revision"],
            "keys": [key(ASSIGNED_TASK), key(OWNER_TASK)],
            "optimistic": false,
        })
    );

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn backfill_supplement_failure_does_not_commit_or_advance_revision() {
    const SCOPE: &str = "cache-wasm-backfill-supplement-checkpoint";
    const FIRST: &str = "00000000-0000-0000-0000-000000000001";
    const INVALID: &str = "00000000-0000-0000-0000-000000000002";
    let engine = fresh_engine(SCOPE).await;

    let hydrated: serde_json::Value = from_js(
        resolved(engine.hydrate_query(
            SOUP_BACKFILL_WITH_PROJECTION_QUERY.into(),
            Some("SoupBackfill".into()),
            js(serde_json::json!({ "input": { "initial": { "limit": 1 } } })),
            js(serde_json::json!({
                "user": {
                    "id": "user-1",
                    "soup": {
                        "nextCursor": "next",
                        "items": [projected_document_item(
                            FIRST,
                            "macro|user@example.com",
                            false,
                            None,
                            10,
                        )]
                    }
                }
            })),
            Some("user-1".into()),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    assert_eq!(hydrated["revision"], "1");

    let error = JsFuture::from(engine.hydrate_query(
        SOUP_BACKFILL_WITH_PROJECTION_QUERY.into(),
        Some("SoupBackfill".into()),
        js(serde_json::json!({ "input": { "initial": { "limit": 1 } } })),
        js(serde_json::json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "nextCursor": null,
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": INVALID,
                        "cacheProjection": null,
                        "displayName": "Invalid backfill item",
                        "ownerId": "macro|user@example.com"
                    }]
                }
            }
        })),
        Some("user-1".into()),
        JsValue::UNDEFINED,
    ))
    .await
    .expect_err("invalid required backfill supplement rejects before storage");
    let message = js_sys::Reflect::get(&error, &JsValue::from_str("message"))
        .expect("Error.message")
        .as_string()
        .expect("message is a string");
    assert_eq!(
        message,
        "SoupBackfill page contains an incomplete required cache projection"
    );
    assert_eq!(
        resolved(engine.current_revision())
            .await
            .as_string()
            .unwrap(),
        "1"
    );

    let selected: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            REALTIME_DOCUMENT_FRAGMENT.into(),
            "RealtimeDocument".into(),
            js(serde_json::json!([format!(
                "GraphqlSoupDocument:{INVALID}"
            )])),
        ))
        .await,
    );
    assert!(selected["records"].as_array().unwrap().is_empty());

    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn supplement_and_partial_mutation_ordering_preserve_complete_server_facts() {
    const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";
    let key = format!("GraphqlSoupDocument:{DOCUMENT_ID}");
    let mutation_variables = serde_json::json!({
        "inputs": [{
            "entity": { "type": "DOCUMENT", "id": DOCUMENT_ID },
            "displayName": "Mutation document"
        }]
    });

    let subscription_first = fresh_engine("cache-wasm-supplement-order-subscription-first").await;
    let subscription_write: serde_json::Value = from_js(
        resolved(subscription_first.write_query(
            write_context(None),
            SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
            Some("SoupUpdatesWithProjection".into()),
            js(serde_json::json!({})),
            js(projected_realtime_document_data(DOCUMENT_ID, true)),
            None,
        ))
        .await,
    );
    assert_eq!(subscription_write["revision"], "1");
    let mutation_write: serde_json::Value = from_js(
        resolved(subscription_first.write_query(
            write_context(None),
            PARTIAL_DOCUMENT_MUTATION.into(),
            Some("PartialRename".into()),
            js(mutation_variables.clone()),
            js(partial_document_mutation_data(DOCUMENT_ID)),
            None,
        ))
        .await,
    );
    assert_eq!(mutation_write["revision"], "2");
    let ProjectionState::Complete(after_patch) = projection_state(&subscription_first, &key).await
    else {
        panic!("a direct-field patch over a composed projection must stay complete");
    };
    assert!(after_patch.exact_facts.iter().any(|fact| {
        fact.attribute == Token::new("email-attachment").unwrap()
            && fact.value == ExactValue::new([1]).unwrap()
    }));
    close_and_destroy(
        &subscription_first,
        "cache-wasm-supplement-order-subscription-first",
    )
    .await;

    let mutation_first = fresh_engine("cache-wasm-supplement-order-mutation-first").await;
    resolved(mutation_first.write_query(
        write_context(None),
        PARTIAL_DOCUMENT_MUTATION.into(),
        Some("PartialRename".into()),
        js(mutation_variables),
        js(partial_document_mutation_data(DOCUMENT_ID)),
        None,
    ))
    .await;
    assert!(matches!(
        projection_state(&mutation_first, &key).await,
        ProjectionState::Incomplete {
            kind: ProjectionIncompleteKind::Missing,
            ..
        }
    ));
    let subscription_write: serde_json::Value = from_js(
        resolved(mutation_first.write_query(
            write_context(None),
            SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
            Some("SoupUpdatesWithProjection".into()),
            js(serde_json::json!({})),
            js(projected_realtime_document_data(DOCUMENT_ID, true)),
            None,
        ))
        .await,
    );
    assert_eq!(subscription_write["revision"], "2");
    let ProjectionState::Complete(after_supplement) = projection_state(&mutation_first, &key).await
    else {
        panic!("a later supplement composition must restore complete authority");
    };
    assert!(after_supplement.exact_facts.iter().any(|fact| {
        fact.attribute == Token::new("email-attachment").unwrap()
            && fact.value == ExactValue::new([1]).unwrap()
    }));
    close_and_destroy(
        &mutation_first,
        "cache-wasm-supplement-order-mutation-first",
    )
    .await;
}

#[wasm_bindgen_test(async)]
async fn optimistic_v2_patch_is_filterable_after_enqueue_reopen_and_rollback() {
    const SCOPE: &str = "cache-wasm-optimistic-local-filter";
    const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000002";
    let engine = fresh_engine(SCOPE).await;

    resolved(engine.write_query(
        write_context(None),
        SOUP_UPDATES_WITH_PROJECTION_SUBSCRIPTION.into(),
        Some("SoupUpdatesWithProjection".into()),
        js(serde_json::json!({})),
        js(projected_realtime_document_data(DOCUMENT_ID, false)),
        None,
    ))
    .await;

    let enqueue: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            "00000000-0000-4000-8000-000000000001".into(),
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
            JsValue::UNDEFINED,
            1.0,
            "optimistic-filter-runner".into(),
            0.0,
            100.0,
            js(serde_json::json!({"draftRevision": 10})),
            JsValue::UNDEFINED,
            test_generation(&engine).await,
        ))
        .await,
    );
    assert_eq!(enqueue["initialClaim"]["kind"], "claimed");
    assert_eq!(
        enqueue["initialClaim"]["mutation"]["clientMetadata"],
        serde_json::json!({"draftRevision": 10})
    );
    let inspected: serde_json::Value = from_js(resolved(engine.inspect_mutations()).await);
    assert_eq!(
        inspected[0]["clientMetadata"],
        serde_json::json!({"draftRevision": 10})
    );
    assert!(inspected[0].get("leaseGeneration").is_none());
    let blocked: serde_json::Value =
        from_js(resolved(engine.claim_next_mutation("another-runner".into(), 20.0, 100.0)).await);
    assert!(blocked.is_null());
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
    assert_eq!(
        filtered["keys"],
        serde_json::json!([format!("GraphqlSoupDocument:{DOCUMENT_ID}")])
    );
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
            "00000000-0000-4000-8000-000000000002".into(),
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "First" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            1.0,
            "first-owner".into(),
            0.0,
            50.0,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            test_generation(&engine).await,
        ))
        .await,
    );
    assert_eq!(first["initialClaim"]["kind"], "claimed");

    let second: serde_json::Value = from_js(
        resolved(engine.enqueue_optimistic_mutation(
            None,
            "00000000-0000-4000-8000-000000000003".into(),
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "Second" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            2.0,
            "second-owner".into(),
            0.0,
            50.0,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            test_generation(&engine).await,
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
            "00000000-0000-4000-8000-000000000004".into(),
            PROPERTY_MUTATION.into(),
            Some("SetEntityProperty".into()),
            js(mutation_variables()),
            js(serde_json::json!({
                "setEntityProperty": { "id": "prop-1", "displayName": "Stage" }
            })),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            123.0,
            "runner".into(),
            10.0,
            1_000.0,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            test_generation(&engine).await,
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
            test_generation(&engine).await,
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
        "00000000-0000-4000-8000-000000000005".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Queued" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "destroy-owner".into(),
        0.0,
        100.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        test_generation(&engine).await,
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
        "00000000-0000-4000-8000-000000000006".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Nested" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "nested-owner".into(),
        0.0,
        100.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        test_generation(&engine).await,
    ))
    .await;
    assert_reset_required(engine.bound_identity()).await;

    resolved(engine.physical_reset()).await;
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn mail_page_errors_preserve_reset_latching_and_recovery() {
    const SCOPE: &str = "cache-wasm-mail-page-reset-latch";
    let engine = fresh_engine(SCOPE).await;
    let mut request = exact_document_filter("00000000-0000-0000-0000-000000000000");
    request["filters"]
        .as_object_mut()
        .unwrap()
        .remove("emailFilter");
    request["mail"] = serde_json::json!({"view":"ALL"});

    // Validation errors must not poison a healthy cache.
    let mut invalid = request.clone();
    invalid["limit"] = serde_json::json!(0);
    let error = JsFuture::from(engine.entity_filter(js(invalid)))
        .await
        .expect_err("invalid limit");
    assert!(
        !js_sys::Reflect::get(&error, &JsValue::from_str(RESET_REQUIRED_MARKER))
            .unwrap()
            .is_truthy()
    );
    assert!(!engine.state.lock().await.reset_required);

    // The first read hydrates identity through EngineError rather than reading
    // the Mail catalog directly. It must preserve the same reset marker.
    engine.arm_storage_fault(TestStorageFault::GetBatch).await;
    assert_reset_required(engine.entity_filter(js(request.clone()))).await;
    assert_reset_required(engine.bound_identity()).await;
    resolved(engine.physical_reset()).await;

    for fault in [
        TestStorageFault::GetBatch,
        TestStorageFault::ReconcilePredicateIndex,
        TestStorageFault::LoadProjectionStates,
        TestStorageFault::LoadOptimisticProjections,
    ] {
        resolved(engine.write_query(
            write_context(None),
            "query MailCatalog { user { id emailLinks { id } } }".into(),
            Some("MailCatalog".into()),
            js(serde_json::json!({})),
            js(serde_json::json!({"user":{"id":"mail-viewer","emailLinks":[]}})),
            Some("mail-viewer".into()),
        ))
        .await;
        let page: serde_json::Value =
            from_js(resolved(engine.entity_filter(js(request.clone()))).await);
        assert_eq!(page["kind"], "mail-page");

        engine.arm_storage_fault(fault).await;
        assert_reset_required(engine.entity_filter(js(request.clone()))).await;
        assert_reset_required(engine.bound_identity()).await;
        assert_reset_required(engine.clear()).await;
        resolved(engine.physical_reset()).await;
        let page: serde_json::Value =
            from_js(resolved(engine.entity_filter(js(request.clone()))).await);
        assert_eq!(page["kind"], "incomplete");
    }
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
        "00000000-0000-4000-8000-000000000007".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Queued" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "reset-owner".into(),
        0.0,
        100.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        test_generation(&engine).await,
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
        "00000000-0000-4000-8000-000000000008".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Closed" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "closed".into(),
        1.0,
        2.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        None,
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
        false,
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
        None,
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

#[wasm_bindgen_test]
async fn cached_fragment_plans_preserve_identity_and_recover_from_invalid_requests() {
    let engine = fresh_engine("cache-wasm-fragment-plans").await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("doc-1")),
        None,
    ))
    .await;
    let keys = || js(serde_json::json!(["GraphqlSoupDocument:doc-1"]));
    for _ in 0..2 {
        let selected: serde_json::Value = from_js(
            resolved(engine.read_records_by_keys(
                RECORD_FRAGMENT.into(),
                "CachedDocument".into(),
                keys(),
            ))
            .await,
        );
        assert_eq!(selected["records"][0]["record"]["id"], "doc-1");
    }
    assert!(
        JsFuture::from(engine.read_records_by_keys(
            RECORD_FRAGMENT.into(),
            "Missing".into(),
            keys(),
        ))
        .await
        .is_err()
    );
    let changed: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            "fragment CachedDocument on GraphqlSoupDocument { __typename }".into(),
            "CachedDocument".into(),
            keys(),
        ))
        .await,
    );
    assert!(changed["records"][0]["record"].get("id").is_none());
    let original: serde_json::Value = from_js(
        resolved(engine.read_records_by_keys(
            RECORD_FRAGMENT.into(),
            "CachedDocument".into(),
            keys(),
        ))
        .await,
    );
    assert_eq!(original["records"][0]["record"]["id"], "doc-1");
    resolved(engine.close()).await;
}

async fn run_js(body: &str, argument: &str) -> JsValue {
    let script = js_sys::Function::new_with_args("name", body);
    let promise = script
        .call1(&JsValue::UNDEFINED, &JsValue::from_str(argument))
        .expect("test script runs")
        .dyn_into::<js_sys::Promise>()
        .expect("test script returns a promise");
    JsFuture::from(promise).await.expect("test script settles")
}

async fn opfs_file_exists(name: &str) -> bool {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          try { await root.getFileHandle(name); return true; }
          catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
        })()",
        name,
    )
    .await
    .as_bool()
    .expect("existence is boolean")
}

/// Creates or replaces the file `path` with exactly `text`.
async fn write_opfs_file(path: &str, text: &str) {
    run_js(
        "return (async () => {
          const [path, text] = JSON.parse(name);
          const root = await navigator.storage.getDirectory();
          const file = await root.getFileHandle(path, { create: true });
          const handle = await file.createSyncAccessHandle();
          handle.truncate(0);
          handle.write(new TextEncoder().encode(text), { at: 0 });
          handle.flush();
          handle.close();
        })()",
        &serde_json::json!([path, text]).to_string(),
    )
    .await;
}

async fn remove_opfs_file(name: &str) {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry(name).catch(() => undefined);
        })()",
        name,
    )
    .await;
}

async fn owner_lock_available(scope: &str) -> bool {
    let identity = database_identity(scope);
    let lock = format!("macro:turso-opfs:v1:{}:{identity}", identity.len());
    run_js(
        "return navigator.locks.request(
          name, { mode: 'exclusive', ifAvailable: true }, (lock) => lock !== null
        )",
        &lock,
    )
    .await
    .as_bool()
    .expect("lock probe is boolean")
}

async fn close_opened(result: &JsValue) {
    let engine = js_sys::Reflect::get(result, &JsValue::from_str("engine")).expect("engine");
    let close = js_sys::Reflect::get(&engine, &JsValue::from_str("close"))
        .expect("close")
        .dyn_into::<js_sys::Function>()
        .expect("close is callable");
    let closing = close
        .call0(&engine)
        .expect("close starts")
        .dyn_into::<js_sys::Promise>()
        .expect("close returns a promise");
    JsFuture::from(closing).await.expect("engine closes");
}

#[wasm_bindgen_test(async)]
async fn outcome_opens_touch_opfs_only_after_their_storage_grant() {
    const SCOPE: &str = "cache-wasm-storage-grant";
    let database = database_identity(SCOPE);
    let wal = format!("{database}-wal");
    for recovery in [false, true] {
        remove_opfs_file(&database).await;
        remove_opfs_file(&wal).await;

        // Refusing the grant releases the owner lock without touching OPFS.
        let refused = js_sys::Function::new_no_args(
            "return Promise.reject(new Error('storage grant refused'))",
        );
        let error = if recovery {
            open_cache_for_recovery_with_outcome(SCOPE.into(), None, Some(refused), None).await
        } else {
            open_cache_with_outcome(SCOPE.into(), None, Some(refused), None).await
        }
        .expect_err("a refused grant fails the open");
        assert_eq!(
            error
                .dyn_into::<js_sys::Error>()
                .expect("error object")
                .message(),
            "storage grant refused"
        );
        assert!(owner_lock_available(SCOPE).await);
        assert!(!opfs_file_exists(&database).await);

        // A granted open finds storage untouched when it asks.
        let observed = Rc::new(RefCell::new(None));
        let observer = observed.clone();
        let file = database.clone();
        let grant = Closure::wrap(Box::new(move || -> js_sys::Promise {
            let observer = observer.clone();
            let file = file.clone();
            future_to_promise(async move {
                *observer.borrow_mut() = Some(opfs_file_exists(&file).await);
                Ok(JsValue::UNDEFINED)
            })
        }) as Box<dyn FnMut() -> js_sys::Promise>)
        .into_js_value()
        .unchecked_into::<js_sys::Function>();
        let opened = if recovery {
            open_cache_for_recovery_with_outcome(SCOPE.into(), None, Some(grant), None).await
        } else {
            open_cache_with_outcome(SCOPE.into(), None, Some(grant), None).await
        }
        .expect("a granted open succeeds");
        assert_eq!(*observed.borrow(), Some(false));
        assert!(opfs_file_exists(&database).await);
        close_opened(&opened).await;
    }
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

async fn hold_web_lock(lock: &str) {
    run_js(
        "return new Promise((granted) => {
          const request = navigator.locks.request(name, { mode: 'exclusive' }, () =>
            new Promise((release) => {
              globalThis.cacheWasmHeldLock = { release, request };
              granted(true);
            })
          );
        })",
        lock,
    )
    .await;
}

async fn release_held_web_lock() {
    run_js(
        "return (async () => {
          const held = globalThis.cacheWasmHeldLock;
          delete globalThis.cacheWasmHeldLock;
          held.release();
          await held.request;
        })()",
        "",
    )
    .await;
}

fn owner_lock_for(identity: &str) -> String {
    format!("macro:turso-opfs:v1:{}:{identity}", identity.len())
}

async fn remove_opfs_pair(identity: &str) {
    remove_opfs_file(identity).await;
    remove_opfs_file(&format!("{identity}-wal")).await;
}

async fn create_opfs_file(name: &str) {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          await root.getFileHandle(name, { create: true });
        })()",
        name,
    )
    .await;
}

/// Renames a closed main/WAL pair, as if another storage version wrote it.
async fn move_opfs_pair(from: &str, to: &str) {
    run_js(
        "return (async () => {
          const [from, to] = JSON.parse(name);
          const root = await navigator.storage.getDirectory();
          for (const suffix of ['', '-wal']) {
            await (await root.getFileHandle(from + suffix)).move(to + suffix);
          }
        })()",
        &serde_json::json!([from, to]).to_string(),
    )
    .await;
}

async fn queue_one_mutation(engine: &CacheEngine) {
    resolved(engine.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-000000000011".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Queued" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "stale-owner".into(),
        0.0,
        100.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        test_generation(engine).await,
    ))
    .await;
}

async fn stale_cleanup(scope: &str, identity: &str) -> serde_json::Value {
    from_js(
        remove_stale_cache_database(scope.into(), identity.into())
            .await
            .expect("stale cleanup settles"),
    )
}

#[wasm_bindgen_test]
fn stale_identities_are_only_this_scopes_other_databases() {
    let scope = "scope-a";
    let own = cache_database_identity(scope.into());
    assert_eq!(
        own,
        cache_database_name(scope, cache_turso::STORAGE_SCHEMA_VERSION)
    );
    assert!(!is_stale_identity(scope, &own));
    // The unversioned name is stale only once this build's versions move on.
    assert_eq!(
        is_stale_identity(scope, "graphql-cache:scope-a"),
        own != "graphql-cache:scope-a"
    );
    assert!(is_stale_identity(scope, "graphql-cache:scope-a:s1.v2.t3"));
    let versioned = |storage: u32| {
        format!(
            "graphql-cache:scope-a:s{}.v{}.t{storage}",
            cache_core::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH,
            cache_core::codec::CACHE_FORMAT_VERSION,
        )
    };
    let current = versioned(cache_turso::STORAGE_SCHEMA_VERSION);
    // Another spelling of this build's own versions is never opened again.
    assert_eq!(is_stale_identity(scope, &current), own != current);
    let newer = versioned(cache_turso::STORAGE_SCHEMA_VERSION + 1);
    for other in [
        // A newer build may come back after a rollback, so it keeps its file.
        newer.as_str(),
        "graphql-cache:scope-a:s99.v0.t0",
        "graphql-cache:scope-b:s1.v2.t3",
        "graphql-cache:scope-ab",
        "graphql-cache:scope-a-wal",
        "graphql-cache:scope-a:s1.v2",
        "graphql-cache:scope-a:s1.v2.t3.x",
        "graphql-cache:scope-a:sx.v2.t3",
        "graphql-cache:scope-a:s1.v.t3",
    ] {
        assert!(!is_stale_identity(scope, other), "{other}");
    }
}

#[wasm_bindgen_test(async)]
async fn outcome_opens_can_decline_to_wait_for_a_held_owner_lock() {
    const SCOPE: &str = "cache-wasm-if-available";
    let database = database_identity(SCOPE);
    remove_opfs_pair(&database).await;
    hold_web_lock(&owner_lock_for(&database)).await;
    for recovery in [false, true] {
        let error = if recovery {
            open_cache_for_recovery_with_outcome(SCOPE.into(), None, None, Some(true)).await
        } else {
            open_cache_with_outcome(SCOPE.into(), None, None, Some(true)).await
        }
        .expect_err("a held owner lock declines the open");
        assert_eq!(
            js_sys::Reflect::get(&error, &JsValue::from_str("cacheOwnerLockUnavailable"))
                .expect("marker lookup"),
            JsValue::TRUE
        );
        assert!(!opfs_file_exists(&database).await);
    }
    release_held_web_lock().await;
    let opened = open_cache_with_outcome(SCOPE.into(), None, None, Some(true))
        .await
        .expect("a free owner lock opens");
    close_opened(&opened).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn stale_databases_are_removed_only_when_unused_and_empty() {
    const SCOPE: &str = "cache-wasm-stale-cleanup";
    let own = database_identity(SCOPE);
    let unversioned = legacy_cache_database_name(SCOPE);
    let queued = format!("{unversioned}:s0.v0.t0");
    let older = format!("{unversioned}:s0.v0.t1");
    let partial = format!("{unversioned}:s0.v0.t2");
    for identity in [&own, &unversioned, &queued, &older, &partial] {
        remove_opfs_pair(identity).await;
    }

    // An older build's database still queues a mutation, so it is kept.
    let engine = fresh_engine(SCOPE).await;
    queue_one_mutation(&engine).await;
    resolved(engine.close()).await;
    move_opfs_pair(&own, &queued).await;
    assert_eq!(
        stale_cleanup(SCOPE, &queued).await,
        serde_json::json!({ "outcome": "queued-mutations", "queuedMutations": 1 })
    );
    assert!(opfs_file_exists(&queued).await);

    // A live engine of that build holds its lock, so nothing is opened.
    hold_web_lock(&owner_lock_for(&queued)).await;
    assert_eq!(
        stale_cleanup(SCOPE, &queued).await,
        serde_json::json!({ "outcome": "in-use" })
    );
    release_held_web_lock().await;

    // An empty older database and a one-sided pair are deleted outright.
    let engine = fresh_engine(SCOPE).await;
    resolved(engine.close()).await;
    move_opfs_pair(&own, &older).await;
    assert_eq!(
        stale_cleanup(SCOPE, &older).await,
        serde_json::json!({ "outcome": "removed" })
    );
    create_opfs_file(&format!("{partial}-wal")).await;
    assert_eq!(
        stale_cleanup(SCOPE, &partial).await,
        serde_json::json!({ "outcome": "removed" })
    );
    for identity in [&older, &partial] {
        assert!(!opfs_file_exists(identity).await);
        assert!(!opfs_file_exists(&format!("{identity}-wal")).await);
    }

    // This build's own database and other scopes' databases are refused.
    for identity in [own.clone(), legacy_cache_database_name("another-scope")] {
        remove_stale_cache_database(SCOPE.into(), identity)
            .await
            .expect_err("not a stale database of this scope");
    }
    remove_opfs_pair(&queued).await;
    remove_opfs_pair(&own).await;
}

#[wasm_bindgen_test(async)]
async fn calendar_ranges_report_gaps_watermarks_and_uncertain_events_across_the_js_boundary() {
    const SCOPE: &str = "cache-wasm-calendar-range";
    let engine = fresh_engine(SCOPE).await;
    // 2026-10-05T00:00:00Z through 2026-10-12.
    let week = serde_json::json!({
        "startMs": 1_791_158_400_000_i64,
        "endMs": 1_791_763_200_000_i64,
        "startDay": 20_731,
        "endDay": 20_738,
    });
    let week_spans = serde_json::json!([
        { "kind": "timed", "start": 1_791_158_400_000_i64, "end": 1_791_763_200_000_i64 },
        { "kind": "allDay", "start": 20_731, "end": 20_738 },
    ]);

    let empty: serde_json::Value = from_js(resolved(engine.calendar_range(js(week.clone()))).await);
    assert_eq!(
        empty,
        serde_json::json!({
            "kind": "range",
            "revision": empty["revision"],
            "occurrenceKeys": [],
            "gaps": week_spans,
            "freshness": "unknown",
            "uncertainEventKeys": [],
            "optimistic": false,
            "watermark": null,
        })
    );

    let commit: serde_json::Value = from_js(
        resolved(engine.calendar_commit(js(serde_json::json!({
            "coverage": week_spans,
            "watermark": { "kind": "merge", "links": [{ "linkId": "l1", "seq": "7" }] },
            "freshness": "fresh",
        }))))
        .await,
    );
    assert_eq!(commit["revisionAdvanced"], true);
    assert_eq!(commit["changed"], serde_json::json!([]));

    resolved(engine.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-0000000000c1".into(),
        PROPERTY_MUTATION.into(),
        Some("SetEntityProperty".into()),
        js(mutation_variables()),
        js(serde_json::json!({
            "setEntityProperty": { "id": "prop-1", "displayName": "Moved" }
        })),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        0.0,
        "runner".into(),
        0.0,
        100.0,
        JsValue::UNDEFINED,
        js(serde_json::json!(["GraphqlCalendarEvent:e1"])),
        test_generation(&engine).await,
    ))
    .await;
    let covered: serde_json::Value = from_js(resolved(engine.calendar_range(js(week))).await);
    assert_eq!(covered["gaps"], serde_json::json!([]));
    assert_eq!(covered["freshness"], "fresh");
    assert_eq!(
        covered["watermark"],
        serde_json::json!([{ "linkId": "l1", "seq": "7" }])
    );
    assert_eq!(
        covered["uncertainEventKeys"],
        serde_json::json!(["GraphqlCalendarEvent:e1"])
    );
    assert_eq!(covered["optimistic"], true);

    assert!(
        JsFuture::from(engine.calendar_commit(js(serde_json::json!({
            "deletedEventKeys": ["GraphqlCalendar:c1"],
        }))))
        .await
        .is_err()
    );
    close_and_destroy(&engine, SCOPE).await;
}

/// Rewrites this build's closed database for `scope` as storage 11 wrote it,
/// with `flaw`.
async fn rewrite_closed_as_storage_11(scope: &str, flaw: Flaw) {
    let owner = OpfsOwner::acquire(&database_identity(scope))
        .await
        .expect("acquire closed database");
    let OpenResult::Ready(session) = owner.open().await.expect("open closed database") else {
        panic!("a closed database is a complete pair")
    };
    let mut storage =
        TursoStorage::from_opfs_session(session.connect().expect("connect closed database"), scope)
            .expect("closed database initializes");
    cache_turso::migration_test_hooks::rewrite_as_storage_11(&mut storage)
        .expect("rewrite as storage 11");
    match flaw {
        Flaw::None => {}
        Flaw::UnknownTable => cache_turso::migration_test_hooks::add_unknown_table(&mut storage)
            .expect("add an unknown table"),
        Flaw::LostLayer => cache_turso::migration_test_hooks::drop_optimistic_layers(&mut storage)
            .expect("drop the optimistic layers"),
    }
    let TursoStorageCloseOutcome::Healthy(closed) = storage.try_close().expect("close rewrite")
    else {
        panic!("a rewritten database is healthy")
    };
    closed
        .preserve()
        .expect("preserve rewrite")
        .release()
        .await
        .expect("release rewrite");
}

async fn read_soup(engine: &CacheEngine) -> serde_json::Value {
    from_js(
        resolved(engine.read_query(
            None,
            QUERY.into(),
            Some("Soup".into()),
            js(variables()),
            JsValue::UNDEFINED,
        ))
        .await,
    )
}

async fn queue_depth(engine: &CacheEngine) -> serde_json::Value {
    let diagnostics: serde_json::Value = from_js(resolved(engine.queue_diagnostics()).await);
    diagnostics["depth"].clone()
}

#[wasm_bindgen_test(async)]
async fn an_older_storage_version_moves_forward_and_upgrades_in_place() {
    const SCOPE: &str = "cache-wasm-carry-forward";
    assert_eq!(cache_turso::oldest_upgradable_storage_version(), Some(11));
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;

    // While a context of that build holds it, this build starts empty, says
    // why, and leaves the older database alone.
    hold_web_lock(&owner_lock_for(&older)).await;
    let opened = open_cache_with_outcome(SCOPE.into(), None, None, None)
        .await
        .expect("open beside a held older database");
    let field = |key: &str| js_sys::Reflect::get(&opened, &JsValue::from_str(key)).unwrap();
    assert_eq!(field("outcome"), "opened-new");
    assert_eq!(field("carryForward"), "older-in-use");
    assert_eq!(field("carryForwardStorageVersion"), 11);
    assert!(field("fromStorageVersion").is_undefined());
    close_opened(&opened).await;
    release_held_web_lock().await;
    assert!(opfs_file_exists(&older).await);
    assert!(opfs_file_exists(&format!("{older}-wal")).await);

    // This build's own file now exists, so it never looks for an older one.
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("reopen this build's database");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::OpenedExisting,
            carry_forward: None,
        }
    );
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);

    // Once that build has gone and this build has no file, the older
    // database moves here and is upgraded: same records, queue and generation.
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open moves the older database forward");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::UpgradedExisting {
                from_storage_version: 11
            },
            carry_forward: Some(CarryForward::new(CarryForwardKind::Moved, 11)),
        }
    );
    assert!(!opfs_file_exists(&older).await);
    assert!(!opfs_file_exists(&format!("{older}-wal")).await);
    let read = read_soup(&engine).await;
    assert_eq!(read["kind"], "hit");
    assert_eq!(read["data"], soup_data("carried"));
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;

    // The upgraded file reopens as this build's own.
    let opened = open_cache_with_outcome(SCOPE.into(), None, None, None)
        .await
        .expect("reopen the upgraded database");
    let field = |key: &str| js_sys::Reflect::get(&opened, &JsValue::from_str(key)).unwrap();
    assert_eq!(field("outcome"), "opened-existing");
    assert!(field("carryForward").is_undefined());
    close_opened(&opened).await;

    // A recovery open never moves an older database in.
    resolved(open_cache(SCOPE.into(), None).await.unwrap().close()).await;
    move_opfs_pair(&own, &older).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, true, None, false)
        .await
        .expect("recovery open");
    assert_eq!(report.carry_forward, None);
    assert_eq!(report.outcome, CacheOpenOutcome::ResetStorageUncertain);
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    remove_opfs_pair(&older).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

/// What is wrong, if anything, with the older database a test leaves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Flaw {
    None,
    /// A table no version has: the upgrade's last step is rejected, so the
    /// file stays at storage 11 and this build cannot open it.
    UnknownTable,
    /// The queued write lost its optimistic layer: the open finds the queue
    /// inconsistent only after the upgrade committed.
    LostLayer,
}

/// Leaves an older build's database for `scope` at the storage 11 identity,
/// holding a cached query and a queued write, and `flaw`, with nothing at
/// this build's identity. Returns its generation.
async fn older_database_with_a_queued_write(scope: &str, flaw: Flaw) -> Option<String> {
    let own = database_identity(scope);
    let older = cache_database_name(scope, 11);
    remove_opfs_pair(&older).await;
    let engine = fresh_engine(scope).await;
    resolved(engine.write_query(
        write_context(None),
        QUERY.into(),
        Some("Soup".into()),
        js(variables()),
        js(soup_data("carried")),
        Some("identity".into()),
    ))
    .await;
    queue_one_mutation(&engine).await;
    let generation = test_generation(&engine).await;
    resolved(engine.close()).await;
    rewrite_closed_as_storage_11(scope, flaw).await;
    move_opfs_pair(&own, &older).await;
    generation
}

/// Moves the older database to this build's identity as an open does, then
/// stops, as a worker that stopped before the open finished would.
async fn move_without_opening(scope: &str) {
    let mut owner = OpfsOwner::acquire(&database_identity(scope))
        .await
        .expect("acquire this build's identity");
    let previous = owner
        .lock_previous(&cache_database_name(scope, 11))
        .await
        .expect("lock the older identity")
        .expect("the older identity is free");
    assert_eq!(
        owner
            .adopt(&previous)
            .await
            .expect("move the older database"),
        AdoptOutcome::Adopted
    );
    previous
        .release()
        .await
        .expect("release the older identity");
    owner.release().await.expect("release");
}

/// Opens moved files and upgrades them as an open does, then closes them
/// without ending the adoption, as an open whose last step failed would.
async fn upgrade_without_finishing(scope: &str) {
    let owner = OpfsOwner::acquire(&database_identity(scope))
        .await
        .expect("acquire this build's identity");
    let OpenResult::Ready(session) = owner.open().await.expect("open moved database") else {
        panic!("moved files are a complete pair")
    };
    let (storage, outcome) = TursoStorage::from_opfs_session_with_outcome(
        session.connect().expect("connect moved database"),
        scope,
    )
    .expect("moved database upgrades");
    assert_eq!(
        CacheOpenOutcome::from(outcome),
        CacheOpenOutcome::UpgradedExisting {
            from_storage_version: 11
        }
    );
    close_turso(storage).await;
}

async fn close_turso(storage: TursoStorage) {
    let TursoStorageCloseOutcome::Healthy(closed) = storage.try_close().expect("close") else {
        panic!("the database is healthy")
    };
    closed
        .preserve()
        .expect("preserve")
        .release()
        .await
        .expect("release");
}

async fn web_lock_free(lock: &str) -> bool {
    run_js(
        "return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true },
          (lock) => lock !== null)",
        lock,
    )
    .await
    .as_bool()
    .expect("lock probe is boolean")
}

async fn create_opfs_directory(name: &str) {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          await root.getDirectoryHandle(name, { create: true });
        })()",
        name,
    )
    .await;
}

/// The text of the OPFS file `name`, or `None` when there is none.
async fn opfs_file_text(name: &str) -> Option<String> {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          try { return await (await (await root.getFileHandle(name)).getFile()).text(); }
          catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
        })()",
        name,
    )
    .await
    .as_string()
}

/// Whether anything, a file or a directory, sits at `name` in the OPFS root.
async fn opfs_entry_exists(name: &str) -> bool {
    run_js(
        "return (async () => {
          const root = await navigator.storage.getDirectory();
          for await (const key of root.keys()) if (key === name) return true;
          return false;
        })()",
        name,
    )
    .await
    .as_bool()
    .expect("existence is boolean")
}

/// Renames one OPFS file.
async fn rename_opfs_file(from: &str, to: &str) {
    run_js(
        "return (async () => {
          const [from, to] = JSON.parse(name);
          const root = await navigator.storage.getDirectory();
          await (await root.getFileHandle(from)).move(to);
        })()",
        &serde_json::json!([from, to]).to_string(),
    )
    .await;
}

#[wasm_bindgen_test(async)]
async fn a_moved_database_that_never_opened_goes_back_or_opens_next_time() {
    const SCOPE: &str = "cache-wasm-unfinished-carry";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let marker = format!("{own}-adopting");
    let carried = |kind| Some(CarryForward::new(kind, 11));

    // The worker stopped after the move, before the open finished, so the
    // coordinator asks for a recovery open: the files go back, not away, and
    // this build starts afresh, as it would have without the move.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    assert!(opfs_file_exists(&marker).await);
    let (engine, report) = open_cache_inner(SCOPE.into(), None, true, None, false)
        .await
        .expect("recovery open");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: carried(CarryForwardKind::Returned),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    assert!(opfs_file_exists(&format!("{older}-wal")).await);
    assert!(!opfs_file_exists(&marker).await);

    // Nothing was lost: without this build's file, the next open carries the
    // returned database forward with its query, queue and generation.
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::UpgradedExisting {
                from_storage_version: 11
            },
            carry_forward: carried(CarryForwardKind::Moved),
        }
    );
    assert_eq!(read_soup(&engine).await["data"], soup_data("carried"));
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&marker).await);

    // After the same stop, an ordinary open completes the move instead, and
    // once it has opened, the files are this build's own: a later recovery
    // open discards them like any others.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("resume the move");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::UpgradedExisting {
                from_storage_version: 11
            },
            carry_forward: carried(CarryForwardKind::Resumed),
        }
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&marker).await);
    let (engine, report) = open_cache_inner(SCOPE.into(), None, true, None, false)
        .await
        .expect("recovery open after the move finished");
    assert_eq!(report.carry_forward, None);
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&older).await);

    // A moved database this build cannot open goes back as well.
    older_database_with_a_queued_write(SCOPE, Flaw::UnknownTable).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open beside an unusable older database");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetIncompatible,
            carry_forward: carried(CarryForwardKind::Returned),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    assert!(opfs_file_exists(&format!("{older}-wal")).await);
    assert!(!opfs_file_exists(&marker).await);

    // Its own files now exist, so this build never tries it again.
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("reopen this build's fresh database");
    assert_eq!(report.carry_forward, None);
    assert_eq!(report.outcome, CacheOpenOutcome::OpenedExisting);
    resolved(engine.close()).await;
    remove_opfs_pair(&older).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn the_older_build_stays_out_while_moved_files_first_open() {
    const SCOPE: &str = "cache-wasm-carry-lock";
    let older = cache_database_name(SCOPE, 11);
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    let mut owner = OpfsOwner::acquire(&database_identity(SCOPE))
        .await
        .expect("acquire this build's identity");
    let carried = carry_forward(SCOPE, &mut owner).await;
    assert_eq!(
        carried.report,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert!(matches!(
        carried.pending,
        Pending::Moved(MovedFiles {
            from_version: 11,
            previous: Some(_),
            ..
        })
    ));
    // Until the moved files have opened here, no context of the older build
    // can take its identity, so it cannot open, reset or recreate it.
    assert!(!web_lock_free(&owner_lock_for(&older)).await);
    let opened = open_storage(SCOPE, owner, carried.pending)
        .await
        .expect("first open of the moved files");
    assert!(web_lock_free(&owner_lock_for(&older)).await);
    assert_eq!(
        opened.outcome,
        CacheOpenOutcome::UpgradedExisting {
            from_storage_version: 11
        }
    );
    assert_eq!(opened.returned, None);
    close_turso(opened.storage).await;
    assert!(!opfs_file_exists(&format!("{}-adopting", database_identity(SCOPE))).await);
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("reopen");
    assert_eq!(report.outcome, CacheOpenOutcome::OpenedExisting);
    assert_eq!(report.carry_forward, None);
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn a_database_another_scope_wrote_goes_back_without_an_upgrade() {
    const SCOPE: &str = "cache-wasm-carry-scope";
    const OTHER: &str = "cache-wasm-carry-scope-other";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    // A storage 11 file at this scope's older name that another scope wrote:
    // the open resets before any step runs, so the file is still what the
    // older build wrote and goes back to its name.
    remove_opfs_pair(&older).await;
    older_database_with_a_queued_write(OTHER, Flaw::None).await;
    move_opfs_pair(&cache_database_name(OTHER, 11), &older).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open beside a database written for another scope");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetIncompatible,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Returned, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    assert!(!opfs_file_exists(&format!("{own}-adopting")).await);
    let owner = OpfsOwner::acquire(&older)
        .await
        .expect("acquire the older name");
    let (owner, stored) = read_storage_version(owner)
        .await
        .expect("read the returned file's version");
    assert!(matches!(stored, StoredVersion::Read(Some(11))));
    owner.release().await.expect("release the older name");
    remove_opfs_pair(&older).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn moved_files_this_build_has_written_are_never_handed_back() {
    const SCOPE: &str = "cache-wasm-carry-written";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let marker = format!("{own}-adopting");
    let discarded = Some(CarryForward::new(CarryForwardKind::Discarded, 11));

    // The upgrade committed storage 12 before a later check (here, the
    // queue's) asked for a reset: the older build cannot open the file any
    // more, so it is discarded, not handed back.
    older_database_with_a_queued_write(SCOPE, Flaw::LostLayer).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open beside a database whose queue is inconsistent");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetCorrupt,
            carry_forward: discarded,
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&older).await);
    assert!(!opfs_file_exists(&marker).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");

    // A worker stopped right after the upgrade committed, before the open
    // finished: the recovery open reads storage 12 and discards the files.
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    cache_turso::migration_test_hooks::interrupt_after_steps(Some(1));
    let stopped = open_cache_inner(SCOPE.into(), None, false, None, false).await;
    cache_turso::migration_test_hooks::interrupt_after_steps(None);
    assert!(cache_turso::migration_test_hooks::take_interrupted());
    assert!(stopped.is_err());
    assert!(opfs_file_exists(&marker).await);
    let (engine, report) = open_cache_inner(SCOPE.into(), None, true, None, false)
        .await
        .expect("recovery open after the upgrade committed");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: discarded,
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&older).await);
    assert!(!opfs_file_exists(&marker).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");

    // The files opened here, but ending the adoption failed and left its
    // marker: an ordinary open reports the move resumed once and keeps the
    // files; a recovery open reads storage 12 and never hands them back.
    for recovery in [false, true] {
        let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
        move_without_opening(SCOPE).await;
        upgrade_without_finishing(SCOPE).await;
        assert!(opfs_file_exists(&marker).await);
        let (engine, report) = open_cache_inner(SCOPE.into(), None, recovery, None, false)
            .await
            .expect("open beside a leftover marker");
        if recovery {
            assert_eq!(
                report,
                OpenReport {
                    outcome: CacheOpenOutcome::ResetStorageUncertain,
                    carry_forward: discarded,
                }
            );
            assert_eq!(queue_depth(&engine).await, "0");
        } else {
            assert_eq!(
                report,
                OpenReport {
                    outcome: CacheOpenOutcome::OpenedExisting,
                    carry_forward: Some(CarryForward::new(CarryForwardKind::Resumed, 11)),
                }
            );
            assert_eq!(queue_depth(&engine).await, "1");
            assert_eq!(test_generation(&engine).await, generation);
        }
        resolved(engine.close()).await;
        assert!(!opfs_file_exists(&older).await);
        assert!(!opfs_file_exists(&marker).await);
        destroy_cache(SCOPE.into()).await.expect("destroy cache");
    }
}

#[wasm_bindgen_test(async)]
async fn a_move_stopped_between_its_renames_completes_on_the_next_open() {
    const SCOPE: &str = "cache-wasm-carry-split";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    // What a stop between the renames leaves: the main file and the marker
    // here, the WAL (empty, as a close leaves it) still at the older identity.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&format!("{own}-wal"), &format!("{older}-wal")).await;
    // The marker says the WAL was empty, so the main file is whole on its own
    // and the move completes even while a context of the older build holds
    // its name. (A WAL with frames waits for that lock: turso-opfs's
    // `a_split_adoption_completes_only_with_the_wal_it_recorded`.)
    hold_web_lock(&owner_lock_for(&older)).await;
    let opened = open_cache_inner(SCOPE.into(), None, false, None, false).await;
    release_held_web_lock().await;
    let (engine, report) = opened.expect("open after a stopped move");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::UpgradedExisting {
                from_storage_version: 11
            },
            carry_forward: Some(CarryForward::new(CarryForwardKind::Resumed, 11)),
        }
    );
    assert_eq!(read_soup(&engine).await["data"], soup_data("carried"));
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&format!("{own}-adopting")).await);
    remove_opfs_pair(&older).await;

    // The same stop, then a recovery open: the pair is completed and handed
    // back whole.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&format!("{own}-wal"), &format!("{older}-wal")).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, true, None, false)
        .await
        .expect("recovery open after a stopped move");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Returned, 11))
    );
    resolved(engine.close()).await;
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn an_unreadable_adoption_keeps_the_moved_files_and_fails_the_open() {
    const SCOPE: &str = "cache-wasm-carry-unknown";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let marker = format!("{own}-adopting");
    let held = format!("{own}-held");
    // A move stopped between its renames, then a marker that cannot be read:
    // a directory where it belongs fails the read as an OPFS error would.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&format!("{own}-wal"), &format!("{older}-wal")).await;
    rename_opfs_file(&marker, &held).await;
    create_opfs_directory(&marker).await;
    // Opening the main file alone could only reset it, and a recovery open
    // cannot tell where the files go either: both fail and keep them, and
    // both say so, so the coordinator never gives this scope up.
    let opened = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .err()
        .expect("the ordinary open fails");
    assert!(kept_for_recovery(&opened), "the ordinary open kept them");
    let recovered = recovery_open(SCOPE)
        .await
        .err()
        .expect("the recovery open fails");
    assert!(kept_for_recovery(&recovered), "the recovery open kept them");
    assert!(opfs_file_exists(&own).await);
    assert!(!opfs_file_exists(&format!("{own}-wal")).await);
    assert!(opfs_file_exists(&format!("{older}-wal")).await);
    // Once the marker reads again, the move completes with nothing lost.
    remove_opfs_file(&marker).await;
    rename_opfs_file(&held, &marker).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open once the marker reads");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::UpgradedExisting {
                from_storage_version: 11
            },
            carry_forward: Some(CarryForward::new(CarryForwardKind::Resumed, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn a_marker_that_never_reads_is_discarded_at_the_limit() {
    const SCOPE: &str = "cache-wasm-carry-never-reads";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let marker = format!("{own}-adopting");
    let attempts = format!("{own}-adopting-attempts");
    let held = format!("{own}-held");
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    remove_opfs_file(&marker).await;
    create_opfs_directory(&marker).await;
    // Neither the marker nor the attempt count reads: nothing bounds this
    // recovery or says how old the adoption is, so it keeps everything.
    rename_opfs_file(&attempts, &held).await;
    assert!(recovery_open(SCOPE).await.is_err());
    assert!(opfs_file_exists(&own).await);
    rename_opfs_file(&held, &attempts).await;
    assert_eq!(adoption_attempts(SCOPE).await, Some(0));
    // Each recovery that cannot read the marker counts an attempt and keeps
    // the files; past the limit the next one discards them, not knowing the
    // version they moved at, so the cache can start.
    for count in 1..=RECOVERY_ATTEMPTS {
        assert!(recovery_open(SCOPE).await.is_err());
        assert_eq!(adoption_attempts(SCOPE).await, Some(count));
        assert!(opfs_file_exists(&own).await);
    }
    let (engine, report) = recovery_open(SCOPE)
        .await
        .expect("recovery open past the limit");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward {
                kind: CarryForwardKind::Discarded,
                from_storage_version: None,
            }),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(!opfs_entry_exists(&marker).await);
    assert!(!opfs_file_exists(&attempts).await);
    assert!(!opfs_file_exists(&older).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn an_uncounted_recovery_decides_first_and_discards_once_old() {
    const SCOPE: &str = "cache-wasm-recovery-uncounted";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let older_lock = owner_lock_for(&older);
    let attempts = format!("{own}-adopting-attempts");
    let held = format!("{own}-held");

    // An attempt that cannot be counted while the older build holds its
    // name: the files cannot go back yet, so it keeps them.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&attempts, &held).await;
    hold_web_lock(&older_lock).await;
    for _ in 0..=RECOVERY_ATTEMPTS {
        assert!(recovery_open(SCOPE).await.is_err());
        assert!(opfs_file_exists(&own).await);
        assert!(!opfs_file_exists(&older).await);
    }
    // Once the lock is free it still hands them back whole.
    release_held_web_lock().await;
    let (engine, report) = recovery_open(SCOPE)
        .await
        .expect("uncounted recovery once the lock is free");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Returned, 11))
    );
    resolved(engine.close()).await;
    remove_opfs_file(&held).await;
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;

    // It decides before it looks at the age: files that can go back go
    // back, however long ago the adoption began.
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&attempts, &held).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS));
    let result = recovery_open(SCOPE).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(0));
    let (engine, report) = result.expect("old uncounted recovery with the lock free");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Returned, 11))
    );
    resolved(engine.close()).await;
    remove_opfs_file(&held).await;
    assert!(opfs_file_exists(&older).await);

    // What it would keep, it discards once the adoption is past the age
    // bound, so attempts that cannot be counted cannot keep the cache from
    // starting either.
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&attempts, &held).await;
    hold_web_lock(&older_lock).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS - 60_000));
    assert!(recovery_open(SCOPE).await.is_err());
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS));
    let result = recovery_open(SCOPE).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(0));
    let (engine, report) = result.expect("uncounted recovery past the age bound");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Discarded, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    release_held_web_lock().await;
    remove_opfs_file(&held).await;
    assert!(!opfs_file_exists(&format!("{own}-adopting")).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn an_uncounted_recovery_reads_the_adoption_time_when_the_files_do_not() {
    const SCOPE: &str = "cache-wasm-recovery-unread-files";
    let own = database_identity(SCOPE);
    let wal = format!("{own}-wal");
    let wal_held = format!("{own}-wal-held");
    let attempts = format!("{own}-adopting-attempts");
    let held = format!("{own}-held");
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    // The marker reads, but the files beside it cannot be looked up (a
    // directory where the WAL belongs), and no attempt can be counted.
    rename_opfs_file(&wal, &wal_held).await;
    create_opfs_directory(&wal).await;
    rename_opfs_file(&attempts, &held).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS - 60_000));
    let kept = recovery_open(SCOPE).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS));
    let discarded = recovery_open(SCOPE).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(0));
    let error = kept
        .err()
        .expect("a recovery inside the age bound keeps them");
    assert!(
        kept_for_recovery(&error),
        "the coordinator learns the files were kept for a later recovery"
    );
    // Past it the marker's time bounds the attempt, as it would a readable
    // adoption's.
    let (engine, report) = discarded.expect("a recovery past the age bound discards");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward {
                kind: CarryForwardKind::Discarded,
                from_storage_version: None,
            }),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(!opfs_entry_exists(&format!("{own}-adopting")).await);
    remove_opfs_file(&held).await;
    remove_opfs_file(&wal_held).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn an_uncounted_recovery_reads_the_adoption_again_before_the_age_bound() {
    const SCOPE: &str = "cache-wasm-recovery-reread";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let attempts = format!("{own}-adopting-attempts");
    let held = format!("{own}-held");
    // An adoption past the age bound whose first read fails in passing, with
    // no attempt counted. Only the marker's time would bound it, so it reads
    // the adoption again first: the files can go back, and they do.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    rename_opfs_file(&attempts, &held).await;
    ADOPTION_READ_FAILURES.with(|left| left.set(1));
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(UNCOUNTED_RECOVERY_MS));
    let result = recovery_open(SCOPE).await;
    CLOCK_AHEAD_MS.with(|ahead| ahead.set(0));
    assert_eq!(ADOPTION_READ_FAILURES.with(std::cell::Cell::get), 0);
    let (engine, report) = result.expect("recovery open after a failed read");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Returned, 11)),
        }
    );
    resolved(engine.close()).await;
    remove_opfs_file(&held).await;
    assert!(opfs_file_exists(&older).await);
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

/// Whether `error` says its open kept files an upgrade moved here for a
/// later recovery to decide.
fn kept_for_recovery(error: &JsValue) -> bool {
    js_sys::Reflect::get(error, &JsValue::from_str(RECOVERY_DEFERRED_MARKER))
        .ok()
        .and_then(|value| value.as_bool())
        == Some(true)
}

/// A recovery open of `scope`, as the coordinator asks for after a failed one.
async fn recovery_open(scope: &str) -> Result<(CacheEngine, OpenReport), JsValue> {
    open_cache_inner(scope.into(), None, true, None, false).await
}

/// The recovery attempts counted for this scope's adoption, or `None` when
/// no count sits beside its marker.
async fn adoption_attempts(scope: &str) -> Option<u8> {
    let count = opfs_file_text(&format!("{}-adopting-attempts", database_identity(scope))).await?;
    u8::try_from(count.bytes().filter(|&byte| byte != b'-').count()).ok()
}

/// Leaves a database at the storage 11 identity holding a queued write and no
/// row saying which storage version wrote it, with nothing at this build's
/// identity.
async fn older_database_without_a_version(scope: &str) {
    let own = database_identity(scope);
    let older = cache_database_name(scope, 11);
    remove_opfs_pair(&older).await;
    let engine = fresh_engine(scope).await;
    queue_one_mutation(&engine).await;
    resolved(engine.close()).await;
    let owner = OpfsOwner::acquire(&own)
        .await
        .expect("acquire closed database");
    let OpenResult::Ready(session) = owner.open().await.expect("open closed database") else {
        panic!("a closed database is a complete pair")
    };
    let mut storage =
        TursoStorage::from_opfs_session(session.connect().expect("connect closed database"), scope)
            .expect("closed database initializes");
    cache_turso::migration_test_hooks::forget_storage_version(&mut storage)
        .expect("forget the storage version");
    close_turso(storage).await;
    move_opfs_pair(&own, &older).await;
}

#[wasm_bindgen_test(async)]
async fn recovery_keeps_moved_files_while_the_older_build_holds_its_lock() {
    const SCOPE: &str = "cache-wasm-recovery-busy";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let older_lock = owner_lock_for(&older);

    // While a context of the older build holds its name, a recovery open
    // cannot hand the moved files back, so it fails and keeps them, counting
    // the attempt. Once the lock is free, the next one hands them back whole.
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    hold_web_lock(&older_lock).await;
    for attempt in 1..=2 {
        assert!(recovery_open(SCOPE).await.is_err());
        assert_eq!(adoption_attempts(SCOPE).await, Some(attempt));
        assert!(opfs_file_exists(&own).await);
        assert!(!opfs_file_exists(&older).await);
    }
    release_held_web_lock().await;
    let (engine, report) = recovery_open(SCOPE)
        .await
        .expect("recovery open once the lock is free");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Returned, 11)),
        }
    );
    resolved(engine.close()).await;
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;

    // A lock that stays held cannot keep the cache from starting: once
    // RECOVERY_ATTEMPTS were counted, the next recovery discards the files
    // without opening them.
    older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    hold_web_lock(&older_lock).await;
    for _ in 0..RECOVERY_ATTEMPTS {
        assert!(recovery_open(SCOPE).await.is_err());
    }
    assert_eq!(adoption_attempts(SCOPE).await, Some(RECOVERY_ATTEMPTS));
    let (engine, report) = recovery_open(SCOPE)
        .await
        .expect("recovery open at the limit");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Discarded, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    release_held_web_lock().await;
    assert!(!opfs_file_exists(&format!("{own}-adopting")).await);
    assert!(!opfs_file_exists(&older).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn a_recovery_stopped_after_reading_the_version_still_hands_the_files_back() {
    const SCOPE: &str = "cache-wasm-recovery-probe";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    move_without_opening(SCOPE).await;
    // What a recovery stopped right after reading the version leaves: one
    // attempt counted, the files checkpointed, and the marker still there.
    let mut owner = OpfsOwner::acquire(&own)
        .await
        .expect("acquire this build's identity");
    assert_eq!(owner.record_attempt().await.expect("count an attempt"), 1);
    let (owner, stored) = read_storage_version(owner).await.expect("read the version");
    assert!(matches!(stored, StoredVersion::Read(Some(11))));
    owner.release().await.expect("release");
    assert_eq!(adoption_attempts(SCOPE).await, Some(1));

    let (engine, report) = recovery_open(SCOPE).await.expect("recovery open");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Returned, 11)),
        }
    );
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the returned database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(read_soup(&engine).await["data"], soup_data("carried"));
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

/// An older pair beside a marker of its own came from an even older name and
/// never finished its first open there; a later storage bump finds it so.
/// Its build decides those files first, so they stay, and this build starts
/// empty, reporting the older build in use.
#[wasm_bindgen_test(async)]
async fn an_older_pair_still_finishing_its_own_adoption_stays_with_its_build() {
    const SCOPE: &str = "cache-wasm-chained-adoption";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let older_marker = format!("{older}-adopting");
    let generation = older_database_with_a_queued_write(SCOPE, Flaw::None).await;
    write_opfs_file(&older_marker, "an adoption into the older name").await;

    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open without the older pair");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::OpenedNew,
            carry_forward: Some(CarryForward::new(CarryForwardKind::OlderInUse, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    assert!(opfs_file_exists(&older_marker).await);

    // Once that build has finished with them, they move on with their queue.
    remove_opfs_file(&older_marker).await;
    remove_opfs_pair(&own).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("carry the older database forward");
    assert_eq!(
        report.carry_forward,
        Some(CarryForward::new(CarryForwardKind::Moved, 11))
    );
    assert_eq!(queue_depth(&engine).await, "1");
    assert_eq!(test_generation(&engine).await, generation);
    resolved(engine.close()).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn moved_files_whose_version_is_unreadable_are_kept_until_the_limit() {
    const SCOPE: &str = "cache-wasm-recovery-unversioned";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    let marker = format!("{own}-adopting");
    older_database_without_a_version(SCOPE).await;

    // The ordinary open moves the files and cannot open them. Nothing says
    // they are still what the older build wrote, so it keeps them, marker
    // and all, says so, and lets the older build's name go.
    let opened = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .err()
        .expect("the ordinary open fails");
    assert!(kept_for_recovery(&opened), "the ordinary open kept them");
    assert!(opfs_file_exists(&own).await);
    assert!(opfs_file_exists(&marker).await);
    assert!(!opfs_file_exists(&older).await);
    assert!(web_lock_free(&owner_lock_for(&older)).await);

    // Recovery opens cannot tell either, until the limit, when they are
    // discarded without being opened.
    for attempt in 1..=RECOVERY_ATTEMPTS {
        assert!(recovery_open(SCOPE).await.is_err());
        assert_eq!(adoption_attempts(SCOPE).await, Some(attempt));
        assert!(opfs_file_exists(&own).await);
    }
    let (engine, report) = recovery_open(SCOPE)
        .await
        .expect("recovery open at the limit");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::ResetStorageUncertain,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Discarded, 11)),
        }
    );
    assert_eq!(queue_depth(&engine).await, "0");
    resolved(engine.close()).await;
    assert!(!opfs_file_exists(&marker).await);
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}

#[wasm_bindgen_test(async)]
async fn an_older_pair_that_is_not_a_database_stays_where_it_is() {
    const SCOPE: &str = "cache-wasm-unreadable-carry";
    let own = database_identity(SCOPE);
    let older = cache_database_name(SCOPE, 11);
    for identity in [&own, &older] {
        remove_opfs_pair(identity).await;
    }
    write_opfs_file(&older, "not a database").await;
    create_opfs_file(&format!("{older}-wal")).await;
    let (engine, report) = open_cache_inner(SCOPE.into(), None, false, None, false)
        .await
        .expect("open beside an unreadable older pair");
    assert_eq!(
        report,
        OpenReport {
            outcome: CacheOpenOutcome::OpenedNew,
            carry_forward: Some(CarryForward::new(CarryForwardKind::Unreadable, 11)),
        }
    );
    resolved(engine.close()).await;
    assert!(opfs_file_exists(&older).await);
    assert!(!opfs_file_exists(&format!("{own}-adopting")).await);
    remove_opfs_pair(&older).await;
    destroy_cache(SCOPE.into()).await.expect("destroy cache");
}
