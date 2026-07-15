use super::*;
use pollster::block_on;

const QUERY: &str = r#"query Soup($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor hasMore items { id } } }
}"#;

fn variables() -> Variables {
    let serde_json::Value::Object(vars) = serde_json::json!({"input": {"limit": 1}}) else {
        unreachable!()
    };
    vars
}

fn soup_data(has_more: bool) -> serde_json::Value {
    serde_json::json!({
        "user": {
            "id": "user-1",
            "soup": {
                "nextCursor": null,
                "hasMore": has_more,
                "items": [{"id": "doc-1"}]
            }
        }
    })
}

fn spawn_handle() -> EngineHandle {
    let storage = SqliteStorage::open_in_memory("scope-1").unwrap();
    EngineHandle::new(storage, None)
}

fn write(
    handle: &EngineHandle,
    origin: Option<&str>,
    data: serde_json::Value,
    identity: Option<&str>,
) -> WriteResultWire {
    block_on(handle.write(
        origin.map(str::to_string),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        data,
        identity.map(str::to_string),
    ))
    .unwrap()
}

fn read(handle: &EngineHandle, op_id: Option<&str>) -> ReadResultWire {
    block_on(handle.read(
        op_id.map(str::to_string),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
    ))
    .unwrap()
}

fn claim(handle: &EngineHandle) -> ClaimedMutationWire {
    block_on(handle.claim_next_mutation("runner".to_string(), 10, 1_000))
        .unwrap()
        .expect("queue head")
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
fn registered_op_is_affected_by_later_writes() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);

    // Register an active operation, then change its data from another op.
    read(&handle, Some("client:1"));
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

    let optimistic = block_on(handle.begin_optimistic_write(
        Some("client:2".to_string()),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        0,
    ))
    .unwrap();
    assert_eq!(optimistic.result.affected_ops, vec!["client:1".to_string()]);

    // The optimistic view answers reads.
    let ReadResultWire::Hit { data } = read(&handle, None) else {
        panic!("expected hit");
    };
    assert_eq!(data, soup_data(true));

    let claimed = claim(&handle);
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

    let optimistic = block_on(handle.begin_optimistic_write(
        None,
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(true),
        0,
    ))
    .unwrap();

    let claimed = claim(&handle);
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
    assert_eq!(affected, vec!["client:1".to_string()]);
}

#[test]
fn clear_wipes_everything() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    block_on(handle.clear()).unwrap();
    assert!(matches!(read(&handle, None), ReadResultWire::Miss));
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
