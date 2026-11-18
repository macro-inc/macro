use crate::*;
use serde_json::{Value, json};

fn imported(indent: Option<Value>) -> Result<Editor, Box<dyn std::error::Error>> {
    let mut paragraph = json!({
        "type":"paragraph", "version":1, "format":"", "direction":null,
        "children":[{"type":"text", "version":1, "text":"fixture",
            "format":0, "detail":0, "mode":"normal", "style":""}]
    });
    if let Some(indent) = indent {
        paragraph
            .as_object_mut()
            .expect("literal paragraph")
            .insert("indent".into(), indent);
    }
    Ok(Editor::builder(EditorMode::Headless)
        .initial_state(serde_json::from_value(json!({"root": {
            "type":"root", "version":1, "indent":0, "direction":null,
            "format":"", "children":[paragraph]
        }}))?)
        .build()?)
}

fn assert_indent(
    state: &EditorState,
    key: NodeKey,
    expected: Option<Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        state.view().export_json(key)?.get("indent"),
        expected.as_ref()
    );
    assert_eq!(
        state.view().export_stored_json(key)?.get("indent"),
        expected.as_ref()
    );
    let index = state
        .view()
        .children(NodeKey::ROOT)
        .position(|child| child == key)
        .expect("attached fixture paragraph");
    assert_eq!(
        state.to_json()?.root["children"][index].get("indent"),
        expected.as_ref()
    );
    let streaming: Value = serde_json::from_str(&state.to_json_string()?)?;
    assert_eq!(
        streaming["root"]["children"][index].get("indent"),
        expected.as_ref()
    );
    Ok(())
}

#[test]
fn paragraph_missing_null_and_zero_survive_all_exports_and_reload()
-> Result<(), Box<dyn std::error::Error>> {
    for expected in [None, Some(Value::Null), Some(json!(0))] {
        let mut editor = imported(expected.clone())?;
        let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
        assert_eq!(editor.state().view().indent(key), 0);
        assert_indent(editor.state(), key, expected.clone())?;
        let encoded = editor.state().to_json_string()?;
        let parsed = editor.parse_editor_state_str(&encoded)?;
        let parsed_key = parsed.first_child_or_err(NodeKey::ROOT)?;
        assert_indent(&parsed, parsed_key, expected)?;
    }
    Ok(())
}

#[test]
fn unrelated_edit_record_copy_and_discard_keep_null_until_explicit_equal_zero()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = imported(Some(Value::Null))?;
    let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
    let text = editor.state().first_child_or_err(key)?;
    let saved = editor.state().clone();
    editor.update(|tx| {
        tx.text(text)?.set_text_content("changed")?;
        Ok(())
    })?;
    assert_indent(&saved, key, Some(Value::Null))?;
    assert_indent(editor.state(), key, Some(Value::Null))?;
    let (copy, _) = editor.update(|tx| {
        let copy = tx.copy_node(key, false)?;
        tx.append(NodeKey::ROOT, &[copy])?;
        Ok(copy)
    })?;
    assert_indent(editor.state(), copy, Some(Value::Null))?;
    {
        let mut tx = editor.transaction();
        tx.set_indent(key, 0)?;
        assert_eq!(
            tx.view().export_stored_json(key)?.get("indent"),
            Some(&json!(0))
        );
    }
    assert_indent(editor.state(), key, Some(Value::Null))?;
    editor.update(|tx| tx.set_indent(key, 0))?;
    assert_indent(editor.state(), key, Some(json!(0)))?;
    assert_indent(editor.state(), copy, Some(Value::Null))?;
    assert_indent(&saved, key, Some(Value::Null))?;
    Ok(())
}

#[test]
fn same_key_import_updates_presence_instead_of_retaining_old_null()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = imported(Some(json!(0)))?;
    let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
    for expected in [Some(Value::Null), None, Some(json!(0))] {
        let mut own = editor.state().view().export_stored_json(key)?;
        own.remove("children");
        match &expected {
            Some(value) => {
                own.insert("indent".into(), value.clone());
            }
            None => {
                own.remove("indent");
            }
        }
        editor.update(|tx| tx.update_from_json(key, &own))?;
        assert_indent(editor.state(), key, expected)?;
    }
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
mod foreign {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct CountedIndent(Arc<AtomicUsize>);
    impl ForeignHooks for CountedIndent {
        fn indent(&self, _: NodeView<'_>, _: &ForeignData) -> Override<u32> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Override::Value(7)
        }
    }

