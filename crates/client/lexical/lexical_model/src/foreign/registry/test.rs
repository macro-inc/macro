use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

#[test]
fn runtime_paragraph_keeps_native_ancestry_without_exposing_a_typed_payload() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "p2".into(),
            class_name: "P2".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("p2", SerializedNode::new())?;
        tx.append(NodeKey::ROOT, &[key])?;
        assert!(tx.is::<Paragraph>(key));
        assert!(tx.get::<Paragraph>(key).is_none());
        assert!(tx.cast::<Paragraph>(key).is_some());
        assert!(tx.can_be_empty(key));
        assert!(!tx.is_inline(key));
        Ok(key)
    })?;
    assert_eq!(editor.state().type_name(key)?, "p2");
    assert_eq!(editor.state().view().export_json(key)?["type"], "p2");
    Ok(())
}

#[test]
fn inherited_runtime_predicate_calls_parent_override_and_reads_own_fields() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn is_inline(&self, _node: NodeView<'_>, data: &ForeignData) -> Override<bool> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(
                data.fields
                    .get("inline")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            )
        }
    }
    struct Inherit;
    impl ForeignHooks for Inherit {}
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .foreign_node(ForeignNodeType {
            type_name: "child".into(),
            class_name: "Child".into(),
            kind: NodeKind::Element,
            extends: Some("custom"),
            required_state: vec![],
            hooks: Arc::new(Inherit),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("child", SerializedNode::new())?;
    tx.set_foreign_field(key, "inline", serde_json::Value::Bool(true))?;
    assert!(tx.is_inline(key));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(tx.is::<Paragraph>(key));
    Ok(())
}

#[test]
fn runtime_splice_dispatches_before_native_parent_fallback() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn splice(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            start: ChildIndex,
            delete_count: u32,
            nodes: &[NodeKey],
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(tx.default_splice(key, start, delete_count, nodes))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("custom", SerializedNode::new())?;
    let text = tx.create_text("x")?;
    tx.append(key, &[text.key()])?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(tx.text_content(key), "x");
    Ok(())
}

#[test]
fn runtime_parent_validation_rejects_wrong_kind() {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let result = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Text,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build();
    assert!(matches!(
        result,
        Err(BuildError::UnknownForeignParent {
            type_name: "custom",
            parent: "paragraph"
        })
    ));
}

#[test]
fn runtime_clone_hook_preserves_the_previous_snapshot_fields() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _key: NodeKey,
            _original: NodeKey,
            data: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            let mut data = data.clone();
            data.fields
                .insert("cloned".into(), serde_json::Value::Bool(true));
            Override::Value(Some(data))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("custom", SerializedNode::new())?;
        tx.set_foreign_field(key, "value", serde_json::Value::from(1))?;
        tx.append(NodeKey::ROOT, &[key])?;
        Ok(key)
    })?;
    let previous = editor.state().clone();
    editor.update(|tx| tx.set_foreign_field(key, "value", serde_json::Value::from(2)))?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        previous.foreign_data(key).expect("runtime").fields["value"],
        1
    );
    assert!(
        !previous
            .foreign_data(key)
            .expect("runtime")
            .fields
            .contains_key("cloned")
    );
    assert_eq!(
        editor.state().foreign_data(key).expect("runtime").fields["value"],
        2
    );
    assert_eq!(
        editor.state().foreign_data(key).expect("runtime").fields["cloned"],
        true
    );
    Ok(())
}

#[test]
fn runtime_static_transform_participates_in_the_model_fixpoint() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn static_transform(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            if tx
                .foreign_data(key)
                .is_some_and(|data| data.fields.contains_key("normalized"))
            {
                return Override::Value(Ok(()));
            }
            Override::Value(tx.set_foreign_field(key, "normalized", serde_json::Value::Bool(true)))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("custom", SerializedNode::new())?;
        tx.append(NodeKey::ROOT, &[key])?;
        Ok(key)
    })?;
    assert!(calls.load(Ordering::SeqCst) > 0);
    assert_eq!(
        editor.state().foreign_data(key).expect("runtime").fields["normalized"],
        true
    );
    Ok(())
}

#[test]
fn runtime_text_coercion_runs_before_the_framework_text_write() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn coerce_text_content(
            &self,
            _node: NodeView<'_>,
            _data: &ForeignData,
            requested: &str,
        ) -> Override<Result<String, Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(Ok(requested.to_uppercase()))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom-text".into(),
            class_name: "CustomText".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("custom-text", SerializedNode::new())?;
    tx.text(key)?.set_text_content("ab")?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(tx.text_content(key), "AB");
    assert!(tx.is::<Text>(key));
    assert!(tx.get::<Text>(key).is_none());
    Ok(())
}

