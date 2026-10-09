use super::*;
use cache_core::engine::watch_query::{QueryUpdate, WatchOptions};

#[test]
fn native_watches_use_the_same_core_cursor_and_teardown_contract() {
    let handle = spawn_handle();
    write(&handle, None, soup_data(false), None);
    let first = block_on(handle.watch(
        "view:1".into(),
        QUERY.into(),
        None,
        variables(),
        vec![],
        None,
        WatchOptions::default(),
    ))
    .unwrap();
    let QueryUpdate::Hit { revision, .. } = first else {
        panic!("expected initial snapshot");
    };
    let next = block_on(handle.watch(
        "view:1".into(),
        QUERY.into(),
        None,
        variables(),
        vec![],
        Some(revision.clone()),
        WatchOptions::default(),
    ))
    .unwrap();
    assert!(matches!(next, QueryUpdate::Patch { patches, .. } if patches.is_empty()));
    block_on(handle.teardown("view:1".into())).unwrap();
    let next = block_on(handle.watch(
        "view:1".into(),
        QUERY.into(),
        None,
        variables(),
        vec![],
        Some(revision),
        WatchOptions::default(),
    ))
    .unwrap();
    assert!(matches!(next, QueryUpdate::Hit { .. }));
    handle.shutdown().unwrap();
}

#[test]
fn native_watches_splice_keyed_lists_only_for_subscribers_that_ask() {
    let handle = spawn_handle();
    let page = |ids: &[&str]| {
        serde_json::json!({"user": {"id": "user-1", "soup": {
            "nextCursor": null,
            "items": ids.iter().map(|id| serde_json::json!({
                "__typename": "GraphqlSoupDocument", "id": id
            })).collect::<Vec<_>>()
        }}})
    };
    write(&handle, None, page(&["doc-1", "doc-2"]), None);
    let watch = |op: &str, since: Option<String>, splices: bool| {
        block_on(handle.watch(
            op.into(),
            QUERY.into(),
            None,
            variables(),
            vec![],
            since,
            WatchOptions { splices },
        ))
        .unwrap()
    };
    let revision = |update: QueryUpdate| match update {
        QueryUpdate::Hit { revision, .. } => revision,
        other => panic!("expected initial snapshot: {other:?}"),
    };
    let spliced = revision(watch("view:1", None, true));
    let replaced = revision(watch("view:2", None, false));
    write(&handle, None, page(&["doc-2"]), None);
    let patches = |update: QueryUpdate| match update {
        QueryUpdate::Patch { patches, .. } => serde_json::to_value(patches).unwrap(),
        other => panic!("expected a patch: {other:?}"),
    };
    assert_eq!(
        patches(watch("view:1", Some(spliced), true)),
        serde_json::json!([{"path": ["user", "soup", "items"], "splice": [{"remove": 0}]}])
    );
    assert_eq!(
        patches(watch("view:2", Some(replaced), false)),
        serde_json::json!([{
            "path": ["user", "soup", "items"],
            "value": [{"__typename": "GraphqlSoupDocument", "id": "doc-2"}]
        }])
    );
    handle.shutdown().unwrap();
}
