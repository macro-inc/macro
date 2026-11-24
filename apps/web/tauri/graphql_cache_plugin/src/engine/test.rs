use super::*;
use pollster::block_on;

mod authority;
mod bench;
mod calendar;
mod channel_timeline;
mod people;
mod soup;
mod watch;

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

#[test]
fn scoped_native_hydration_rejects_late_pages_after_clear() {
    let handle = spawn_handle();
    let scope = HydrationScope {
        contact_fence: None,
        storage_generation: block_on(handle.current_storage_generation())
            .unwrap()
            .parse()
            .unwrap(),
        identity: "viewer".into(),
    };
    let hydrate = || {
        block_on(handle.hydrate_query(
            "{ user { id } }".into(),
            None,
            Variables::new(),
            serde_json::json!({"user":{"id":"viewer"}}),
            Some("viewer".into()),
            Some(scope.clone()),
            None,
        ))
    };
    assert!(!hydrate().unwrap().write_result.reset);
    block_on(handle.clear()).unwrap();
    assert_eq!(
        hydrate().err().as_deref(),
        Some("cache hydration scope changed")
    );
    assert_ne!(
        block_on(handle.current_storage_generation()).unwrap(),
        scope.storage_generation.to_string()
    );
}

#[test]
fn storage_generation_survives_native_reopening_and_rotates_after_clear() {
    let dir = tempfile::tempdir().unwrap();
    let database = cache_turso::TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
    let handle = EngineHandle::new(database.open_or_reset("scope-1").unwrap(), None);
    let first = block_on(handle.current_storage_generation()).unwrap();
    assert_eq!(
        block_on(handle.clone().current_storage_generation()).unwrap(),
        first
    );
    handle.shutdown().unwrap();
    let handle = EngineHandle::new(database.open_or_reset("scope-1").unwrap(), None);
    assert_eq!(
        block_on(handle.current_storage_generation()).unwrap(),
        first
    );
    block_on(handle.clear()).unwrap();
    let replacement = block_on(handle.current_storage_generation()).unwrap();
    assert_ne!(replacement, first);
    assert_eq!(
        block_on(handle.current_storage_generation()).unwrap(),
        replacement
    );
    handle.shutdown().unwrap();
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
        channel_commit: None,
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

fn empty_write_result() -> WriteResultWire {
    WriteResultWire {
        unchanged_views: None,
        field_changes: None,
        identity_errors: Vec::new(),
        unwritable_response: None,
        channel: None,
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

#[test]
fn query_writes_preserve_search_proof_and_viewer_field_scope_through_native_wire() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), Some("viewer"));
    read(&handle, Some("client:1"));
    let mut other = variables();
    other.insert("input".into(), serde_json::json!({"limit":2}));
    let result = block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: QUERY.into(),
        operation_name: Some("Soup".into()),
        variables: other,
        data: soup_data(false),
        identity: Some("viewer".into()),
        channel_commit: None,
    }))
    .unwrap();
    assert!(result.revision_advanced);
    assert!(result.affected_ops.is_empty());
    assert_eq!(
        serde_json::to_value(result).unwrap()["searchChangedBuckets"],
        serde_json::json!([])
    );
    let reset = write(&handle, None, soup_data(false), Some("new-viewer"));
    assert!(reset.reset);
    assert!(
        serde_json::to_value(reset)
            .unwrap()
            .get("searchChangedBuckets")
            .is_none()
    );
    handle.shutdown().unwrap();
}

