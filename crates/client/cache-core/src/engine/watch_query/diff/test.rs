use super::*;
use serde_json::json;

fn sets(patches: Vec<QueryPatch>) -> Vec<LiveFieldPatch> {
    patches
        .into_iter()
        .map(|patch| match patch {
            QueryPatch::Set(patch) => patch,
            QueryPatch::Splice(splice) => panic!("unexpected splice {splice:?}"),
        })
        .collect()
}

fn patches(before: Json, after: Json) -> Json {
    let diff = diff_response(&before, &after, usize::MAX, false).expect("root is patchable");
    serde_json::to_value(diff.patches).unwrap()
}

#[test]
fn scalars_and_matching_objects_patch_only_changed_leaves() {
    assert_eq!(
        patches(
            json!({"user": {"id": "u", "name": "a", "count": 1, "seen": null}}),
            json!({"user": {"id": "u", "name": "b", "count": 1, "seen": true}}),
        ),
        json!([
            {"path": ["user", "name"], "value": "b"},
            {"path": ["user", "seen"], "value": true},
        ])
    );
    assert_eq!(
        patches(json!({"a": {"b": [1]}}), json!({"a": {"b": [1]}})),
        json!([])
    );
}

#[test]
fn changed_key_sets_and_nulls_replace_the_whole_object() {
    assert_eq!(
        patches(
            json!({"value": {"kind": "Select", "selected": ["a"]}}),
            json!({"value": {"kind": "Text", "text": "a"}}),
        ),
        json!([{"path": ["value"], "value": {"kind": "Text", "text": "a"}}])
    );
    assert_eq!(
        patches(json!({"value": {"kind": "Text"}}), json!({"value": null})),
        json!([{"path": ["value"], "value": null}])
    );
    assert_eq!(
        patches(json!({"value": null}), json!({"value": {"kind": "Text"}})),
        json!([{"path": ["value"], "value": {"kind": "Text"}}])
    );
}

#[test]
fn lists_patch_items_only_when_lengths_and_identities_match() {
    let row = |id: &str, name: &str| json!({"__typename": "Doc", "id": id, "name": name});
    assert_eq!(
        patches(
            json!({"items": [row("1", "a"), row("2", "b")]}),
            json!({"items": [row("1", "a"), row("2", "c")]}),
        ),
        json!([{"path": ["items", 1, "name"], "value": "c"}])
    );
    for after in [
        json!({"items": [row("2", "b"), row("1", "a")]}),
        json!({"items": [row("1", "a")]}),
        json!({"items": [row("1", "a"), {"__typename": "Thread", "id": "2", "name": "b"}]}),
    ] {
        assert_eq!(
            patches(
                json!({"items": [row("1", "a"), row("2", "b")]}),
                after.clone()
            ),
            json!([{"path": ["items"], "value": after["items"]}])
        );
    }
    // Embedded objects without identity keep their positions.
    assert_eq!(
        patches(
            json!({"refs": [{"target": "a"}, {"target": "b"}]}),
            json!({"refs": [{"target": "a"}, {"target": "c"}]}),
        ),
        json!([{"path": ["refs", 1, "target"], "value": "c"}])
    );
    // Scalar items are their own identity: a changed scalar replaces its list.
    assert_eq!(
        patches(json!({"ids": ["a", "b"]}), json!({"ids": ["a", "c"]})),
        json!([{"path": ["ids"], "value": ["a", "c"]}])
    );
}

#[test]
fn root_replacements_are_not_patches() {
    assert!(diff_response(&json!({"a": 1}), &json!({"b": 1}), usize::MAX, false).is_none());
    assert!(
        diff_response(
            &json!({"a": 1}),
            &json!({"a": 1, "b": 2}),
            usize::MAX,
            false
        )
        .is_none()
    );
    assert!(diff_response(&json!(null), &json!({"a": 1}), usize::MAX, false).is_none());
}

#[test]
fn replacements_beyond_the_budget_are_not_patches() {
    let before = json!({"small": 1, "list": ["a", "b"]});
    let after = json!({"small": 2, "list": ["a"]});
    let list = json_bytes(&after["list"]);
    let small = json_bytes(&after["small"]);
    assert!(diff_response(&before, &after, small + list, false).is_some());
    assert!(diff_response(&before, &after, small + list - 1, false).is_none());
}

#[test]
fn applied_patches_reproduce_the_target_and_track_bytes() {
    let before = json!({"a": "short", "b": [1, 2], "c": {"d": null}});
    let after = json!({"a": "much longer text", "b": [1, 2, 3], "c": {"d": {"e": 1}}});
    let mut data = before.clone();
    let diff = diff_response(&before, &after, usize::MAX, false).unwrap();
    let expected = json_bytes(&after) as isize - json_bytes(&before) as isize;
    assert_eq!(diff.byte_delta, expected);
    assert_eq!(
        apply_patches(&mut data, &sets(diff.patches)),
        Some(expected)
    );
    assert_eq!(data, after);
    let missing = LiveFieldPatch {
        path: vec![
            ResponsePathSegment::Field("a".into()),
            ResponsePathSegment::Index(0),
        ],
        value: json!(1),
    };
    let mut patches = sets(
        diff_response(&after, &before, usize::MAX, false)
            .unwrap()
            .patches,
    );
    patches.push(missing);
    assert!(apply_patches(&mut data, &patches).is_none());
    assert_eq!(data, after, "an inapplicable batch changes nothing");
}

