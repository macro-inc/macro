use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

#[test]
fn imported_foreign_defaults_stay_raw_until_first_read() -> Result<(), Error> {
    struct Codec(Arc<AtomicU32>);
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            self.0.fetch_add(1, Ordering::SeqCst);
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            self.0.fetch_add(1, Ordering::SeqCst);
            value == 0
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: false,
            codec: Arc::new(Codec(calls.clone())),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[],"$":{"counter":0,"untouched":{"v":1}}}]}}"#)?;
    let key = state.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let before = state.view().export_json(key)?;
    assert_eq!(before["$"]["counter"], 0);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(state.foreign_state(key, "counter"), Some(&Value::from(0)));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let after = state.view().export_json(key)?;
    assert!(after["$"].get("counter").is_none());
    assert_eq!(after["$"]["untouched"], serde_json::json!({"v":1}));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    Ok(())
}

#[test]
fn foreign_state_custom_equality_preserves_writability_and_previous_snapshots() -> Result<(), Error>
{
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a.as_i64().map(|v| v % 10) == b.as_i64().map(|v| v % 10)
        }
        fn is_default(&self, value: &Value) -> bool {
            value.as_i64().is_some_and(|v| v % 10 == 0)
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: false,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let key = tx.create(Paragraph {})?.key();
        tx.append(NodeKey::ROOT, &[key])?;
        Ok(key)
    })?;
    let (_, commit) = editor.update(|tx| {
        assert!(!tx.is_writable(key));
        tx.set_foreign_state(key, "counter", 0.into())?;
        assert!(!tx.is_writable(key));
        Ok(())
    })?;
    assert!(commit.is_noop());
    assert!(
        editor
            .state()
            .node(key)
            .and_then(NodeRef::node_state)
            .is_none()
    );
    editor.update(|tx| tx.set_foreign_state(key, "counter", 1.into()))?;
    let previous = editor.state().clone();
    let (_, commit) = editor.update(|tx| tx.set_foreign_state(key, "counter", 11.into()))?;
    assert!(commit.is_noop());
    assert_eq!(
        editor.state().foreign_state(key, "counter"),
        Some(&Value::from(1))
    );
    editor.update(|tx| tx.set_foreign_state(key, "counter", 2.into()))?;
    assert_eq!(
        previous.foreign_state(key, "counter"),
        Some(&Value::from(1))
    );
    assert_eq!(
        editor.state().foreign_state(key, "counter"),
        Some(&Value::from(2))
    );
    editor.update(|tx| tx.set_foreign_state(key, "counter", 10.into()))?;
    assert!(editor.state().view().export_json(key)?.get("$").is_none());
    Ok(())
}

#[test]
fn foreign_state_registration_after_build_and_inside_an_update_preserves_config_identity()
-> Result<(), Error> {
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value.is_null()
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let codec: Arc<dyn ForeignStateCodec> = Arc::new(Codec);
    editor.register_foreign_state(ForeignStateConfig {
        key: "value".into(),
        flat: false,
        codec: codec.clone(),
    })?;
    editor.register_foreign_state(ForeignStateConfig {
        key: "value".into(),
        flat: false,
        codec: codec.clone(),
    })?;
    assert!(matches!(
        editor.register_foreign_state(ForeignStateConfig {
            key: "value".into(),
            flat: false,
            codec: Arc::new(Codec)
        }),
        Err(Error::StateKeyCollision { key: "value" })
    ));
    editor.update(|tx| {
        tx.register_foreign_state(ForeignStateConfig {
            key: "other".into(),
            flat: false,
            codec: Arc::new(Codec),
        })?;
        let key = tx.create(Paragraph {})?.key();
        tx.append(NodeKey::ROOT, &[key])?;
        tx.set_foreign_state(key, "value", "kept".into())?;
        tx.set_foreign_state(key, "other", true.into())?;
        assert_eq!(tx.foreign_state(key, "value"), Some(&Value::from("kept")));
        let error = tx
            .set_foreign_state(key, "missing", 1.into())
            .expect_err("unregistered");
        assert!(matches!(error, Error::UnknownForeignState { .. }));
        assert_eq!(error.to_string(), "unknown foreign state missing");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn foreign_state_equality_participates_in_text_merging_only_after_config_read() -> Result<(), Error>
{
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a["v"] == b["v"]
        }
        fn is_default(&self, _value: &Value) -> bool {
            false
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "object".into(),
            flat: false,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"a","format":0,"detail":0,"mode":"normal","style":"","$":{"object":{"v":1}}},{"type":"text","version":1,"text":"b","format":0,"detail":0,"mode":"normal","style":"","$":{"object":{"v":1}}}]}]}}"#)?;
    editor.set_editor_state(state, TagSet::default())?;
    let paragraph = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(editor.state().children_keys(paragraph)?.len(), 2);
    editor.update(|tx| tx.mark_foreign_type_dirty("text"))?;
    let texts = editor.state().children_keys(paragraph)?;
    assert_eq!(texts.len(), 2);
    assert_eq!(
        editor.state().foreign_state(texts[0], "object"),
        Some(&serde_json::json!({"v":1}))
    );
    assert_eq!(
        editor.state().foreign_state(texts[1], "object"),
        Some(&serde_json::json!({"v":1}))
    );
    editor.update(|tx| tx.mark_foreign_type_dirty("text"))?;
    assert_eq!(editor.state().children_keys(paragraph)?.len(), 1);
    assert_eq!(editor.state().text_content(paragraph), "ab");
    Ok(())
}

