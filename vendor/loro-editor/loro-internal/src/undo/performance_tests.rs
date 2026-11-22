use super::*;
use crate::delta::{ResolvedMapDelta, ResolvedMapValue};
use loro_common::{ContainerType, ID};

#[test]
fn empty_remote_diffs_skip_group_scans_at_small_medium_and_large_sizes() {
    for size in [190, 3835, 36530] {
        let group = UndoGroup {
            start_counter: 0,
            affected_cids: (0..size)
                .map(|index| ContainerID::new_normal(ID::new(7, index), ContainerType::Text))
                .collect(),
        };
        let mut stack = Stack::new();
        let mut first = UndoItemMeta::new();
        first.set_value("first".into());
        stack.push(CounterSpan::new(0, 1), first);
        GROUP_SCAN_VISITS.with(|visits| visits.set(0));
        stack.push_with_merge(
            CounterSpan::new(1, 2),
            UndoItemMeta::new(),
            true,
            Some(&group),
        );
        assert_eq!(GROUP_SCAN_VISITS.with(|visits| visits.get()), 0);
        assert_eq!(stack.size, 1);
        assert_eq!(stack.stack.len(), 1);
        assert_eq!(stack.stack[0].0[0].span, CounterSpan::new(0, 2));
        assert_eq!(stack.stack[0].0[0].meta.value, LoroValue::from("first"));
    }
}

#[test]
fn conflicting_remote_diff_still_starts_a_new_row() {
    let cid = ContainerID::new_root("text", ContainerType::Map);
    let group = UndoGroup {
        start_counter: 0,
        affected_cids: [cid.clone()].into_iter().collect(),
    };
    let mut stack = Stack::new();
    stack.push(CounterSpan::new(0, 1), UndoItemMeta::new());
    stack.stack[0].1.lock().cid_to_events.insert(
        cid,
        Diff::Map(
            ResolvedMapDelta::default().with_entry("value".into(), ResolvedMapValue::new_unset()),
        ),
    );
    stack.push_with_merge(
        CounterSpan::new(1, 2),
        UndoItemMeta::new(),
        true,
        Some(&group),
    );
    assert_eq!(stack.stack.len(), 2);
    assert_eq!(stack.size, 2);
    assert_eq!(stack.stack[0].0[0].span, CounterSpan::new(0, 1));
    assert_eq!(stack.stack[1].0[0].span, CounterSpan::new(1, 2));
}

#[test]
fn disjoint_remote_diff_still_allows_the_local_group_to_merge() {
    let group = UndoGroup {
        start_counter: 0,
        affected_cids: [ContainerID::new_root("local", ContainerType::Map)]
            .into_iter()
            .collect(),
    };
    let mut stack = Stack::new();
    stack.push(CounterSpan::new(0, 1), UndoItemMeta::new());
    stack.stack[0].1.lock().cid_to_events.insert(
        ContainerID::new_root("remote", ContainerType::Map),
        Diff::Map(
            ResolvedMapDelta::default().with_entry("value".into(), ResolvedMapValue::new_unset()),
        ),
    );
    stack.push_with_merge(
        CounterSpan::new(1, 2),
        UndoItemMeta::new(),
        true,
        Some(&group),
    );
    assert_eq!(stack.stack.len(), 1);
    assert_eq!(stack.size, 1);
    assert_eq!(stack.stack[0].0[0].span, CounterSpan::new(0, 2));
}

#[test]
fn empty_remote_entry_still_counts_as_disjoint() {
    let cid = ContainerID::new_root("local", ContainerType::Map);
    let group = UndoGroup {
        start_counter: 0,
        affected_cids: [cid.clone()].into_iter().collect(),
    };
    let mut stack = Stack::new();
    stack.push(CounterSpan::new(0, 1), UndoItemMeta::new());
    stack.stack[0]
        .1
        .lock()
        .cid_to_events
        .insert(cid, Diff::Map(ResolvedMapDelta::default()));
    stack.push_with_merge(
        CounterSpan::new(1, 2),
        UndoItemMeta::new(),
        true,
        Some(&group),
    );
    assert_eq!(stack.stack.len(), 1);
    assert_eq!(stack.size, 1);
    assert_eq!(stack.stack[0].0[0].span, CounterSpan::new(0, 2));
}

#[test]
fn remote_diffs_without_an_explicit_group_still_start_a_new_row() {
    let mut stack = Stack::new();
    stack.push(CounterSpan::new(0, 1), UndoItemMeta::new());
    stack.stack[0].1.lock().cid_to_events.insert(
        ContainerID::new_root("remote", ContainerType::Map),
        Diff::Map(
            ResolvedMapDelta::default().with_entry("value".into(), ResolvedMapValue::new_unset()),
        ),
    );
    stack.push_with_merge(CounterSpan::new(1, 2), UndoItemMeta::new(), true, None);
    assert_eq!(stack.stack.len(), 2);
    assert_eq!(stack.size, 2);
    assert_eq!(stack.stack[0].0[0].span, CounterSpan::new(0, 1));
    assert_eq!(stack.stack[1].0[0].span, CounterSpan::new(1, 2));
}