#[test]
fn runtime_json_import_update_and_export_dispatch_model_hooks() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn import(
            &self,
            tx: &mut Transaction<'_>,
            json: &SerializedNode,
        ) -> Override<Result<NodeKey, Error>> {
            self.0.fetch_or(1, Ordering::SeqCst);
            Override::Value((|| {
                let key = tx.create_foreign("custom", SerializedNode::new())?;
                tx.update_from_json(key, json)?;
                Ok(key)
            })())
        }
        fn update_from_json(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            json: &SerializedNode,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_or(2, Ordering::SeqCst);
            Override::Value(tx.update_from_json_with(key, json, JsonImport::FULL))
        }
        fn adjust_export_json(
            &self,
            _node: NodeView<'_>,
            _data: &ForeignData,
            json: &mut SerializedNode,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_or(4, Ordering::SeqCst);
            json.insert("exported".into(), serde_json::Value::Bool(true));
            Override::Value(Ok(()))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "custom".into(),
            class_name: "Custom".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("registry");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"custom","version":1,"children":[],"value":7,"indent":2}]}}"#)?;
    let key = state.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(state.foreign_data(key).expect("runtime").fields["value"], 7);
    assert_eq!(state.element_data(key)?.indent, 2);
    assert_eq!(state.view().export_json(key)?["exported"], true);
    assert_eq!(calls.load(Ordering::SeqCst), 7);
    Ok(())
}

