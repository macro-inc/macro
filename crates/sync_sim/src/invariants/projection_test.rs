use super::projection_json_matches;
use serde_json::json;

#[test]
fn a_foreign_root_id_in_the_persisted_document_still_matches_the_live_model() {
    let live = json!({"root": {"type": "root", "children": [{"type": "paragraph", "text": "a"}]}});
    let persisted = json!({"root": {
        "type": "root",
        "$": {"id": "Ysu3mkwl"},
        "children": [{"type": "paragraph", "text": "a"}],
    }});
    assert!(projection_json_matches(&live, &persisted));
}

#[test]
fn different_retained_root_ids_and_metadata_still_match() {
    let live = json!({"root": {
        "type": "root",
        "$": {"id": "liveRoot", "documentMetadata": {"version": 11}},
        "children": [],
    }});
    let persisted = json!({"root": {
        "type": "root",
        "$": {"id": "Ysu3mkwl", "documentMetadata": {"version": 10}},
        "children": [],
    }});
    assert!(projection_json_matches(&live, &persisted));
}

#[test]
fn any_other_root_state_key_still_has_to_match() {
    let live =
        json!({"root": {"type": "root", "$": {"id": "a", "searchText": "x"}, "children": []}});
    let persisted =
        json!({"root": {"type": "root", "$": {"id": "a", "searchText": "y"}, "children": []}});
    assert!(!projection_json_matches(&live, &persisted));
}

#[test]
fn a_child_difference_still_fails() {
    let live = json!({"root": {"type": "root", "children": [{"type": "paragraph", "text": "a"}]}});
    let persisted = json!({"root": {
        "type": "root",
        "$": {"id": "Ysu3mkwl"},
        "children": [{"type": "paragraph", "text": "b"}],
    }});
    assert!(!projection_json_matches(&live, &persisted));
}

#[test]
fn a_child_node_id_is_not_exempt() {
    let live =
        json!({"root": {"type": "root", "children": [{"type": "paragraph", "$": {"id": "one"}}]}});
    let persisted =
        json!({"root": {"type": "root", "children": [{"type": "paragraph", "$": {"id": "two"}}]}});
    assert!(!projection_json_matches(&live, &persisted));
}
