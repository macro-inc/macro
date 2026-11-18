//! DOM clipboard creation uses the actual Macro replacements, unlike stored JSON.
use lexical_model::*;
use lexical_rich_nodes::clipboard::{
    ClipboardEntry, MIME_HTML, insert_data_transfer_for_rich_text,
};
use macro_document_model::{EditorType, preset_builder_with_mode};

#[test]
fn html_list_drafts_apply_macro_replacements_recursively() -> Result<(), Error> {
    let mut editor = preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless)
        .build()
        .expect("Macro registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        let draft = serde_json::json!({
            "type":"list", "version":1, "listType":"check", "start":1,
            "format":"right", "indent":1, "direction":"rtl", "children":[{
                "type":"listitem", "version":1, "value":1, "checked":true,
                "children":[{
                    "type":"list", "version":1, "listType":"number", "start":7,
                    "children":[{
                        "type":"listitem", "version":1, "value":7,
                        "children":[{"type":"text", "version":1, "text":"nested"}]
                    }]
                }]
            }]
        });
        assert!(insert_data_transfer_for_rich_text(
            tx,
            "test",
            &[ClipboardEntry {
                mime: MIME_HTML,
                data: "<ul>nested</ul>"
            }],
            Some(&[draft.as_object().expect("draft").clone()]),
            SelectionSlot::Active,
        )?);
        let list = tx.first_child(NodeKey::ROOT).expect("pasted list");
        assert_eq!(tx.type_name(list)?, "task-list");
        let json = tx.view().export_node(list)?;
        assert_eq!(json["format"], "right");
        assert_eq!(json["indent"], 1);
        assert_eq!(json["direction"], "rtl");
        assert_eq!(json["children"][0]["checked"], true);
        assert_eq!(json["children"][0]["children"][0]["type"], "task-list");
        assert_eq!(json["children"][0]["children"][0]["start"], 7);
        assert_eq!(tx.text_content(list), "nested");
        Ok(())
    })?;
    let state = editor.state();
    let root = state.view().export_node(NodeKey::ROOT)?;
    assert_eq!(root["children"][0]["type"], "task-list");
    assert_eq!(
        root["children"][0]["children"][0]["children"][0]["type"],
        "task-list"
    );
    Ok(())
}

#[test]
fn stored_list_import_keeps_the_original_class() -> Result<(), Error> {
    let mut editor = preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless)
        .build()
        .expect("Macro registry");
    let mut tx = editor.transaction();
    let draft = serde_json::json!({"type":"list", "version":1, "listType":"number", "start":7, "children":[]});
    let list = tx.import_node(draft.as_object().expect("draft"))?;
    assert_eq!(tx.type_name(list)?, "list");
    Ok(())
}

#[test]
fn html_custom_code_keeps_child_sensitive_import_context() -> Result<(), Error> {
    let mut editor = preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless)
        .build()
        .expect("Macro registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        let draft = serde_json::json!({
            "type":"custom-code", "version":2, "text":"must not be inserted",
            "language":"rust", "children":[{"type":"text", "text":"actual child"}]
        });
        assert!(insert_data_transfer_for_rich_text(
            tx,
            "test",
            &[ClipboardEntry {
                mime: MIME_HTML,
                data: "<pre>actual child</pre>"
            }],
            Some(&[draft.as_object().expect("draft").clone()]),
            SelectionSlot::Active,
        )?);
        let code = tx.first_child(NodeKey::ROOT).expect("pasted code");
        assert_eq!(tx.type_name(code)?, "custom-code");
        assert_eq!(tx.children_size(code), 1);
        assert_eq!(tx.text_content(code), "actual child");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn html_horizontal_rule_draft_preserves_the_native_node_and_source_json() -> Result<(), Error> {
    let mut editor = preset_builder_with_mode(EditorType::Markdown, EditorMode::Headless)
        .build()
        .expect("Macro registry");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        let draft = serde_json::json!({"type":"horizontalrule", "version":1});
        assert!(insert_data_transfer_for_rich_text(
            tx,
            "test",
            &[ClipboardEntry {
                mime: MIME_HTML,
                data: "<hr>"
            }],
            Some(&[draft.as_object().expect("draft").clone()]),
            SelectionSlot::Active,
        )?);
        let rule = tx.first_child(NodeKey::ROOT).expect("pasted rule");
        assert_eq!(tx.type_name(rule)?, "horizontalrule");
        assert_eq!(tx.kind(rule), Some(NodeKind::Decorator));
        assert_eq!(
            serde_json::Value::Object(tx.view().export_json(rule)?),
            draft
        );
        Ok(())
    })?;
    Ok(())
}