#[test]
fn foreign_state_declarations_validate_and_flat_imports_remain_lazy() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let missing = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "p2".into(),
            class_name: "P2".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![RequiredState::foreign("counter", true)],
            hooks: Arc::new(Hooks),
        })
        .build();
    assert!(matches!(
        missing,
        Err(BuildError::UnknownForeignState { key: "counter" })
    ));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: false,
            codec: Arc::new(Codec),
        })
        .foreign_node(ForeignNodeType {
            type_name: "p2".into(),
            class_name: "P2".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![RequiredState::foreign("counter", true)],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"p2","version":1,"children":[],"counter":0}]}}"#)?;
    let key = state.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(state.view().export_json(key)?["counter"], 0);
    assert_eq!(state.foreign_state(key, "counter"), Some(&Value::from(0)));
    assert!(!state.view().export_json(key)?.contains_key("counter"));
    editor.set_editor_state(state, TagSet::default())?;
    editor.update(|tx| tx.set_foreign_state(key, "counter", 7.into()))?;
    assert_eq!(editor.state().view().export_json(key)?["counter"], 7);
    assert!(editor.state().view().export_json(key)?.get("$").is_none());
    Ok(())
}

#[test]
fn foreign_state_binding_is_copied_before_new_values_change_snapshots() -> Result<(), Error> {
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: false,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[],"$":{"counter":0}}]}}"#)?;
    editor.set_editor_state(state, TagSet::default())?;
    let key = editor.state().first_child_or_err(NodeKey::ROOT)?;
    let previous = editor.state().clone();
    editor.update(|tx| tx.set_foreign_state(key, "counter", 1.into()))?;
    // setState reads the previous value before acquiring writable state, like upstream.
    assert!(previous.view().export_json(key)?.get("$").is_none());
    assert_eq!(
        previous.foreign_state(key, "counter"),
        Some(&Value::from(0))
    );
    assert_eq!(editor.state().view().export_json(key)?["$"]["counter"], 1);
    Ok(())
}

#[test]
fn foreign_flat_config_round_trips_without_a_class_declaration() -> Result<(), Error> {
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: true,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[],"counter":3}]}}"#)?;
    let key = state.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(state.view().export_json(key)?["counter"], 3);
    assert!(state.view().export_json(key)?.get("$").is_none());
    assert_eq!(state.foreign_state(key, "counter"), Some(&Value::from(3)));
    editor.set_editor_state(state, TagSet::default())?;
    editor.update(|tx| tx.set_foreign_state(key, "counter", 0.into()))?;
    assert!(
        !editor
            .state()
            .view()
            .export_json(key)?
            .contains_key("counter")
    );
    Ok(())
}

