use super::*;
use pollster::block_on;

const QUERY: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor items { __typename id } } }
}"#;

const HYDRATION_QUERY: &str = r#"query Soup($input: SoupInput!) {
    user {
        id @cacheOnly
        soup(input: $input) {
            nextCursor
            items @cacheOnly { __typename id }
        }
    }
}"#;

fn variables() -> Variables {
    let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
        unreachable!()
    };
    vars
}

fn soup_data(has_next_page: bool) -> serde_json::Value {
    serde_json::json!({
        "user": {
            "id": "user-1",
            "soup": {
                "nextCursor": has_next_page.then_some("cursor-1"),
                "items": [{"__typename": "GraphqlSoupDocument", "id": "doc-1"}]
            }
        }
    })
}

fn spawn_handle() -> EngineHandle {
    let storage = TursoStorage::open_in_memory("scope-1").unwrap();
    EngineHandle::new(storage, None)
}

fn write(
    handle: &EngineHandle,
    origin: Option<&str>,
    data: serde_json::Value,
    identity: Option<&str>,
) -> WriteResultWire {
    block_on(handle.write(WriteRequest {
        origin_op_id: origin.map(str::to_string),
        registration: None,
        query: QUERY.to_string(),
        operation_name: Some("Soup".to_string()),
        variables: variables(),
        data,
        identity: identity.map(str::to_string),
    }))
    .unwrap()
}

fn read(handle: &EngineHandle, op_id: Option<&str>) -> ReadResultWire {
    block_on(handle.read(
        op_id.map(str::to_string),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        Vec::new(),
    ))
    .unwrap()
}

#[test]
fn write_then_read_round_trips() {
    let handle = spawn_handle();
    assert!(matches!(read(&handle, None), ReadResultWire::Miss));

    let result = write(&handle, None, soup_data(false), None);
    assert!(!result.changed.is_empty());
    assert!(!result.reset);

    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hit");
    };
    assert_eq!(data, soup_data(false));
}

#[test]
fn hydration_returns_only_unmarked_fields() {
    let handle = spawn_handle();
    let result = block_on(handle.hydrate_query(
        HYDRATION_QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        None,
    ))
    .unwrap();

    assert_eq!(
        result.data,
        Some(serde_json::json!({
            "user": { "soup": { "nextCursor": "cursor-1" } }
        }))
    );
    assert!(!result.write_result.changed.is_empty());
    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hydrated cache hit");
    };
    assert_eq!(data, soup_data(true));
}

#[test]
fn entity_resolvers_cross_the_native_engine_boundary() {
    let handle = spawn_handle();
    write(
        &handle,
        None,
        serde_json::json!({
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
        }),
        None,
    );
    let query = r#"query Email($input: EmailThreadInput!) {
        user { id emailThread(input: $input) { __typename id } }
    }"#;
    let serde_json::Value::Object(variables) =
        serde_json::json!({"input": {"threadId": "thread-1"}})
    else {
        unreachable!()
    };
    let result = block_on(handle.read(
        Some("webview:1".to_string()),
        query.to_string(),
        Some("Email".to_string()),
        variables,
        vec![EntityResolver {
            parent_type: "GraphqlUser".to_string(),
            field_name: "emailThread".to_string(),
            target_type: "GraphqlSoupEmailThread".to_string(),
            argument_path: vec!["input".to_string(), "threadId".to_string()],
        }],
    ))
    .unwrap();
    let ReadResultWire::Hit { data } = result else {
        panic!("expected resolver hit")
    };
    assert_eq!(data["user"]["emailThread"]["id"], "thread-1");
}