    #[test]
    fn actual_native_overlay_getter_is_authoritative_once_per_export()
    -> Result<(), Box<dyn std::error::Error>> {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut editor = Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("paragraph", Arc::new(CountedIndent(calls.clone())))
            .build()?;
        let (key, _) = editor.update(|tx| {
            let key = tx.import_node(
                json!({"type":"paragraph", "version":1,
                "indent":null, "direction":null, "format":"", "children":[]})
                .as_object()
                .expect("literal paragraph"),
            )?;
            tx.append(NodeKey::ROOT, &[key])?;
            Ok(key)
        })?;
        calls.store(0, Ordering::Relaxed);
        assert_eq!(editor.state().view().export_json(key)?["indent"], 7);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        calls.store(0, Ordering::Relaxed);
        assert_eq!(editor.state().view().export_stored_json(key)?["indent"], 7);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        calls.store(0, Ordering::Relaxed);
        let tree: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
        assert_eq!(tree["root"]["children"][0]["indent"], 7);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        Ok(())
    }

    #[test]
    fn root_overlay_uses_the_same_authoritative_getter_in_full_json()
    -> Result<(), Box<dyn std::error::Error>> {
        let calls = Arc::new(AtomicUsize::new(0));
        let editor = Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("root", Arc::new(CountedIndent(calls.clone())))
            .build()?;
        calls.store(0, Ordering::Relaxed);
        assert_eq!(
            editor.state().view().export_json(NodeKey::ROOT)?["indent"],
            7
        );
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        calls.store(0, Ordering::Relaxed);
        let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
        assert_eq!(streaming["root"]["indent"], 7);
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        Ok(())
    }

    struct CountedText(Arc<AtomicUsize>);
    impl ForeignHooks for CountedText {
        fn text_content(&self, _: NodeView<'_>, _: &ForeignData) -> Override<String> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Override::Value("virtual text".into())
        }
        fn can_insert_text_before(&self, _: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Override::Value(false)
        }
    }

    #[test]
    fn text_overlay_fallback_preserves_existing_export_without_extra_read_hooks()
    -> Result<(), Box<dyn std::error::Error>> {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut editor = Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("text", Arc::new(CountedText(calls.clone())))
            .build()?;
        let (text, _) = editor.update(|tx| {
            let paragraph = tx.create(Paragraph::default())?;
            let text = tx.create_text("stored text")?;
            tx.append(paragraph, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[paragraph.key()])?;
            Ok(text.key())
        })?;
        calls.store(0, Ordering::Relaxed);
        assert!(!editor.state().view().can_insert_text_before(text));
        assert_eq!(calls.load(Ordering::Relaxed), 1);
        calls.store(0, Ordering::Relaxed);
        let own = editor.state().view().export_json(text)?;
        assert_eq!(own["text"], "stored text");
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
        assert_eq!(
            streaming["root"]["children"][0]["children"][0],
            Value::Object(own)
        );
        assert_eq!(calls.load(Ordering::Relaxed), 0);
        Ok(())
    }

    thread_local! {
        static ORDER: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
    }
    #[derive(Clone, Debug)]
    struct AfterIndent(u32);
    impl StateValue for AfterIndent {
        fn to_json(&self) -> Value {
            ORDER.with(|order| order.borrow_mut().push("state"));
            self.0.into()
        }
        fn js_equal(&self, other: &Self) -> bool {
            self.0 == other.0
        }
    }
    static AFTER_INDENT: StateKey<AfterIndent> = StateKey::new("after-indent", |value| {
        AfterIndent(
            value
                .and_then(Value::as_u64)
                .and_then(|number| number.try_into().ok())
                .unwrap_or(0),
        )
    });
    struct OrderedIndent(Arc<std::sync::atomic::AtomicBool>);
    impl ForeignHooks for OrderedIndent {
        fn indent(&self, _: NodeView<'_>, _: &ForeignData) -> Override<u32> {
            ORDER.with(|order| order.borrow_mut().push("indent"));
            assert!(
                !self.0.load(Ordering::Relaxed),
                "actual indent hook failure"
            );
            Override::Value(7)
        }
    }

