use super::*;
use serde_json::json;

fn patches(before: Json, after: Json) -> Json {
    let diff = diff_response(&before, &after, usize::MAX).expect("root is patchable");
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
    assert!(diff_response(&json!({"a": 1}), &json!({"b": 1}), usize::MAX).is_none());
    assert!(diff_response(&json!({"a": 1}), &json!({"a": 1, "b": 2}), usize::MAX).is_none());
    assert!(diff_response(&json!(null), &json!({"a": 1}), usize::MAX).is_none());
}

#[test]
fn replacements_beyond_the_budget_are_not_patches() {
    let before = json!({"small": 1, "list": ["a", "b"]});
    let after = json!({"small": 2, "list": ["a"]});
    let list = json_bytes(&after["list"]);
    let small = json_bytes(&after["small"]);
    assert!(diff_response(&before, &after, small + list).is_some());
    assert!(diff_response(&before, &after, small + list - 1).is_none());
}

#[test]
fn applied_patches_reproduce_the_target_and_track_bytes() {
    let before = json!({"a": "short", "b": [1, 2], "c": {"d": null}});
    let after = json!({"a": "much longer text", "b": [1, 2, 3], "c": {"d": {"e": 1}}});
    let mut data = before.clone();
    let diff = diff_response(&before, &after, usize::MAX).unwrap();
    let expected = json_bytes(&after) as isize - json_bytes(&before) as isize;
    assert_eq!(diff.byte_delta, expected);
    assert_eq!(apply_patches(&mut data, &diff.patches), Some(expected));
    assert_eq!(data, after);
    let missing = LiveFieldPatch {
        path: vec![
            ResponsePathSegment::Field("a".into()),
            ResponsePathSegment::Index(0),
        ],
        value: json!(1),
    };
    let mut patches = diff_response(&after, &before, usize::MAX).unwrap().patches;
    patches.push(missing);
    assert!(apply_patches(&mut data, &patches).is_none());
    assert_eq!(data, after, "an inapplicable batch changes nothing");
}
