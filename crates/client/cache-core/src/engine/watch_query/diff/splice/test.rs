use super::*;
use proptest::prelude::*;
use serde_json::json;

fn rows(ids: &[u8]) -> Vec<Json> {
    ids.iter()
        .map(|id| json!({"__typename": "Row", "id": id.to_string()}))
        .collect()
}

/// Replays a plan on the source list, as subscribers do.
fn replay(before: &[Json], after: &[Json], ops: &[Op]) -> Vec<Json> {
    let mut items = before.to_vec();
    for op in ops {
        match *op {
            Op::Remove(index) => {
                items.remove(index);
            }
            Op::Move { from, to } => {
                let item = items.remove(from);
                items.insert(to, item);
            }
            Op::Insert { at, item } => items.insert(at, after[item].clone()),
        }
    }
    items
}

#[test]
fn single_insert_remove_and_move_are_one_operation() {
    let before = rows(&[0, 1, 2, 3, 4]);
    for (after, expected) in [
        (
            rows(&[0, 1, 9, 2, 3, 4]),
            vec![Op::Insert { at: 2, item: 2 }],
        ),
        (rows(&[0, 1, 3, 4]), vec![Op::Remove(2)]),
        (rows(&[1, 2, 3, 4, 0]), vec![Op::Move { from: 0, to: 4 }]),
        (rows(&[4, 0, 1, 2, 3]), vec![Op::Move { from: 4, to: 0 }]),
        (rows(&[0, 3, 1, 2, 4]), vec![Op::Move { from: 3, to: 1 }]),
    ] {
        let plan = plan(&before, &after);
        assert_eq!(plan.ops, expected, "{after:?}");
        assert_eq!(replay(&before, &after, &plan.ops), after);
    }
}

#[test]
fn identity_includes_typename_and_requires_unique_ids() {
    assert!(keyed(&rows(&[1, 2])));
    assert!(!keyed(&rows(&[1, 1])));
    assert!(keyed(&[
        json!({"__typename": "A", "id": "1"}),
        json!({"__typename": "B", "id": "1"})
    ]));
    assert!(!keyed(&[json!({"id": null})]));
    assert!(!keyed(&[json!("scalar")]));
    let before = [json!({"__typename": "A", "id": "1"})];
    let after = [json!({"__typename": "B", "id": "1"})];
    let plan = plan(&before, &after);
    assert_eq!(plan.ops, vec![Op::Remove(0), Op::Insert { at: 0, item: 0 }]);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]
    #[test]
    fn plans_reproduce_the_target_with_minimal_moves(
        before in prop::collection::hash_set(0u8..40, 0..24),
        after in prop::collection::hash_set(0u8..40, 0..24),
        shuffle in any::<prop::sample::Index>(),
    ) {
        let before: Vec<u8> = before.into_iter().collect();
        let mut after: Vec<u8> = after.into_iter().collect();
        if !after.is_empty() {
            let pivot = shuffle.index(after.len());
            after.rotate_left(pivot);
        }
        let (before, after) = (rows(&before), rows(&after));
        let plan = plan(&before, &after);
        prop_assert_eq!(replay(&before, &after, &plan.ops), after.clone());
        let survivors = plan.sources.iter().flatten().count();
        let removed = before.len() - survivors;
        let inserted = after.len() - survivors;
        let stable = longest_increasing(&plan.sources).len();
        prop_assert!(plan.ops.len() <= removed + inserted + survivors - stable);
        for (index, source) in plan.sources.iter().enumerate() {
            if let Some(source) = source {
                prop_assert_eq!(&before[*source], &after[index]);
            }
        }
    }
}