#[test]
fn explicit_key_selection_returns_native_cache_entities() {
    let handle = spawn_handle();
    let query = r#"query Soup($input: SoupInput!) {
        user {
            id
            soup(input: $input) {
                items {
                    __typename
                    id
                    ... on GraphqlSoupDocument {
                        id name fileType createdAt updatedAt viewedAt deletedAt
                        subType { kind isCompleted }
                    }
                }
                nextCursor
            }
        }
    }"#;
    let data = serde_json::json!({
        "user": {
            "id": "user-1",
            "soup": {
                "items": [{
                    "__typename": "GraphqlSoupDocument",
                    "id": "doc-1",
                    "name": "A note",
                    "fileType": "md",
                    "createdAt": "1970-01-01T00:00:01Z",
                    "updatedAt": "1970-01-01T00:00:02Z",
                    "viewedAt": "1970-01-01T00:00:03Z",
                    "deletedAt": null,
                    "subType": null
                }],
                "nextCursor": null
            }
        }
    });
    block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: query.to_string(),
        operation_name: Some("Soup".to_string()),
        variables: variables(),
        data,
        identity: None,
    }))
    .unwrap();

    let records = block_on(handle.read_records_by_keys(
        "fragment Document on GraphqlSoupDocument { id name }".to_string(),
        "Document".to_string(),
        vec!["GraphqlSoupDocument:doc-1".to_string()],
    ))
    .unwrap();
    assert_eq!(
        records.records[0].record,
        serde_json::json!({"id": "doc-1", "name": "A note"})
    );
}

#[test]
fn search_uses_native_materialized_projection() {
    let handle = spawn_handle();
    let query = r#"query Soup($input: SoupInput!) {
        user {
            id
            soup(input: $input) {
                items {
                    __typename
                    id
                    ... on GraphqlSoupDocument { name updatedAt }
                }
                nextCursor
            }
        }
    }"#;
    block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: query.to_string(),
        operation_name: Some("Soup".to_string()),
        variables: variables(),
        data: serde_json::json!({
            "user": {
                "id": "user-1",
                "soup": {
                    "items": [{
                        "__typename": "GraphqlSoupDocument",
                        "id": "doc-1",
                        "name": "Quarterly Plan",
                        "updatedAt": "2025-01-02T03:04:05Z"
                    }],
                    "nextCursor": null
                }
            }
        }),
        identity: None,
    }))
    .unwrap();

    let page = block_on(handle.search(SearchRequest {
        profile: cache_core::search::SearchProfile::QuickAccessV1,
        buckets: vec!["document".into()],
        query: "quarter".into(),
        cursor: None,
        limit: 20,
        now_ms: 1_735_787_046_000,
    }))
    .unwrap();
    assert_eq!(page.documents.len(), 1);
    assert_eq!(
        page.documents[0].record_key.as_ref(),
        "GraphqlSoupDocument:doc-1"
    );
}

#[test]
fn query_inspection_serializes_generated_variables_and_value() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);

    let instances = block_on(handle.inspect_query(
        QUERY.to_string(),
        Some("Soup".to_string()),
        vec!["user".to_string(), "soup".to_string()],
        Vec::new(),
    ))
    .unwrap();
    assert_eq!(instances.len(), 1);
    assert_eq!(instances[0].variables, variables());
    assert_eq!(
        instances[0].value.as_ref().unwrap()["nextCursor"],
        serde_json::Value::Null
    );
    assert_eq!(
        serde_json::to_value(&instances).unwrap(),
        serde_json::json!([{
            "variables": {"input": {"limit": 1}},
            "value": {
                "nextCursor": null,
                "items": [{"__typename": "GraphqlSoupDocument", "id": "doc-1"}]
            }
        }])
    );
}

#[test]
fn query_variant_inspection_serializes_only_generated_variables() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);

    let variants = block_on(handle.inspect_query_variants(
        QUERY.to_string(),
        Some("Soup".to_string()),
        vec!["user".to_string(), "soup".to_string()],
    ))
    .unwrap();
    assert_eq!(variants.len(), 1);
    assert_eq!(variants[0].variables, variables());
    assert_eq!(
        serde_json::to_value(&variants).unwrap(),
        serde_json::json!([{"variables": {"input": {"limit": 1}}}])
    );
}

