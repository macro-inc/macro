use super::*;
#[test]
fn isolated_handles_export_literal_upstream_paragraph() {
    let core = CoreHandle::create("upstream", None).unwrap();
    let value = snapshot::capture(core.editor.state(), None).unwrap();
    assert_eq!(
        value["state"],
        json!({"root":{"children":[{"children":[],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    assert_eq!(
        value["selection"]["anchor"],
        json!({"path":[0],"offset":0,"type":"element"})
    );
    assert!(CoreHandle::create("macro", None).is_err());
}
#[test]
fn transactions_insert_text_and_report_exact_commits() {
    let mut core = CoreHandle::create("upstream", None).unwrap();
    let value: Value = serde_json::from_str(
        &core
            .apply_json(r#"{"kind":"InsertText","text":"hello"}"#)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(value["text"], "hello");
    assert_eq!(value["selection"]["anchor"]["offset"], 5);
    assert_eq!(value["commit"]["dirtyLeaves"], json!(["2"]));
    assert_eq!(value["error"], Value::Null);
}
#[test]
fn malformed_input_never_mutates_editor() {
    let mut core = CoreHandle::create("upstream", None).unwrap();
    let before = snapshot::capture(core.editor.state(), None).unwrap();
    assert!(
        core.apply_json(r#"{"kind":"InsertText","text":"hello","extra":true}"#)
            .is_err()
    );
    assert_eq!(
        snapshot::capture(core.editor.state(), None).unwrap(),
        before
    );
}

#[test]
fn version_matches_the_shared_upstream_pin() {
    let pin: Value = serde_json::from_str(include_str!(
        "../../../../../packages/lexical-conformance/upstream.lock"
    ))
    .unwrap();
    assert_eq!(upstream_version(), pin["version"].as_str().unwrap());
}

#[test]
fn seeded_state_and_handles_are_independent() {
    let mut first = CoreHandle::create("upstream", None).unwrap();
    first
        .apply_json(r#"{"kind":"InsertText","text":"seed"}"#)
        .unwrap();
    let seed = first.editor.state().to_json().unwrap();
    let seeded =
        CoreHandle::create("upstream", Some(&serde_json::to_string(&seed).unwrap())).unwrap();
    assert_eq!(seeded.editor.state().text_content(NodeKey::ROOT), "seed");
    assert!(seeded.editor.state().selection().is_none());
    let empty = CoreHandle::create("upstream", None).unwrap();
    assert_eq!(empty.editor.state().text_content(NodeKey::ROOT), "");
}

#[test]
fn unchanged_dom_text_does_not_deliver_a_selection_change() {
    let mut core = CoreHandle::create("upstream", None).unwrap();
    core.apply_json(r#"{"kind":"InsertText","text":"same"}"#)
        .unwrap();
    let before = snapshot::capture(core.editor.state(), None).unwrap();
    let actual: Value = serde_json::from_str(&core.apply_json(r#"{"kind":"TextFromView","path":[0,0],"text":"same","anchor":0,"focus":0,"compositionEnd":false}"#).unwrap()).unwrap();
    assert_eq!(actual["selection"], before["selection"]);
    assert!(actual["commit"].is_null());
}

#[test]
fn dom_text_input_keeps_a_raw_zero_offset_after_a_formatted_sibling() {
    let mut core = CoreHandle::create("upstream", None).unwrap();
    core.apply_json(r#"{"kind":"InsertText","text":"a"}"#)
        .unwrap();
    core.apply_json(r#"{"kind":"FormatText","format":"bold"}"#)
        .unwrap();
    core.apply_json(r#"{"kind":"InsertText","text":"b"}"#)
        .unwrap();
    let actual: Value = serde_json::from_str(&core.apply_json(r#"{"kind":"TextFromView","path":[0,1],"text":"b","anchor":0,"focus":0,"compositionEnd":true}"#).unwrap()).unwrap();
    assert_eq!(
        actual["selection"]["anchor"],
        json!({"path":[0,1],"offset":0,"type":"text"})
    );
}

#[cfg(feature = "js-nodes")]
#[test]
fn empty_peer_transfer_preserves_root_state_and_metadata() {
    let mut core = CoreHandle::create("upstream", None).unwrap();
    let state = core.editor.parse_editor_state_str(r#"{"root":{"children":[],"direction":"rtl","format":"right","indent":2,"type":"root","version":1,"$":{"marker":"kept"}}}"#).unwrap();
    CoreHandle::transfer_state(&mut core.view_editor, state.clone()).unwrap();
    assert_eq!(
        core.view_editor.state().to_json().unwrap(),
        state.to_json().unwrap()
    );
}
