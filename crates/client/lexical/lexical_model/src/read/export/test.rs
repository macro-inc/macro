use crate::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
static FLAT: StateKey<i64> =
    StateKey::new("flat", |value| value.and_then(Value::as_i64).unwrap_or(0));
static NESTED: StateKey<bool> = StateKey::new("nested", |value| value.is_some_and(js_truthy));
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Stateful {}
impl NodeType for Stateful {
    const TYPE: &'static str = "buffer-state";
    type Kind = DecoratorKind;
    const REQUIRED_STATE: &'static [RequiredState] =
        &[RequiredState::flat(&FLAT), RequiredState::nested(&NESTED)];
    impl_default_node!();
}
impl DecoratorNode for Stateful {
    decorator_node_base!();
}

#[test]
fn reuse_preserves_order_defaults_unknown_fields_and_imported_undefined() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Stateful>()
        .build()
        .expect("editor");
    let (keys, _) = editor.update(|tx| {
        let state = tx.import_node(json!({"type":"buffer-state","version":1,"flat":7,"$":{"z":{"list":[null,2]},"nested":true}}).as_object().expect("node"))?;
        let empty = tx.create(Stateful {})?;
        let text = tx.import_node(json!({"type":"text","text":"a","mode":"normal","$":{"second":2,"first":1}}).as_object().expect("text"))?;
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[state, empty.key(), p.key()])?;
        Ok([state, empty.key(), text])
    })?;
    let view = editor.state().view();
    let expected = [
        r#"{"type":"buffer-state","version":1,"flat":7,"$":{"z":{"list":[null,2]},"nested":true}}"#,
        r#"{"type":"buffer-state","version":1}"#,
        r#"{"mode":"normal","text":"a","type":"text","version":1,"$":{"second":2,"first":1}}"#,
    ];
    let mut buffer = JsonExportBuffer::default();
    for _ in 0..3 {
        for (key, expected) in keys.iter().zip(expected) {
            buffer
                .json_mut()
                .insert("stale".into(), json!({"unexpected":true}));
            buffer = view.export_json_reusing(*key, buffer)?;
            assert_eq!(
                to_js_json_string(&Value::Object(buffer.json().clone())),
                expected
            );
            assert_eq!(
                to_js_json_string(&Value::Object(view.export_json(*key)?)),
                expected
            );
        }
    }
    assert_eq!(view.get_state(keys[0], &FLAT)?, 7);
    assert!(view.get_state(keys[0], &NESTED)?);
    assert!(!view.export_json(keys[2])?.contains_key("format"));
    Ok(())
}

