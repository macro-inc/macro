use crate::*;
use proptest::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cell::RefCell;

thread_local! { static IMPORTS: RefCell<Vec<(String, usize, Vec<String>)>> = const { RefCell::new(Vec::new()) }; }
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Observing {
    label: String,
}
impl NodeType for Observing {
    const TYPE: &'static str = "observing";
    type Kind = ElementKind;
    impl_default_node!();
    fn import(tx: &mut Transaction<'_>, fields: &SerializedNode) -> Result<NodeKey, Error> {
        let label = fields
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let count = fields
            .get("children")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        IMPORTS.with(|calls| {
            calls
                .borrow_mut()
                .push((label.to_owned(), count, fields.keys().cloned().collect()))
        });
        let node = tx.create(Self {
            label: label.into(),
        })?;
        tx.update_from_json(node, fields)?;
        Ok(node.key())
    }
}
impl ElementNode for Observing {
    element_node_base!();
}

#[test]
fn arbitrary_order_and_duplicate_keys_preserve_virtual_import_arguments() -> Result<(), Error> {
    let text = r#"{"root":{"children":[{"children":[{"label":"child","children":[],"type":"observing"}],"label":"overwritten","type":"observing","label":"parent"}],"type":"root"}}"#;
    let mut old = Editor::builder(EditorMode::Headless)
        .node::<Observing>()
        .build()
        .expect("editor");
    let mut new = Editor::builder(EditorMode::Headless)
        .node::<Observing>()
        .build()
        .expect("editor");
    IMPORTS.with(|calls| calls.borrow_mut().clear());
    let expected = old.parse_editor_state(&serde_json::from_str(text)?)?;
    let expected_calls = IMPORTS.with(|calls| calls.borrow().clone());
    IMPORTS.with(|calls| calls.borrow_mut().clear());
    let actual = new.parse_editor_state_str(text)?;
    assert_eq!(IMPORTS.with(|calls| calls.borrow().clone()), expected_calls);
    assert_eq!(expected_calls[0].0, "parent");
    assert_eq!(expected_calls[0].1, 1);
    assert_eq!(expected_calls[1].0, "child");
    assert_eq!(actual.to_json()?, expected.to_json()?);
    assert_eq!(new.keys.last_allocated(), old.keys.last_allocated());
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct ReplacementText {}
impl NodeType for ReplacementText {
    const TYPE: &'static str = "replacement-text";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for ReplacementText {
    text_node_base!();
}

#[test]
fn typed_text_import_preserves_replacement_allocations_and_original_fields() -> Result<(), Error> {
    let mut old = Editor::builder(EditorMode::Headless)
        .replace::<Text, ReplacementText>(|_| ReplacementText::default())
        .build()
        .expect("editor");
    let mut new = Editor::builder(EditorMode::Headless)
        .replace::<Text, ReplacementText>(|_| ReplacementText::default())
        .build()
        .expect("editor");
    let text = r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"hello","format":3,"mode":"normal","style":"color:red"}]}]}}"#;
    let expected = old.parse_editor_state(&serde_json::from_str(text)?)?;
    let actual = new.parse_editor_state_str(text)?;
    assert_eq!(actual.to_json()?, expected.to_json()?);
    assert_eq!(new.keys.last_allocated(), old.keys.last_allocated());
    Ok(())
}

#[test]
fn malformed_inputs_keep_error_classes_and_key_consumption() {
    for text in [
        "{",
        "{}",
        r#"{"root":null}"#,
        r#"{"root":{"type":"paragraph"}}"#,
        r#"{"root":{"type":"root","children":[3]}}"#,
        r#"{"root":{"type":"root","children":[{"type":"unknown"}]}}"#,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","direction":3}]}}"#,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","mode":null}]}]}}"#,
        r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","mode":"unknown"}]}]}}"#,
        r#"{"root":{"type":"root"},"root":{"type":"root"}}"#,
        r#"{"root":{"type":"root"}} trailing"#,
    ] {
        let mut old = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let mut new = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let expected = serde_json::from_str::<SerializedEditorState>(text)
            .map_err(Error::from)
            .and_then(|json| old.parse_editor_state(&json));
        let actual = new.parse_editor_state_str(text);
        assert_eq!(
            std::mem::discriminant(actual.as_ref().expect_err("error")),
            std::mem::discriminant(expected.as_ref().expect_err("error"))
        );
        assert_eq!(new.keys.last_allocated(), old.keys.last_allocated());
        assert!(new.state().is_empty_state());
    }
}