#[test]
fn explicit_class_nested_state_overrides_the_config_flat_default() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: true,
            codec: Arc::new(Codec),
        })
        .foreign_node(ForeignNodeType {
            type_name: "p2".into(),
            class_name: "P2".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![RequiredState::foreign("counter", false)],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let state = editor.parse_editor_state_str(r#"{"root":{"type":"root","version":1,"children":[{"type":"p2","version":1,"children":[],"$":{"counter":3}}]}}"#)?;
    let key = state.first_child_or_err(NodeKey::ROOT)?;
    assert!(!state.view().export_json(key)?.contains_key("counter"));
    assert_eq!(state.view().export_json(key)?["$"]["counter"], 3);
    editor.set_editor_state(state, TagSet::default())?;
    editor.update(|tx| tx.set_foreign_state(key, "counter", 7.into()))?;
    assert_eq!(editor.state().view().export_json(key)?["$"]["counter"], 7);
    Ok(())
}

static COUNTER: StateKey<u32> = StateKey::new("counter", |value| {
    value
        .and_then(Value::as_u64)
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or_default()
});
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct NativeState {}
impl NodeType for NativeState {
    const TYPE: &'static str = "native-state";
    type Kind = ElementKind;
    const REQUIRED_STATE: &'static [RequiredState] = &[RequiredState::nested(&COUNTER)];
    impl_default_node!();
}
impl ElementNode for NativeState {
    element_node_base!();
}

#[test]
fn native_and_foreign_state_configs_cannot_claim_the_same_node_key() -> Result<(), Error> {
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeState>()
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: false,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    editor.update(|tx| {
        let native = tx.create(NativeState {})?.key();
        tx.set_state(native, &COUNTER, 1)?;
        assert!(matches!(
            tx.set_foreign_state(native, "counter", 2.into()),
            Err(Error::StateKeyCollision { key: "counter" })
        ));
        let foreign = tx.create(Paragraph {})?.key();
        tx.set_foreign_state(foreign, "counter", 3.into())?;
        assert!(matches!(
            tx.get_state(foreign, &COUNTER),
            Err(Error::StateKeyCollision { key: "counter" })
        ));
        assert!(matches!(
            tx.set_state(foreign, &COUNTER, 4),
            Err(Error::StateKeyCollision { key: "counter" })
        ));
        tx.append(NodeKey::ROOT, &[native, foreign])
    })?;
    Ok(())
}

#[test]
fn foreign_state_builder_reuses_one_config_and_rejects_a_different_identity() {
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value.is_null()
        }
    }
    let codec: Arc<dyn ForeignStateCodec> = Arc::new(Codec);
    assert!(
        Editor::builder(EditorMode::Headless)
            .foreign_state(ForeignStateConfig {
                key: "value".into(),
                flat: false,
                codec: codec.clone()
            })
            .foreign_state(ForeignStateConfig {
                key: "value".into(),
                flat: false,
                codec
            })
            .build()
            .is_ok()
    );
    assert!(matches!(
        Editor::builder(EditorMode::Headless)
            .foreign_state(ForeignStateConfig {
                key: "value".into(),
                flat: false,
                codec: Arc::new(Codec)
            })
            .foreign_state(ForeignStateConfig {
                key: "value".into(),
                flat: false,
                codec: Arc::new(Codec)
            })
            .build(),
        Err(BuildError::StateKeyCollision { key: "value" })
    ));
}

#[test]
fn empty_foreign_state_metadata_borrows_layout_and_builtin_text_still_uses_js_state()
-> Result<(), Error> {
    let registry = ForeignStateRegistry::default();
    let layout = StateLayout::default();
    assert!(matches!(
        registry.layout(&layout),
        std::borrow::Cow::Borrowed(_)
    ));
    let bindings = ForeignBindings::default();
    assert!(!bindings.contains("counter"));
    assert!(bindings.configs().is_empty());
    assert!(!bindings.clone().populated.load(Ordering::Acquire));
    struct Codec;
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            value == 0
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_state(ForeignStateConfig {
            key: "counter".into(),
            flat: true,
            codec: Arc::new(Codec),
        })
        .build()
        .expect("editor");
    assert!(!editor.state.registry.has_foreign_payloads);
    let (key, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("native text")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_foreign_state(text.key(), "counter", 1.into())?;
        Ok(text.key())
    })?;
    let previous = editor.state().clone();
    assert_eq!(previous.view().export_json(key)?["counter"], 1);
    editor.update(|tx| tx.set_foreign_state(key, "counter", 0.into()))?;
    assert!(
        editor
            .state()
            .view()
            .export_json(key)?
            .get("counter")
            .is_none()
    );
    assert_eq!(previous.view().export_json(key)?["counter"], 1);
    Ok(())
}