fn spliced(before: &Json, after: &Json) -> Json {
    let diff = diff_response(before, after, usize::MAX, true).expect("root is patchable");
    let mut applied = before.clone();
    apply_query_patches(&mut applied, &diff.patches).expect("applicable");
    assert_eq!(&applied, after);
    let expected = json_bytes(after) as isize - json_bytes(before) as isize;
    assert_eq!(diff.byte_delta, expected);
    serde_json::to_value(diff.patches).unwrap()
}

#[test]
fn keyed_lists_splice_for_subscribers_that_apply_splices() {
    let row = |id: &str, name: &str| json!({"__typename": "Doc", "id": id, "name": name});
    let before = json!({"items": [row("1", "a"), row("2", "b"), row("3", "c")]});
    assert_eq!(
        spliced(
            &before,
            &json!({"items": [row("1", "a"), row("4", "d"), row("2", "b"), row("3", "c")]})
        ),
        json!([{"path": ["items"], "splice": [{"insert": 1, "value": row("4", "d")}]}])
    );
    assert_eq!(
        spliced(&before, &json!({"items": [row("1", "a"), row("3", "c")]})),
        json!([{"path": ["items"], "splice": [{"remove": 1}]}])
    );
    // A moved item keeps its object; its changed field patches at the new index.
    assert_eq!(
        spliced(
            &before,
            &json!({"items": [row("3", "z"), row("1", "a"), row("2", "b")]})
        ),
        json!([
            {"path": ["items"], "splice": [{"move": 2, "to": 0}]},
            {"path": ["items", 0, "name"], "value": "z"},
        ])
    );
    // Unkeyed and duplicate-keyed lists are still replaced.
    let duplicate = json!({"items": [row("1", "a"), row("1", "b")]});
    assert_eq!(
        spliced(&before, &duplicate),
        json!([{"path": ["items"], "value": duplicate["items"]}])
    );
    assert_eq!(
        spliced(&json!({"ids": ["a", "b"]}), &json!({"ids": ["b"]})),
        json!([{"path": ["ids"], "value": ["b"]}])
    );
    // Without the capability the same edit replaces the list.
    let after = json!({"items": [row("1", "a"), row("3", "c")]});
    assert_eq!(
        patches(before.clone(), after.clone()),
        json!([{"path": ["items"], "value": after["items"]}])
    );
}

#[test]
fn inserted_values_count_against_the_budget() {
    let row = |id: &str| json!({"__typename": "Doc", "id": id});
    let before = json!({"items": [row("1")]});
    let after = json!({"items": [row("1"), row("2")]});
    let inserted = json_bytes(&row("2"));
    assert!(diff_response(&before, &after, inserted, true).is_some());
    assert!(diff_response(&before, &after, inserted - 1, true).is_none());
}

proptest::proptest! {
    #![proptest_config(proptest::prelude::ProptestConfig::with_cases(256))]
    #[test]
    fn spliced_diffs_reproduce_nested_targets(
        before in proptest::collection::btree_map(0u8..12, (0u8..3, proptest::collection::vec(0u8..4, 0..4)), 0..10),
        after in proptest::collection::btree_map(0u8..12, (0u8..3, proptest::collection::vec(0u8..4, 0..4)), 0..10),
        rotate in 0usize..10,
    ) {
        let list = |rows: &std::collections::BTreeMap<u8, (u8, Vec<u8>)>, rotate: usize| {
            let mut items: Vec<Json> = rows.iter().map(|(id, (name, children))| json!({
                "__typename": "Doc", "id": id.to_string(), "name": name,
                "children": children.iter().map(|child| json!({"__typename": "Child", "id": child.to_string()})).collect::<Vec<_>>(),
            })).collect();
            if !items.is_empty() {
                let pivot = rotate % items.len();
                items.rotate_left(pivot);
            }
            json!({"items": items})
        };
        let (before, after) = (list(&before, 0), list(&after, rotate));
        let diff = diff_response(&before, &after, usize::MAX, true).unwrap();
        let mut applied = before.clone();
        proptest::prop_assert!(apply_query_patches(&mut applied, &diff.patches).is_some());
        proptest::prop_assert_eq!(&applied, &after);
        proptest::prop_assert_eq!(
            diff.byte_delta,
            json_bytes(&after) as isize - json_bytes(&before) as isize
        );
    }
}