#[test]
fn builtin_field_shapes_match_value_import_errors_and_bytes() -> Result<(), Error> {
    let values = [
        json!(null),
        json!(false),
        json!(3),
        json!(-2),
        json!(0.5),
        json!(""),
        json!("bold"),
        json!("token"),
        json!([]),
        json!({"a":1}),
    ];
    for kind in ["text", "paragraph", "linebreak", "tab"] {
        for field in [
            "text",
            "format",
            "detail",
            "mode",
            "style",
            "indent",
            "direction",
            "textFormat",
            "textStyle",
            "$",
        ] {
            for value in &values {
                let mut node = json!({"type":kind});
                node.as_object_mut()
                    .expect("object")
                    .insert(field.into(), value.clone());
                let document = json!({"root":{"type":"root","children":[node]}});
                let mut old = Editor::builder(EditorMode::Headless)
                    .build()
                    .expect("editor");
                let mut new = Editor::builder(EditorMode::Headless)
                    .build()
                    .expect("editor");
                let expected = old.parse_editor_state(&serde_json::from_value(document.clone())?);
                let actual = new.parse_editor_state_str(&serde_json::to_string(&document)?);
                match (expected, actual) {
                    (Ok(expected), Ok(actual)) => assert_eq!(
                        actual.to_json_string()?,
                        to_js_json_string(&serde_json::to_value(expected.to_json()?)?),
                        "{kind}.{field} {value:?}"
                    ),
                    (Err(expected), Err(actual)) => assert_eq!(
                        std::mem::discriminant(&actual),
                        std::mem::discriminant(&expected),
                        "{kind}.{field} {value:?}"
                    ),
                    _ => panic!("different import outcomes for {kind}.{field} {value:?}"),
                }
                assert_eq!(new.keys.last_allocated(), old.keys.last_allocated());
            }
        }
    }
    Ok(())
}

proptest! {
    #[test]
    fn typed_fields_match_value_import_without_normalizing(
        texts in prop::collection::vec("[^\\p{C}]{0,64}", 0..16),
        format in any::<u32>(), detail in any::<u32>(),
        missing in any::<bool>(), style in "[^\\p{C}]{0,40}",
    ) {
        let children: Vec<_> = texts.iter().map(|text| {
            let mut value = json!({"type":"text","text":text,"format":format,"detail":detail,"style":style,"mode":"segmented","$":{"unknown":{"2":[null,true],"a":"nested"}}});
            if missing { value.as_object_mut().expect("object").shift_remove("format"); }
            value
        }).collect();
        let json = json!({"root":{"type":"root","children":[{"type":"paragraph","indent":2,"direction":"rtl","children":children}]}});
        let mut old = Editor::builder(EditorMode::Headless).build().expect("editor");
        let mut new = Editor::builder(EditorMode::Headless).build().expect("editor");
        let expected = old.parse_editor_state(&serde_json::from_value(json.clone()).expect("JSON")).expect("old state");
        let actual = new.parse_editor_state_str(&serde_json::to_string(&json).expect("JSON")).expect("new state");
        prop_assert_eq!(actual.to_json().expect("actual"), expected.to_json().expect("expected"));
        prop_assert_eq!(new.keys.last_allocated(), old.keys.last_allocated());
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct RootSink {}
impl NodeType for RootSink {
    const TYPE: &'static str = "root-sink";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for RootSink {
    element_node_base!();
    fn append(tx: &mut Transaction<'_>, this: Id<Self>, nodes: &[NodeKey]) -> Result<(), Error> {
        if nodes == [NodeKey::ROOT] {
            return Ok(());
        }
        tx.default_append(this.key(), nodes)
    }
}

#[test]
fn reimporting_root_fields_preserves_existing_links_before_virtual_append() -> Result<(), Error> {
    let text = r#"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"retained"}]},{"type":"root-sink","children":[{"type":"root","children":[]}]}]}}"#;
    let mut old = Editor::builder(EditorMode::Headless)
        .node::<RootSink>()
        .build()
        .expect("editor");
    let mut new = Editor::builder(EditorMode::Headless)
        .node::<RootSink>()
        .build()
        .expect("editor");
    let expected = old.parse_editor_state(&serde_json::from_str(text)?)?;
    let actual = new.parse_editor_state_str(text)?;
    assert_eq!(actual.to_json()?, expected.to_json()?);
    assert_eq!(actual.view().children(NodeKey::ROOT).count(), 2);
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn flat_and_late_bound_state_preserve_generic_import_and_export() -> Result<(), Error> {
    use std::sync::Arc;
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == &json!(0)
        }
    }
    let text = r#"{"root":{"type":"root","children":[{"type":"paragraph","counter":3,"children":[{"type":"text","text":"\t","$":{"late":2}}]}]}}"#;
    let build = || {
        Editor::builder(EditorMode::Headless)
            .foreign_state(ForeignStateConfig {
                key: "counter".into(),
                flat: true,
                codec: Arc::new(Codec),
            })
            .build()
            .expect("editor")
    };
    let mut old = build();
    let mut new = build();
    let expected = old.parse_editor_state(&serde_json::from_str(text)?)?;
    let actual = new.parse_editor_state_str(text)?;
    for editor in [&mut old, &mut new] {
        editor.register_foreign_state(ForeignStateConfig {
            key: "late".into(),
            flat: false,
            codec: Arc::new(Codec),
        })?;
    }
    assert_eq!(
        actual.to_json_string()?,
        to_js_json_string(&serde_json::to_value(expected.to_json()?)?)
    );
    let paragraph = actual.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(actual.foreign_state(paragraph, "counter"), Some(&json!(3)));
    let tab = actual.first_child_or_err(paragraph)?;
    assert_eq!(actual.foreign_state(tab, "late"), Some(&json!(2)));
    assert_eq!(
        actual.to_json_string()?,
        to_js_json_string(&serde_json::to_value(actual.to_json()?)?)
    );
    Ok(())
}
