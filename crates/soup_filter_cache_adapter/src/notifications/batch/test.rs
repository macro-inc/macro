use super::*;
use crate::notifications::change;
use cache_core::predicate::{ProjectionState, apply_authoritative_projection_mutations};
use item_filter_index::vocabulary;
use predicate_index::IndexDocument;
use std::collections::HashMap;

fn key(id: u128) -> RecordKey {
    RecordKey::new(format!("GraphqlSoupDocument:{}", uuid::Uuid::from_u128(id))).unwrap()
}

fn update(parent: u128, id: u128, state: &str) -> ProjectionMutation {
    change(
        key(parent),
        vocabulary::document_partition(),
        uuid::Uuid::from_u128(id),
        Some(state),
    )
}

#[test]
fn batching_preserves_last_member_state_and_independent_parents() {
    let mutations = vec![
        update(1, 10, "UNSEEN"),
        update(2, 10, "SEEN"),
        update(1, 11, "SEEN"),
        update(1, 10, "SEEN"),
        update(1, 11, "DONE"),
        update(1, 10, "SEEN"),
        update(1, 11, "UNSEEN"),
    ];
    let bases = [1, 2]
        .into_iter()
        .map(|id| {
            let key = key(id);
            (
                key.clone(),
                ProjectionState::Complete(IndexDocument {
                    record_key: key,
                    profile: vocabulary::profile_v4(),
                    partition: vocabulary::document_partition(),
                    exact_facts: vec![],
                    integer_facts: vec![],
                    sort_facts: vec![],
                }),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut expected = bases.clone();
    apply_authoritative_projection_mutations(&mut expected, &mutations);
    let batched = batch_member_changes(mutations);
    assert_eq!(batched.len(), 2);
    let mut actual = bases;
    apply_authoritative_projection_mutations(&mut actual, &batched);
    assert_eq!(actual, expected);
    apply_authoritative_projection_mutations(&mut actual, &batched);
    assert_eq!(actual, expected, "replaying a batch must be idempotent");
}

#[test]
fn member_edits_cannot_clear_invalidation_in_the_same_batch() {
    for mutations in [
        vec![update(1, 10, "INVALID"), update(1, 11, "UNSEEN")],
        vec![update(1, 10, "UNSEEN"), update(1, 11, "INVALID")],
    ] {
        let batched = batch_member_changes(mutations);
        assert!(matches!(
            batched.as_slice(),
            [ProjectionMutation::MarkIncomplete {
                kind: ProjectionIncompleteKind::Dirty,
                ..
            }]
        ));
    }
}

#[test]
fn many_notifications_produce_one_member_edit_per_parent() {
    let batched = batch_member_changes((1..=10_000).map(|id| update(1, id, "SEEN")).collect());
    let [ProjectionMutation::PatchExact { remove, insert, .. }] = batched.as_slice() else {
        panic!("one parent should be composed only once");
    };
    assert_eq!(remove.len(), 20_000);
    assert_eq!(insert.len(), 10_000);
}
