use super::*;

fn key(id: &str) -> EntityKey<'static> {
    EntityKey(format!("GraphqlSoupEmailThread:{id}").into())
}

#[test]
fn the_fence_records_edits_only_while_a_run_lives() {
    let mut fence = SyncFence::default();
    fence.fence([key("a")]);
    assert!(fence.records.is_empty(), "no run: nothing recorded");

    let (begun, token) = fence.begin();
    fence.fence([key("b")]);
    assert!(fence.holds(begun, &key("b")));

    drop(token);
    fence.fence([key("c")]);
    assert!(fence.records.is_empty(), "the run ended: records cleared");
}