#[test]
fn tagged_wire_enum_fields_are_camel_case() {
    let mut committed = empty_write_result();
    committed
        .identity_errors
        .push("missing identity response object".into());
    committed.unwritable_response = Some("unknown field".into());
    let value =
        serde_json::to_value(CommitOptimisticWriteResultWire::Committed { result: committed })
            .unwrap();
    assert_eq!(value["kind"], "committed");
    assert_eq!(
        value["identityErrors"],
        serde_json::json!(["missing identity response object"])
    );
    assert_eq!(value["unwritableResponse"], "unknown field");
    assert_eq!(
        serde_json::to_value(MutationUpsertKindWire::ReplacedPending {
            removed_transaction_id: "1".to_string(),
        })
        .unwrap(),
        serde_json::json!({"kind": "replaced-pending", "removedTransactionId": "1"})
    );
    assert_eq!(
        serde_json::to_value(MutationUpsertKindWire::AppendedAfterActive {
            active_transaction_id: "2".to_string(),
        })
        .unwrap(),
        serde_json::json!({"kind": "appended-after-active", "activeTransactionId": "2"})
    );
    assert_eq!(
        serde_json::to_value(DeferOptimisticWriteResultWire::DiscardedSuperseded {
            replacement_transaction_id: "3".to_string(),
            result: empty_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "3"
    );
    assert_eq!(
        serde_json::to_value(CommitOptimisticWriteResultWire::CommittedSuperseded {
            replacement_transaction_id: "4".to_string(),
            result: empty_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "4"
    );
    for replacement_transaction_id in [None, Some("4".to_string())] {
        let value = serde_json::to_value(CommitOptimisticWriteResultWire::Failed {
            error: "missing identity response id".to_string(),
            replacement_transaction_id: replacement_transaction_id.clone(),
            result: empty_write_result(),
        })
        .unwrap();
        assert_eq!(value["kind"], "failed");
        assert_eq!(value["error"], "missing identity response id");
        assert_eq!(
            value
                .get("replacementTransactionId")
                .and_then(serde_json::Value::as_str),
            replacement_transaction_id.as_deref()
        );
    }
    assert_eq!(
        serde_json::to_value(RollbackOptimisticWriteResultWire::DiscardedSuperseded {
            replacement_transaction_id: "5".to_string(),
            result: empty_write_result(),
        })
        .unwrap()["replacementTransactionId"],
        "5"
    );
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
fn identical_hydration_does_not_advance_the_native_revision() {
    let handle = spawn_handle();
    let hydrate = || {
        block_on(handle.hydrate_query(
            HYDRATION_QUERY.to_string(),
            Some("Soup".to_string()),
            variables(),
            soup_data(true),
            None,
            None,
            None,
        ))
        .unwrap()
        .write_result
    };
    let first = hydrate();
    let duplicate = hydrate();
    assert!(first.revision_advanced);
    assert!(!duplicate.revision_advanced);
    assert_eq!(first.revision, duplicate.revision);
}

#[test]
fn hydration_returns_only_unmarked_fields_and_retains_entities_without_pages() {
    let handle = spawn_handle();
    let result = block_on(handle.hydrate_query(
        HYDRATION_QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        None,
        None,
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
    assert!(matches!(read(&handle, None), ReadResultWire::Miss));
    let ReadResultWire::Hit { data } = block_on(handle.read(
        None,
        "query Viewer { user { id } }".to_string(),
        Some("Viewer".to_string()),
        Variables::new(),
        Vec::new(),
    ))
    .unwrap() else {
        panic!("expected hydrated viewer");
    };
    assert_eq!(data, serde_json::json!({"user": {"id": "user-1"}}));
    let records = block_on(handle.read_records_by_keys(
        "fragment Document on GraphqlSoupDocument { __typename id }".to_string(),
        "Document".to_string(),
        vec!["GraphqlSoupDocument:doc-1".to_string()],
    ))
    .unwrap();
    assert_eq!(records.records.len(), 1);
    assert_eq!(
        records.records[0].record,
        serde_json::json!({"__typename": "GraphqlSoupDocument", "id": "doc-1"})
    );
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
        channel_commit: None,
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
        channel_commit: None,
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
        channel_commit: None,
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
        "00000000-0000-4000-8000-000000000001".to_string(),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        vec![],
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
        Some(serde_json::json!({"draftRevision": 10})),
        vec![],
    ))
    .unwrap();
    assert_eq!(optimistic.result.affected_ops, vec!["client:1".to_string()]);
    let serialized = serde_json::to_value(&optimistic).unwrap();
    assert_eq!(serialized["upsertKind"]["kind"], "inserted");
    assert_eq!(serialized["initialClaim"]["kind"], "claimed");
    assert_eq!(
        serialized["initialClaim"]["mutation"]["transactionId"],
        optimistic.transaction_id
    );
    let InitialMutationClaimWire::Claimed { mutation: claimed } = optimistic.initial_claim else {
        panic!("new queue head should be claimed")
    };
    assert_eq!(claimed.transaction_id, optimistic.transaction_id);
    assert_eq!(claimed.uuid, "00000000-0000-4000-8000-000000000001");
    assert!(!claimed.superseded);
    assert!(!claimed.requires_confirmation);
    assert_eq!(
        claimed.client_metadata,
        Some(serde_json::json!({"draftRevision": 10}))
    );
    let inspected = block_on(handle.inspect_mutations()).unwrap();
    assert_eq!(inspected[0].client_metadata, claimed.client_metadata);
    assert_eq!(inspected[0].transaction_id, claimed.transaction_id);
    assert!(
        block_on(handle.claim_next_mutation("another-runner".into(), 20, 100))
            .unwrap()
            .is_none()
    );

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
    let CommitOptimisticWriteResultWire::Committed { result: committed } = committed else {
        panic!("current transaction was reported as superseded")
    };
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
        "00000000-0000-4000-8000-000000000002".to_string(),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        vec![],
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
        None,
        vec![],
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

/// Writes until the WAL is due, then leaves the engine quiet: the idle task has
/// copied it by the time the next command looks, so a copy there finds
/// nothing to do. Without the idle caller that copy still runs.
#[test]
fn quiet_engine_checkpoints_the_wal_off_the_command_path() {
    let dir = tempfile::tempdir().unwrap();
    let database = cache_turso::TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
    let handle = EngineHandle::new(database.open_or_reset("scope-1").unwrap(), None);
    let mut due = None;
    for batch in 0..200 {
        let items: Vec<_> = (0..200)
            .map(|n| serde_json::json!({"__typename": "GraphqlSoupDocument", "id": format!("{batch:04}-{n:04}-{}", "x".repeat(200))}))
            .collect();
        write(
            &handle,
            None,
            serde_json::json!({"user": {"id": "user-1", "soup": {"nextCursor": null, "items": items}}}),
            None,
        );
        // The write armed the idle task; wait until it has run.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        while !handle.inner.idle_settled() {
            assert!(std::time::Instant::now() < deadline, "idle task never ran");
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        let state = block_on(handle.inner.lock());
        let checkpoint = state.engine.storage().checkpoint_if_due().unwrap();
        if checkpoint.wal_frames >= 500 {
            due = Some(checkpoint);
            break;
        }
    }
    let checkpoint = due.expect("the WAL reached 500 frames");
    assert!(
        !checkpoint.ran,
        "the idle task already copied it: {checkpoint:?}"
    );
    handle.shutdown().unwrap();
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

#[test]
fn native_runtime_schema_persists_across_ota_and_rejects_conflicts_without_data_loss() {
    block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let bundled = cache_core::meta::bundled_schema();
        let open = |schema: &Arc<cache_core::meta::Schema>| {
            let (storage, adoption) =
                crate::commands::open_cache(dir.path(), "scope-1", schema).unwrap();
            assert!(
                matches!(
                    adoption.change,
                    None | Some(cache_core::schema_change::Tier::Compatible)
                ),
                "{:?}",
                adoption.change
            );
            assert_eq!(adoption.dropped_records, 0);
            EngineHandle::with_schema(storage, None, adoption.schema)
        };
        let handle = open(&bundled);
        let generation = handle.current_storage_generation().await.unwrap();
        let sdl = format!(
            "{}\nextend type GraphqlUser {{ runtimeLabel: String }}",
            cache_core::meta::BUNDLED_SCHEMA_SDL
        );
        let schema = cache_core::meta::Schema::from_sdl(&sdl).unwrap();
        handle.install_schema(&schema).await.unwrap();
        let query = "query { user { id runtimeLabel } }";
        let data = serde_json::json!({"user": {"id": "viewer", "runtimeLabel": "OTA"}});
        handle
            .write(WriteRequest {
                origin_op_id: None,
                registration: None,
                query: query.into(),
                operation_name: None,
                variables: Variables::new(),
                data: data.clone(),
                identity: None,
                channel_commit: None,
            })
            .await
            .unwrap();
        // Older windows/bundles may initialize again without downgrading metadata.
        handle.install_schema(&bundled).await.unwrap();
        let conflict = cache_core::meta::Schema::from_sdl(
            &sdl.replace("runtimeLabel: String", "runtimeLabel: [String]"),
        )
        .unwrap();
        assert!(handle.install_schema(&conflict).await.is_err());
        handle.shutdown().unwrap();
        // The OTA bundle opens next, then the bundle an OTA rollback returns
        // to: the stored schema keeps the field the older one lacks.
        for schema in [schema, bundled] {
            let reopened = open(&schema);
            assert_eq!(
                reopened.current_storage_generation().await.unwrap(),
                generation
            );
            assert!(
                matches!(reopened.read(None, query.into(), None, Variables::new(), vec![]).await.unwrap(), ReadResultWire::Hit { data: actual } if actual == data)
            );
            reopened.shutdown().unwrap();
        }
    });
}

#[test]
fn a_staged_native_hydrate_writes_and_reports_what_a_whole_one_does() {
    let run = |staging: bool| {
        super::test_hooks::STAGING.with(|on| on.set(staging));
        super::test_hooks::STAGED_COMMITS.with(|commits| commits.set(0));
        super::test_hooks::YIELDS.with(|yields| yields.set(0));
        let handle = spawn_handle();
        let scope = HydrationScope {
            contact_fence: None,
            storage_generation: block_on(handle.current_storage_generation())
                .unwrap()
                .parse()
                .unwrap(),
            identity: "user-1".into(),
        };
        let bound = || Some("user-1".to_string());
        let mut results = Vec::new();
        // The first bound hydrate binds the account, so it runs whole.
        for (data, identity, scope) in [
            (soup_data(true), None, None),
            (soup_data(true), None, None),
            (soup_data(false), None, None),
            (soup_data(true), bound(), Some(scope.clone())),
            (soup_data(true), bound(), Some(scope)),
            (soup_data(false), bound(), None),
        ] {
            let result = block_on(handle.hydrate_query(
                HYDRATION_QUERY.to_string(),
                Some("Soup".to_string()),
                variables(),
                data,
                identity,
                scope,
                None,
            ))
            .unwrap();
            results.push(serde_json::json!({
                "unchangedViews": result.unchanged_views,
                "searchChangedBuckets": result.search_changed_buckets,
                "writeResult": result.write_result,
                "data": result.data,
            }));
            let ReadResultWire::Hit { data } = block_on(handle.read(
                None,
                "query Viewer { user { id } }".to_string(),
                Some("Viewer".to_string()),
                Variables::new(),
                Vec::new(),
            ))
            .unwrap() else {
                panic!("expected hydrated viewer");
            };
            results.push(data);
        }
        let staged = super::test_hooks::STAGED_COMMITS.with(std::cell::Cell::get);
        let yields = super::test_hooks::YIELDS.with(std::cell::Cell::get);
        super::test_hooks::STAGING.with(|on| on.set(true));
        (results, staged, yields)
    };
    let (whole, none_staged, no_yields) = run(false);
    let (staged, staged_commits, yields) = run(true);
    assert_eq!((none_staged, no_yields), (0, 0));
    // Reads may run after the authoritative rows, after each of the three
    // projection passes and after staging: 5 times a staged hydrate. The
    // binding hydrate yields 4 times, up to staging, and then runs whole.
    assert_eq!((staged_commits, yields), (5, 5 * 5 + 4));
    assert_eq!(staged, whole);
}

#[test]
fn a_failed_staging_read_fails_the_native_hydrate_instead_of_retrying_it_whole() {
    let handle = spawn_handle();
    super::test_hooks::STAGED_COMMITS.with(|commits| commits.set(0));
    super::test_hooks::FAIL_STAGE.with(|fail| fail.set(true));
    let result = block_on(handle.hydrate_query(
        HYDRATION_QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        None,
        None,
        None,
    ));
    assert_eq!(result.err().as_deref(), Some("injected staging failure"));
    assert_eq!(
        super::test_hooks::STAGED_COMMITS.with(std::cell::Cell::get),
        0
    );
    let ReadResultWire::Miss = block_on(handle.read(
        None,
        "query Viewer { user { id } }".to_string(),
        Some("Viewer".to_string()),
        Variables::new(),
        Vec::new(),
    ))
    .unwrap() else {
        panic!("a failed hydrate writes nothing");
    };
}

fn poll_once<F: std::future::Future>(
    future: std::pin::Pin<&mut F>,
    waker: &std::task::Waker,
) -> std::task::Poll<F::Output> {
    future.poll(&mut std::task::Context::from_waker(waker))
}

/// An abandoned read keeps its place in the engine's queue, whether it waits
/// for the engine or, behind a command, for a turn; when its turn comes it
/// gives the engine back without reading, and the reads queued after it run.
#[test]
fn an_abandoned_read_skips_its_turn_and_the_rest_still_run() {
    block_on(async {
        let handle = spawn_handle();
        let noop = std::task::Waker::noop();
        for behind_a_command in [false, true] {
            let gone = handle.clone().abandonable(Some("gone".to_owned()));
            let kept = handle.clone().abandonable(Some("kept".to_owned()));
            let unnamed = handle.clone();
            let reused = handle.clone().abandonable(Some("kept".to_owned()));
            assert!(reused.abandon.is_none(), "a running id registers once");
            assert_eq!(handle.abandons.running(), 2);

            let held = handle.inner.write().await;
            let mut command = Box::pin(handle.inner.lock());
            if behind_a_command {
                assert!(poll_once(command.as_mut(), noop).is_pending());
            }
            let mut gone_read = Box::pin(gone.current_authority("scope-1"));
            assert!(poll_once(gone_read.as_mut(), noop).is_pending());
            let mut kept_read = Box::pin(kept.current_authority("scope-1"));
            assert!(poll_once(kept_read.as_mut(), noop).is_pending());
            let mut unnamed_read = Box::pin(unnamed.current_authority("scope-1"));
            assert!(poll_once(unnamed_read.as_mut(), noop).is_pending());

            assert!(handle.abandon("gone"));
            assert!(!handle.abandon("never-sent"));
            assert!(
                poll_once(gone_read.as_mut(), noop).is_pending(),
                "an abandoned read keeps its place while the engine is held"
            );
            drop(held);
            if behind_a_command {
                drop(command.await);
            } else {
                drop(command);
            }
            assert_eq!(gone_read.await.unwrap_err(), abandon::ABANDONED);
            assert!(kept_read.await.is_ok());
            assert!(unnamed_read.await.is_ok());
            drop((gone, kept, unnamed, reused));
            assert_eq!(handle.abandons.running(), 0);
        }
        // An abandon after the read finished changes nothing for the next one.
        assert!(!handle.abandon("kept"));
        let again = handle.clone().abandonable(Some("kept".to_owned()));
        assert!(again.current_authority("scope-1").await.is_ok());
    });
}

/// Abandons `reader`'s queued `read` while the engine is held, then lets it
/// take its turn, which it skips.
fn abandon_queued<T: std::fmt::Debug>(
    handle: &EngineHandle,
    request_id: &str,
    read: impl std::future::Future<Output = Result<T, String>>,
) {
    block_on(async {
        let held = handle.inner.write().await;
        let mut read = Box::pin(read);
        assert!(poll_once(read.as_mut(), std::task::Waker::noop()).is_pending());
        assert!(handle.abandon(request_id));
        drop(held);
        assert_eq!(read.await.unwrap_err(), abandon::ABANDONED);
    });
}

/// A read of an operation registers the records it depends on, so later
/// writes report the operation. One abandoned before it ran registers the
/// operation against every change instead, so the next write still reports
/// it and the webview reads it again.
#[test]
fn an_abandoned_read_of_an_operation_is_still_reported_by_the_next_write() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    let reader = handle.clone().abandonable(Some("read-1".to_owned()));
    abandon_queued(
        &handle,
        "read-1",
        reader.read(
            Some("client:1".to_owned()),
            QUERY.to_owned(),
            Some("Soup".to_owned()),
            variables(),
            Vec::new(),
        ),
    );
    let result = write(&handle, Some("client:2"), soup_data(true), None);
    assert_eq!(result.affected_ops, vec!["client:1".to_string()]);
}

/// A watch the webview abandoned drops its retained view, so the next watch
/// from the webview's last revision reads the operation whole.
#[test]
fn an_abandoned_watch_makes_the_next_watch_read_whole() {
    use cache_core::engine::watch_query::QueryUpdate;
    async fn watch(handle: &EngineHandle, since: Option<String>) -> Result<QueryUpdate, String> {
        handle
            .watch(
                "view:1".into(),
                QUERY.into(),
                None,
                variables(),
                vec![],
                since,
            )
            .await
    }
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    let QueryUpdate::Hit { revision, .. } = block_on(watch(&handle, None)).unwrap() else {
        panic!("expected initial snapshot");
    };
    let reader = handle.clone().abandonable(Some("watch-1".to_owned()));
    abandon_queued(&handle, "watch-1", watch(&reader, Some(revision.clone())));
    assert!(matches!(
        block_on(watch(&handle, Some(revision))).unwrap(),
        QueryUpdate::Hit { .. }
    ));
}

/// An abandoned read registers its operation in its own turn, so a teardown
/// queued behind it still has the last word, as it had over the read.
#[test]
fn a_teardown_queued_behind_an_abandoned_read_still_unregisters_it() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    let reader = handle.clone().abandonable(Some("read-1".to_owned()));
    block_on(async {
        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut read = Box::pin(reader.read(
            Some("client:1".to_owned()),
            QUERY.to_owned(),
            Some("Soup".to_owned()),
            variables(),
            Vec::new(),
        ));
        assert!(poll_once(read.as_mut(), noop).is_pending());
        let mut teardown = Box::pin(handle.teardown("client:1".to_owned()));
        assert!(poll_once(teardown.as_mut(), noop).is_pending());
        assert!(handle.abandon("read-1"));
        drop(held);
        // Polled in reverse: only the queue's order decides which runs first.
        let (torn_down, read) = tokio::join!(teardown, read);
        torn_down.unwrap();
        assert_eq!(read.unwrap_err(), abandon::ABANDONED);
    });
    let result = write(&handle, Some("client:2"), soup_data(true), None);
    assert!(result.affected_ops.is_empty());
}

#[test]
fn a_confirmed_response_that_does_not_normalize_retires_the_write() {
    let handle = spawn_handle();
    let optimistic = block_on(handle.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-000000000009".to_string(),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        vec![],
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
        None,
        vec![],
    ))
    .unwrap();
    let InitialMutationClaimWire::Claimed { mutation: claimed } = optimistic.initial_claim else {
        panic!("new queue head should be claimed")
    };

    // No retry of this response can be written, so it settles without its
    // content and the queue moves on.
    let committed = block_on(handle.commit_optimistic_write(
        optimistic.transaction_id,
        "runner".to_string(),
        claimed.lease_generation,
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        serde_json::json!({"user": {"id": "user-1", "soup": "malformed"}}),
    ))
    .unwrap();
    let CommitOptimisticWriteResultWire::Committed { result } = committed else {
        panic!("settles: {committed:?}");
    };
    assert!(result.unwritable_response.is_some());
    assert!(block_on(handle.inspect_mutations()).unwrap().is_empty());
}
