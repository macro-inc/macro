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
    assert!(projection_json_matches(&live, &persisted).unwrap());
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
    assert!(projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn any_other_root_state_key_still_has_to_match() {
    let live =
        json!({"root": {"type": "root", "$": {"id": "a", "searchText": "x"}, "children": []}});
    let persisted =
        json!({"root": {"type": "root", "$": {"id": "a", "searchText": "y"}, "children": []}});
    assert!(!projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn a_child_difference_still_fails() {
    let live = json!({"root": {"type": "root", "children": [{"type": "paragraph", "text": "a"}]}});
    let persisted = json!({"root": {
        "type": "root",
        "$": {"id": "Ysu3mkwl"},
        "children": [{"type": "paragraph", "text": "b"}],
    }});
    assert!(!projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn a_child_node_id_is_not_exempt() {
    let live =
        json!({"root": {"type": "root", "children": [{"type": "paragraph", "$": {"id": "one"}}]}});
    let persisted =
        json!({"root": {"type": "root", "children": [{"type": "paragraph", "$": {"id": "two"}}]}});
    assert!(!projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn a_creator_without_a_storage_null_key_matches_its_stored_null() {
    let live = json!({"root": {"type": "root", "children": [{"type": "table", "children": []}]}});
    let persisted = json!({"root": {
        "type": "root",
        "children": [{"type": "table", "colWidths": null, "children": []}],
    }});
    assert!(projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn a_present_storage_null_value_still_has_to_match() {
    let live = json!({"root": {"type": "root", "children": [{"type": "table", "colWidths": [100], "children": []}]}});
    let persisted = json!({"root": {
        "type": "root",
        "children": [{"type": "table", "colWidths": null, "children": []}],
    }});
    assert!(!projection_json_matches(&live, &persisted).unwrap());
}

#[test]
fn a_checked_difference_inside_a_check_list_still_fails() {
    let list = |checked: bool| {
        json!({"root": {"type": "root", "children": [{
            "type": "list",
            "listType": "check",
            "children": [{"type": "listitem", "checked": checked, "children": []}],
        }]}})
    };
    assert!(!projection_json_matches(&list(true), &list(false)).unwrap());
}

#[test]
fn a_classed_block_class_difference_still_fails() {
    let block = |class: &str| {
        json!({"root": {"type": "root", "children": [{
            "type": "classed-block",
            "tag": "div",
            "classes": [class],
            "children": [],
        }]}})
    };
    assert!(!projection_json_matches(&block("a"), &block("b")).unwrap());
}

// Source's ClassedBlockNode.importJSON never restores attributes, so no reload can
// tell these apart.
#[test]
fn classed_block_attributes_are_not_compared() {
    let block = |value: &str| {
        json!({"root": {"type": "root", "children": [{
            "type": "classed-block",
            "tag": "div",
            "classes": [],
            "attributes": {"data-x": value},
            "children": [],
        }]}})
    };
    assert!(projection_json_matches(&block("a"), &block("b")).unwrap());
}

#[test]
fn a_truthy_tablecell_width_difference_still_fails() {
    let cell = |width: u32| {
        json!({"root": {"type": "root", "children": [{
            "type": "table",
            "children": [{"type": "tablerow", "children": [
                {"type": "tablecell", "width": width, "children": []},
            ]}],
        }]}})
    };
    assert!(!projection_json_matches(&cell(100), &cell(200)).unwrap());
}