#[test]
fn registered_op_is_affected_by_later_writes() {
    let handle = spawn_handle();
    block_on(handle.write(WriteRequest {
        origin_op_id: Some("client:1".to_string()),
        registration: Some(WriteRegistration {
            op_id: "client:1".to_string(),
            entity_resolvers: Vec::new(),
        }),
        query: QUERY.to_string(),
        operation_name: Some("Soup".to_string()),
        variables: variables(),
        data: soup_data(false),
        identity: None,
    }))
    .unwrap();

    // The registered write avoids a read and still observes a later change.
    let result = write(&handle, Some("client:2"), soup_data(true), None);
    assert_eq!(result.affected_ops, vec!["client:1".to_string()]);

    // Torn-down operations stop being reported.
    block_on(handle.teardown("client:1".to_string())).unwrap();
    let result = write(&handle, Some("client:2"), soup_data(false), None);
    assert!(result.affected_ops.is_empty());
}

#[test]
fn identity_mismatch_resets() {
    let handle = spawn_handle();
    let result = write(&handle, None, soup_data(false), Some("user-1"));
    assert!(!result.reset);

    read(&handle, Some("client:1"));
    let result = write(&handle, Some("client:2"), soup_data(true), Some("user-2"));
    assert!(result.reset);
    assert_eq!(result.affected_ops, vec!["client:1".to_string()]);
}

#[test]
fn optimistic_layer_commits_durably() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    read(&handle, Some("client:1"));

    let optimistic = block_on(handle.enqueue_optimistic_mutation(
        Some("client:2".to_string()),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
    ))
    .unwrap();
    assert_eq!(optimistic.result.affected_ops, vec!["client:1".to_string()]);
    let serialized = serde_json::to_value(&optimistic).unwrap();
    assert_eq!(serialized["initialClaim"]["kind"], "claimed");
    assert_eq!(
        serialized["initialClaim"]["mutation"]["transactionId"],
        optimistic.transaction_id
    );
    let InitialMutationClaimWire::Claimed { mutation: claimed } = optimistic.initial_claim else {
        panic!("new queue head should be claimed")
    };
    assert_eq!(claimed.transaction_id, optimistic.transaction_id);

    // The optimistic view answers reads.
    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hit");
    };
    assert_eq!(data, soup_data(true));

    let committed = block_on(handle.commit_optimistic_write(
        optimistic.transaction_id,
        "runner".to_string(),
        claimed.lease_generation,
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
    ))
    .unwrap();
    assert!(!committed.changed.is_empty());

    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hit");
    };
    assert_eq!(data, soup_data(true));
}

#[test]
fn rollback_drops_optimistic_contribution() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);

    let optimistic = block_on(handle.enqueue_optimistic_mutation(
        None,
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
    ))
    .unwrap();
    let InitialMutationClaimWire::Claimed { mutation: claimed } = optimistic.initial_claim else {
        panic!("new queue head should be claimed")
    };

    block_on(handle.rollback_optimistic_write(
        optimistic.transaction_id,
        "runner".to_string(),
        claimed.lease_generation,
    ))
    .unwrap();
    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hit");
    };
    assert_eq!(data, soup_data(false));
}

#[test]
fn invalidate_reports_dependent_ops() {
    let handle = spawn_handle();
    let written = write(&handle, None, soup_data(false), None);
    read(&handle, Some("client:1"));

    let affected = block_on(handle.invalidate(written.changed)).unwrap();
    assert_eq!(affected.affected_ops, vec!["client:1".to_string()]);
}

#[test]
fn clear_wipes_everything() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    block_on(handle.clear()).unwrap();
    assert!(matches!(read(&handle, None), ReadResultWire::Miss));
}

#[test]
fn sole_engine_handle_shuts_turso_down_explicitly() {
    spawn_handle().shutdown().unwrap();
}

#[test]
fn bad_transaction_id_is_an_error() {
    let handle = spawn_handle();
    let error = block_on(handle.rollback_optimistic_write(
        "not-a-number".to_string(),
        "runner".to_string(),
        "1".to_string(),
    ))
    .unwrap_err();
    assert!(error.contains("invalid optimistic transaction id"));
}