#[test]
fn runtime_parent_validation_rejects_cycles() {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    let result = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "a".into(),
            class_name: "A".into(),
            kind: NodeKind::Element,
            extends: Some("b"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .foreign_node(ForeignNodeType {
            type_name: "b".into(),
            class_name: "B".into(),
            kind: NodeKind::Element,
            extends: Some("a"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build();
    assert!(matches!(
        result,
        Err(BuildError::UnknownForeignParent { .. })
    ));
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct NativeParent {
    level: u32,
}
impl NodeType for NativeParent {
    const TYPE: &'static str = "native-parent";
    type Kind = ElementKind;
    const HAS_LANGUAGE_FIELD: bool = true;
    const FLAGS_PER_INSTANCE: bool = true;
    impl_default_node!();
}
impl ElementNode for NativeParent {
    element_node_base!();
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error> {
        tx.get_mut::<Self>(this)?.level += 1;
        if indent == 1
            && let Some(next) = tx.next_sibling(this)
        {
            tx.set_indent(next, 2)?;
            assert_eq!(tx.get::<Self>(this).map(|data| data.level), Some(99));
            tx.get_mut::<Self>(this)?.level += 1;
        }
        tx.set_indent_base(this.key(), indent)?;
        Ok(())
    }
    fn is_inline(&self, node: ElementView<'_>) -> bool {
        assert_eq!(
            node.state.get::<Self>(node.key).map(|data| data.level),
            Some(self.level)
        );
        self.level == 7
    }
    fn insert_new_after(
        tx: &mut Transaction<'_>,
        this: Id<Self>,
        _selection: SelectionSlot,
        _restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        assert_eq!(tx.get::<Self>(this).map(|data| data.level), Some(7));
        tx.get_mut::<Self>(this)?.level = 8;
        assert!(!tx.is_inline(this));
        tx.append(this, &[])?;
        assert_eq!(tx.view().get::<Self>(this).map(|data| data.level), Some(9));
        tx.get_mut::<Self>(this)?.level = 10;
        Ok(None)
    }
}

#[test]
fn runtime_native_parent_projects_instance_properties_only_during_inheritance() -> Result<(), Error>
{
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn append(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            nodes: &[NodeKey],
        ) -> Override<Result<(), Error>> {
            assert!(tx.get::<NativeParent>(key).is_none());
            assert_eq!(tx.foreign_data(key).expect("runtime").fields["level"], 8);
            Override::Value((|| {
                tx.set_foreign_field(key, "level", 9.into())?;
                tx.default_append(key, nodes)
            })())
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeParent>()
        .foreign_node(ForeignNodeType {
            type_name: "derived".into(),
            class_name: "Derived".into(),
            kind: NodeKind::Element,
            extends: Some("native-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "derived",
        serde_json::from_str(r#"{"level":7,"extra":"kept"}"#)?,
    )?;
    assert!(tx.get::<NativeParent>(key).is_none());
    assert!(tx.is_inline(key));
    assert!(
        tx.editor
            .registry()
            .get("derived")
            .expect("registered")
            .has_language_field
    );
    assert_eq!(
        tx.insert_new_after(key, SelectionSlot::Active, false)?,
        None
    );
    assert!(tx.get::<NativeParent>(key).is_none());
    assert_eq!(tx.foreign_data(key).expect("runtime").fields["level"], 10);
    assert_eq!(
        tx.foreign_data(key).expect("runtime").fields["extra"],
        "kept"
    );
    assert!(!tx.is_inline(key));
    Ok(())
}

#[test]
fn runtime_clone_refreshes_native_predicates_and_rejects_invalid_parent_fields() -> Result<(), Error>
{
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _key: NodeKey,
            _original: NodeKey,
            data: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            let mut copy = data.clone();
            let value = if self.0.load(Ordering::SeqCst) == 0 {
                7.into()
            } else {
                "invalid".into()
            };
            copy.fields.insert("level".into(), value);
            Override::Value(Some(copy))
        }
    }
    let invalid = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeParent>()
        .foreign_node(ForeignNodeType {
            type_name: "derived".into(),
            class_name: "Derived".into(),
            kind: NodeKind::Element,
            extends: Some("native-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks(invalid.clone())),
        })
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("derived", serde_json::from_str(r#"{"level":1}"#)?)?;
        // Inline parents are legal below a paragraph.
        let paragraph = tx.create(Paragraph {})?;
        tx.append(paragraph, &[key])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(key)
    })?;
    assert!(!editor.state().is_inline(key));
    editor.update(|tx| {
        tx.mark_dirty(key)?;
        assert!(tx.is_inline(key));
        Ok(())
    })?;
    invalid.store(1, Ordering::SeqCst);
    let previous = editor.state().clone();
    assert!(editor.update(|tx| tx.mark_dirty(key)).is_err());
    assert_eq!(
        editor.state().view().export_json(key)?,
        previous.view().export_json(key)?
    );
    assert!(editor.state().is_inline(key));
    Ok(())
}

#[test]
fn runtime_native_first_mutable_access_runs_clone_before_parent_mutation() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _key: NodeKey,
            _original: NodeKey,
            data: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            let mut copy = data.clone();
            copy.fields.insert("level".into(), 7.into());
            Override::Value(Some(copy))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeParent>()
        .foreign_node(ForeignNodeType {
            type_name: "derived".into(),
            class_name: "Derived".into(),
            kind: NodeKind::Element,
            extends: Some("native-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("derived", serde_json::from_str(r#"{"level":1}"#)?)?;
        let paragraph = tx.create(Paragraph {})?;
        tx.append(paragraph, &[key])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(key)
    })?;
    editor.update(|tx| tx.set_indent(key, 0))?;
    assert_eq!(
        editor.state().foreign_data(key).expect("runtime").fields["level"],
        8
    );
    Ok(())
}

#[test]
fn runtime_nested_native_scopes_refresh_a_reentered_parent() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn set_indent(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
            indent: u32,
        ) -> Override<Result<(), Error>> {
            assert!(tx.get::<NativeParent>(key).is_none());
            if indent == 2
                && let Some(previous) = tx.prev_sibling(key)
                && let Err(error) = tx.set_foreign_field(previous, "level", 99.into())
            {
                return Override::Value(Err(error));
            }
            Override::Inherit
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeParent>()
        .foreign_node(ForeignNodeType {
            type_name: "derived".into(),
            class_name: "Derived".into(),
            kind: NodeKind::Element,
            extends: Some("native-parent"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let a = tx.create_foreign(
        "derived",
        serde_json::from_str(r#"{"level":7,"extra":"a"}"#)?,
    )?;
    let b = tx.create_foreign(
        "derived",
        serde_json::from_str(r#"{"level":4,"extra":"b"}"#)?,
    )?;
    let paragraph = tx.create(Paragraph {})?;
    tx.append(paragraph, &[a, b])?;
    tx.set_indent(a, 1)?;
    assert_eq!(tx.foreign_data(a).expect("runtime").fields["level"], 100);
    assert_eq!(tx.foreign_data(b).expect("runtime").fields["level"], 5);
    assert!(tx.get::<NativeParent>(a).is_none());
    assert_eq!(tx.foreign_data(a).expect("runtime").fields["extra"], "a");
    Ok(())
}