    #[test]
    fn overlay_getter_order_and_failure_preserve_the_original_record()
    -> Result<(), Box<dyn std::error::Error>> {
        let fail = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut editor = Editor::builder(EditorMode::Headless)
            .foreign_native_hooks("paragraph", Arc::new(OrderedIndent(fail.clone())))
            .build()?;
        let (key, _) = editor.update(|tx| {
            let key = tx.create(Paragraph::default())?.key();
            tx.append(NodeKey::ROOT, &[key])?;
            tx.set_state(key, &AFTER_INDENT, AfterIndent(3))?;
            Ok(key)
        })?;
        ORDER.with(|order| order.borrow_mut().clear());
        assert_eq!(editor.state().view().export_json(key)?["indent"], 7);
        ORDER.with(|order| assert_eq!(*order.borrow(), ["indent", "state"]));
        let saved = editor.state().clone();
        fail.store(true, Ordering::Relaxed);
        ORDER.with(|order| order.borrow_mut().clear());
        let error = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            editor.state().view().export_json(key)
        }));
        assert!(error.is_err());
        ORDER.with(|order| assert_eq!(*order.borrow(), ["indent"]));
        assert!(saved.same_snapshot(editor.state()));
        fail.store(false, Ordering::Relaxed);
        ORDER.with(|order| order.borrow_mut().clear());
        let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
        assert_eq!(streaming["root"]["children"][0]["indent"], 7);
        ORDER.with(|order| assert_eq!(*order.borrow(), ["indent", "state"]));
        Ok(())
    }

    #[test]
    fn unrelated_typed_base_patch_preserves_null_and_explicit_zero_retires_it()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut editor = imported(Some(Value::Null))?;
        let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
        editor.update(|tx| {
            tx.mark_dirty(key)?;
            tx.patch_foreign_base(key, ForeignBaseField::Format(0))
        })?;
        assert_indent(editor.state(), key, Some(Value::Null))?;
        editor.update(|tx| {
            tx.mark_dirty(key)?;
            tx.patch_foreign_base(key, ForeignBaseField::Indent(0))
        })?;
        assert_indent(editor.state(), key, Some(json!(0)))?;
        Ok(())
    }
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct ComputedQuoteLookalike {
    #[serde(flatten)]
    paragraph: Paragraph,
}
impl NodeType for ComputedQuoteLookalike {
    const TYPE: &'static str = "quote";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for ComputedQuoteLookalike {
    type Parent = Paragraph;
    fn as_parent(&self) -> &Self::Parent {
        &self.paragraph
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.paragraph)
    }
    fn indent(&self, _: ElementView<'_>) -> u32 {
        9
    }
}

#[test]
fn registered_computed_lookalike_does_not_inherit_paragraph_raw_null_authority()
-> Result<(), Box<dyn std::error::Error>> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ComputedQuoteLookalike>()
        .build()?;
    let (key, _) = editor.update(|tx| {
        let key = tx.import_node(
            json!({"type":"quote", "version":1,
            "indent":null, "direction":null, "format":"", "children":[]})
            .as_object()
            .expect("literal lookalike"),
        )?;
        tx.append(NodeKey::ROOT, &[key])?;
        Ok(key)
    })?;
    assert_eq!(editor.state().view().indent(key), 9);
    assert_eq!(editor.state().view().export_json(key)?["indent"], 9);
    assert_eq!(editor.state().view().export_stored_json(key)?["indent"], 9);
    let streaming: Value = serde_json::from_str(&editor.state().to_json_string()?)?;
    assert_eq!(streaming["root"]["children"][0]["indent"], 9);
    Ok(())
}
