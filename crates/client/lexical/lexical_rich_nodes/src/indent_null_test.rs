use crate::{
    heading::HeadingNode,
    list::{ListItemNode, ListNode},
    quote::QuoteNode,
};
use lexical_model::*;
use serde_json::{Value, json};

#[test]
fn canonical_heading_and_quote_keep_null_indent_through_export_and_unrelated_edit()
-> Result<(), Box<dyn std::error::Error>> {
    for node_type in ["heading", "quote"] {
        let mut node = json!({"type":node_type, "version":1, "indent":null,
            "direction":null, "format":"", "children":[{"type":"text",
                "version":1, "text":"fixture", "format":0, "detail":0,
                "mode":"normal", "style":""}]});
        if node_type == "heading" {
            node.as_object_mut()
                .expect("literal heading")
                .insert("tag".into(), json!("h2"));
        }
        let mut editor = Editor::builder(EditorMode::Headless)
            .node::<HeadingNode>()
            .node::<QuoteNode>()
            .initial_state(serde_json::from_value(json!({"root":{
                "type":"root", "version":1, "indent":0, "direction":null,
                "format":"", "children":[node]
            }}))?)
            .build()?;
        let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
        let text = editor.state().first_child_or_err(key)?;
        assert_eq!(editor.state().view().indent(key), 0);
        assert_eq!(
            editor.state().view().export_stored_json(key)?.get("indent"),
            Some(&Value::Null)
        );
        editor.update(|tx| {
            tx.text(text)?.set_text_content("changed")?;
            Ok(())
        })?;
        assert_eq!(
            editor.state().view().export_json(key)?.get("indent"),
            Some(&Value::Null)
        );
        let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
        assert_eq!(
            streaming["root"]["children"][0].get("indent"),
            Some(&Value::Null)
        );
        let parsed = editor.parse_editor_state_str(&editor.state().to_json_string()?)?;
        let parsed_key = parsed.first_child_or_err(NodeKey::ROOT)?;
        assert_eq!(
            parsed.view().export_stored_json(parsed_key)?.get("indent"),
            Some(&Value::Null)
        );
        editor.update(|tx| tx.set_indent(key, 0))?;
        assert_eq!(editor.state().view().export_stored_json(key)?["indent"], 0);
    }
    Ok(())
}

#[test]
fn native_listitem_computed_depth_remains_authoritative_for_null_input()
-> Result<(), Box<dyn std::error::Error>> {
    let editor = Editor::builder(EditorMode::Headless)
        .node::<ListNode>()
        .node::<ListItemNode>()
        .initial_state(serde_json::from_str(
            r#"{"root":{
            "type":"root", "version":1, "indent":0, "direction":null, "format":"",
            "children":[{"type":"list", "version":1, "listType":"bullet", "start":1,
                "tag":"ul", "indent":0, "direction":null, "format":"", "children":[
                    {"type":"listitem", "version":1, "value":1, "indent":0,
                        "direction":null, "format":"", "children":[
                            {"type":"list", "version":1, "listType":"bullet", "start":1,
                                "tag":"ul", "indent":0, "direction":null, "format":"",
                                "children":[{"type":"listitem", "version":1, "value":1,
                                    "indent":null, "direction":null, "format":"", "children":[
                                        {"type":"text", "version":1, "text":"nested", "format":0,
                                            "detail":0, "mode":"normal", "style":""}]}]}]}]}]
        }}"#,
        )?)
        .build()?;
    let list = editor.state().first_child_or_err(NodeKey::ROOT)?;
    let outer_item = editor.state().first_child_or_err(list)?;
    let nested_list = editor.state().first_child_or_err(outer_item)?;
    let nested_item = editor.state().first_child_or_err(nested_list)?;
    assert_eq!(editor.state().view().indent(nested_item), 1);
    assert_eq!(editor.state().view().export_json(nested_item)?["indent"], 1);
    assert_eq!(
        editor.state().view().export_stored_json(nested_item)?["indent"],
        1
    );
    let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert_eq!(
        streaming["root"]["children"][0]["children"][0]["children"][0]["children"][0]["indent"],
        1
    );
    Ok(())
}
