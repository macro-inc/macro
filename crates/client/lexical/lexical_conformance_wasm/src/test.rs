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
