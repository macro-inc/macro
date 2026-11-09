use crate::*;
use proptest::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cell::RefCell;

fn legacy(state: &EditorState) -> Result<String, Error> {
    Ok(to_js_json_string(&serde_json::to_value(state.to_json()?)?))
}

#[test]
fn string_escape_bytes_match_serde_for_every_control_and_unicode() {
    let text: String = (0_u8..=31)
        .map(char::from)
        .chain("\"\\/é😀\u{2028}\u{2029}".chars())
        .collect();
    assert_eq!(
        to_js_json_string(&Value::String(text.clone())),
        serde_json::to_string(&text).expect("string")
    );
}

#[test]
fn paragraph_adjustment_keeps_existing_style_before_inserted_format() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","children":[{"type":"paragraph","textStyle":"color: red","children":[]}]}}"#)?;
    assert_eq!(state.to_json_string()?, legacy(&state)?);
    assert!(
        state
            .to_json_string()?
            .contains(r#""textStyle":"color: red","textFormat":0"#)
    );
    Ok(())
}

#[test]
fn constructed_tab_exports_its_exact_builtin_text_fields() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let tab = tx.create(Tab::default())?;
        tx.append(paragraph, &[tab.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })?;
    let bytes = editor.state().to_json_string()?;
    assert_eq!(bytes, legacy(editor.state())?);
    assert!(bytes.contains(
        r#""detail":2,"format":0,"mode":"normal","style":"","text":"\t","type":"tab","version":1"#
    ));
    Ok(())
}

thread_local! { static CALLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) }; }
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Reordered {
    label: String,
}
impl NodeType for Reordered {
    const TYPE: &'static str = "reordered";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for Reordered {
    element_node_base!();
    fn adjust_export_json(
        &self,
        _: NodeView<'_>,
        fields: &mut SerializedNode,
    ) -> Result<(), Error> {
        CALLS.with(|calls| calls.borrow_mut().push(self.label.clone()));
        fields.shift_remove("children");
        fields.insert("2".into(), json!(9_007_199_254_740_993_u64));
        fields.insert("escaped\nkey".into(), json!("\u{0}😀"));
        if self.label == "parent" {
            fields.insert("children".into(), Value::Null);
        }
        Ok(())
    }
}

#[test]
fn virtual_exports_run_once_parent_first_and_children_keep_hook_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Reordered>()
        .build()
        .expect("editor");
    editor.update(|tx| {
        let parent = tx.create(Reordered {
            label: "parent".into(),
        })?;
        let child = tx.create(Reordered {
            label: "child".into(),
        })?;
        tx.append(parent, &[child.key()])?;
        tx.append(NodeKey::ROOT, &[parent.key()])?;
        Ok(())
    })?;
    CALLS.with(|calls| calls.borrow_mut().clear());
    let expected = legacy(editor.state())?;
    assert_eq!(
        CALLS.with(|calls| calls.borrow().clone()),
        ["parent", "child"]
    );
    CALLS.with(|calls| calls.borrow_mut().clear());
    assert_eq!(editor.state().to_json_string()?, expected);
    assert_eq!(
        CALLS.with(|calls| calls.borrow().clone()),
        ["parent", "child"]
    );
    Ok(())
}

proptest! {
    #[test]
    fn streaming_matches_canonical_graph_export(
        texts in prop::collection::vec("[^\\p{C}]{0,80}", 0..12),
        format in any::<u32>(),
        style in "[^\\p{C}]{0,40}",
        missing in any::<bool>(),
        number in any::<f64>(),
    ) {
        let mut editor = Editor::builder(EditorMode::Headless).build().expect("editor");
        let children: Vec<_> = texts.iter().map(|text| {
            let mut node = json!({"type":"text","text":text,"format":format,"detail":0,"mode":"normal","style":style,"$":{"number":js_number(number),"02":"literal","2":true}});
            if missing { node.as_object_mut().expect("object").shift_remove("style"); }
            node
        }).collect();
        let document = json!({"root":{"type":"root","children":[{"type":"paragraph","children":children}]}});
        let state = editor.parse_editor_state_str(&serde_json::to_string(&document).expect("JSON")).expect("state");
        prop_assert_eq!(state.to_json_string().expect("stream"), legacy(&state).expect("canonical"));
    }
}
