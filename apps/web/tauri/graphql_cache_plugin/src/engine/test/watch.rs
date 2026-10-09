use super::*;
use cache_core::engine::watch_query::QueryUpdate;

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
    ))
    .unwrap();
    assert!(matches!(next, QueryUpdate::Hit { .. }));
    handle.shutdown().unwrap();
}