thread_local! {
    static CALLS: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
    static NESTED_EXPORT: std::cell::RefCell<Option<(EditorState, NodeKey)>> = const { std::cell::RefCell::new(None) };
}
fn record(call: &'static str) {
    CALLS.with(|calls| calls.borrow_mut().push(call));
}
static CODEC: StateKey<u32> = StateKey::new("late-codec", |value| {
    record("codec-default");
    value
        .and_then(Value::as_u64)
        .and_then(|value| value.try_into().ok())
        .unwrap_or(0)
});
#[derive(Clone, Debug)]
struct ReentrantValue(u32);
impl StateValue for ReentrantValue {
    fn to_json(&self) -> Value {
        record("known");
        // Exercise the actual known-state serializer and lazy native codec
        // initialization. Foreign host bindings have their own feature tests.
        assert_eq!(*CODEC.default_value(), 0);
        let (snapshot, key) = NESTED_EXPORT
            .with(|nested| nested.borrow().clone())
            .expect("nested immutable export");
        let nested = snapshot
            .view()
            .export_json_reusing(key, JsonExportBuffer::default())
            .expect("reentrant export");
        assert_eq!(nested.json()["text"], "nested");
        record("nested");
        self.0.into()
    }
    fn js_equal(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}
static CALLBACK: StateKey<ReentrantValue> = StateKey::new("callback", |value| {
    ReentrantValue(
        value
            .and_then(Value::as_u64)
            .and_then(|value| value.try_into().ok())
            .unwrap_or(0),
    )
});
fn payload<S: serde::Serializer>(value: &u32, serializer: S) -> Result<S::Ok, S::Error> {
    record("payload");
    value.serialize(serializer)
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Reentrant {
    #[serde(serialize_with = "payload")]
    marker: u32,
}
impl NodeType for Reentrant {
    const TYPE: &'static str = "buffer-reentrant";
    type Kind = DecoratorKind;
    const REQUIRED_STATE: &'static [RequiredState] = &[RequiredState::nested(&CALLBACK)];
    impl_default_node!();
}
impl DecoratorNode for Reentrant {
    decorator_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error> {
        record("adjust");
        assert_eq!(json["marker"], 7);
        assert_eq!(json["$"]["callback"], 1);
        json.insert("adjusted".into(), true.into());
        Ok(())
    }
}

#[test]
fn known_serializers_reenter_export_and_initialize_codec_before_payload_and_adjust()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Reentrant>()
        .build()
        .expect("editor");
    let ((key, target), _) = editor.update(|tx| {
        let key = tx.create(Reentrant { marker: 7 })?;
        tx.set_state(key, &CALLBACK, ReentrantValue(1))?;
        let paragraph = tx.create(Paragraph::default())?;
        let target = tx.create_text("nested")?;
        tx.append(paragraph, &[target.key()])?;
        tx.append(NodeKey::ROOT, &[key.key(), paragraph.key()])?;
        Ok((key.key(), target.key()))
    })?;
    let before = editor.state().clone();
    NESTED_EXPORT.with(|nested| *nested.borrow_mut() = Some((before.clone(), target)));
    CALLS.with(|calls| calls.borrow_mut().clear());
    let buffer = before
        .view()
        .export_json_reusing(key, JsonExportBuffer::default())?;
    assert_eq!(
        CALLS.with(|calls| calls.replace(Vec::new())),
        ["known", "codec-default", "nested", "payload", "adjust"]
    );
    assert_eq!(
        to_js_json_string(&Value::Object(buffer.json().clone())),
        r#"{"type":"buffer-reentrant","version":1,"$":{"callback":1},"marker":7,"adjusted":true}"#
    );
    let buffer = before.view().export_json_reusing(key, buffer)?;
    assert_eq!(
        CALLS.with(|calls| calls.replace(Vec::new())),
        ["known", "nested", "payload", "adjust"]
    );
    assert_eq!(buffer.json()["$"], json!({"callback":1}));
    NESTED_EXPORT.with(|nested| *nested.borrow_mut() = None);
    assert!(before.same_snapshot(editor.state()));
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Failing {}
impl NodeType for Failing {
    const TYPE: &'static str = "buffer-failing";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for Failing {
    decorator_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, json: &mut SerializedNode) -> Result<(), Error> {
        assert!(!json.contains_key("stale"));
        json.insert("partial".into(), true.into());
        Err(Error::Invariant("literal export failure"))
    }
}
#[test]
fn failed_export_returns_only_the_error_and_never_publishes_stale_or_partial_json()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Failing>()
        .build()
        .expect("editor");
    let ((key, paragraph), _) = editor.update(|tx| {
        let key = tx.create(Failing {})?;
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[key.key(), p.key()])?;
        Ok((key.key(), p.key()))
    })?;
    let before = editor.state().clone();
    let mut buffer = before
        .view()
        .export_json_reusing(paragraph, JsonExportBuffer::default())?;
    buffer
        .json_mut()
        .insert("stale".into(), json!({"previous":true}));
    assert!(matches!(
        before.view().export_json_reusing(key, buffer),
        Err(Error::Invariant("literal export failure"))
    ));
    let clean = before
        .view()
        .export_json_reusing(paragraph, JsonExportBuffer::default())?;
    assert!(!clean.json().contains_key("stale"));
    assert!(!clean.json().contains_key("partial"));
    assert!(before.same_snapshot(editor.state()));
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
mod foreign {
    use super::*;
    use std::{cell::RefCell, sync::Arc};
    thread_local! {
        static CONTEXT: RefCell<Option<(EditorState, NodeKey, NodeKey)>> = const { RefCell::new(None) };
        static EVENTS: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
    }
    fn event(name: &'static str) {
        EVENTS.with(|events| events.borrow_mut().push(name));
    }
    #[derive(Clone, Debug)]
    struct Hook(u32);
    impl StateValue for Hook {
        fn to_json(&self) -> Value {
            event("known");
            let (snapshot, outer, nested) = CONTEXT
                .with(|context| context.borrow().clone())
                .expect("immutable callback context");
            // These actual reads lazily bind previously unparsed codecs. No
            // registration/binding lock or scratch borrow spans reentry.
            assert_eq!(
                snapshot.view().foreign_state(outer, "late-flat"),
                Some(&json!(7))
            );
            assert_eq!(
                snapshot.view().foreign_state(outer, "late-default"),
                Some(&json!(7))
            );
            let nested = snapshot
                .view()
                .export_json_reusing(nested, JsonExportBuffer::default())
                .expect("reentrant export");
            assert_eq!(nested.json()["text"], "nested");
            event("reentered");
            self.0.into()
        }
        fn js_equal(&self, other: &Self) -> bool {
            self.0 == other.0
        }
    }
    static HOOK: StateKey<Hook> = StateKey::new("foreign-callback", |value| {
        Hook(
            value
                .and_then(Value::as_u64)
                .and_then(|value| value.try_into().ok())
                .unwrap_or(0),
        )
    });
    #[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
    struct Foreign {}
    impl NodeType for Foreign {
        const TYPE: &'static str = "buffer-foreign";
        type Kind = DecoratorKind;
        const REQUIRED_STATE: &'static [RequiredState] = &[RequiredState::nested(&HOOK)];
        impl_default_node!();
    }
    impl DecoratorNode for Foreign {
        decorator_node_base!();
    }
    struct Codec {
        omit: bool,
    }
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &Value, b: &Value) -> bool {
            a == b
        }
        fn is_default(&self, value: &Value) -> bool {
            event(if self.omit {
                "foreign-default"
            } else {
                "foreign-flat"
            });
            self.omit && value == &json!(7)
        }
    }
    #[test]
    fn known_callback_binds_foreign_codecs_before_flattening_and_default_omission()
    -> Result<(), Error> {
        let mut editor = Editor::builder(EditorMode::Headless)
            .node::<Foreign>()
            .build()
            .expect("editor");
        let ((key, target), _) = editor.update(|tx| {
            let key = tx.import_node(json!({"type":"buffer-foreign","version":1,"$":{"late-flat":7,"late-default":7,"tail":true}}).as_object().expect("node"))?;
            tx.set_state(key, &HOOK, Hook(1))?;
            let p = tx.create(Paragraph::default())?;
            let target = tx.create_text("nested")?;
            tx.append(p, &[target.key()])?;
            tx.append(NodeKey::ROOT, &[key,p.key()])?;
            Ok((key,target.key()))
        })?;
        editor.register_foreign_state(ForeignStateConfig {
            key: "late-flat".into(),
            flat: true,
            codec: Arc::new(Codec { omit: false }),
        })?;
        editor.register_foreign_state(ForeignStateConfig {
            key: "late-default".into(),
            flat: false,
            codec: Arc::new(Codec { omit: true }),
        })?;
        let before = editor.state().clone();
        let state = before
            .view()
            .slot(key)
            .expect("node")
            .state
            .as_ref()
            .expect("state");
        assert!(!state.foreign.contains("late-flat"));
        assert!(!state.foreign.contains("late-default"));
        CONTEXT.with(|context| *context.borrow_mut() = Some((before.clone(), key, target)));
        EVENTS.with(|events| events.borrow_mut().clear());
        let mut buffer = JsonExportBuffer::default();
        for _ in 0..2 {
            buffer = before.view().export_json_reusing(key, buffer)?;
            assert_eq!(
                EVENTS.with(|events| events.replace(Vec::new())),
                ["known", "reentered", "foreign-flat", "foreign-default"]
            );
            assert_eq!(
                to_js_json_string(&Value::Object(buffer.json().clone())),
                r#"{"type":"buffer-foreign","version":1,"late-flat":7,"$":{"tail":true,"foreign-callback":1}}"#
            );
        }
        assert!(state.foreign.contains("late-flat"));
        assert!(state.foreign.contains("late-default"));
        assert_eq!(
            before.view().foreign_state(key, "late-default"),
            Some(&json!(7)),
            "omission never rewrites stored values"
        );
        assert!(before.same_snapshot(editor.state()));
        CONTEXT.with(|context| *context.borrow_mut() = None);
        Ok(())
    }
}
