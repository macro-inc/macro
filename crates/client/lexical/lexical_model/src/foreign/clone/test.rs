use crate::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};

#[test]
fn cow_clone_reads_an_owned_original_and_clears_its_scope() -> Result<(), Error> {
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            key: NodeKey,
            original: NodeKey,
            data: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            let source = ForeignCloneContext::capture().expect("owned clone source");
            assert_eq!(key, original);
            assert_eq!(
                source
                    .state()
                    .view()
                    .element_data(original)
                    .expect("element")
                    .indent,
                0
            );
            assert_eq!(
                source
                    .state()
                    .view()
                    .foreign_data(original)
                    .expect("payload")
                    .fields["marker"],
                "original"
            );
            self.0.fetch_add(1, Ordering::SeqCst);
            let mut data = data.clone();
            data.fields.insert("marker".into(), "cloned".into());
            Override::Value(Some(data))
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "clone-element".into(),
            class_name: "CloneElement".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "clone-element",
        serde_json::from_str(r#"{"marker":"original"}"#).expect("fields"),
    )?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    let previous = editor.state().clone();
    let mut tx = editor.transaction();
    tx.set_indent(key, 2)?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        tx.foreign_data(key).expect("new payload").fields["marker"],
        "cloned"
    );
    assert_eq!(
        previous
            .view()
            .foreign_data(key)
            .expect("old payload")
            .fields["marker"],
        "original"
    );
    assert!(ForeignCloneContext::capture().is_none());
    tx.commit()?;
    Ok(())
}

#[test]
fn failed_clone_drops_its_read_input_before_a_later_update() -> Result<(), Error> {
    struct Hooks(Arc<AtomicBool>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            assert!(ForeignCloneContext::capture().is_some());
            if self.0.load(Ordering::SeqCst) {
                ForeignReadOperation::defer(Error::Invariant("clone failed"))
                    .expect("active failure scope");
            }
            Override::Value(None)
        }
    }
    let fail = Arc::new(AtomicBool::new(false));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "failing-clone".into(),
            class_name: "FailingClone".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(fail.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("failing-clone", SerializedNode::new())?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    fail.store(true, Ordering::SeqCst);
    let operation = ForeignReadOperation::begin()?;
    let mut tx = editor.transaction();
    assert!(tx.set_indent(key, 2).is_err());
    assert!(ForeignCloneContext::capture().is_none());
    assert!(operation.finish(Ok::<_, Error>(())).is_err());
    drop(tx);
    fail.store(false, Ordering::SeqCst);
    let mut tx = editor.transaction();
    tx.set_indent(key, 3)?;
    assert_eq!(tx.element_data(key).expect("element").indent, 3);
    tx.commit()?;
    assert!(ForeignCloneContext::capture().is_none());
    Ok(())
}

#[test]
fn sliced_text_export_clones_with_an_owned_unsliced_source() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            key: NodeKey,
            original: NodeKey,
            data: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            let source = ForeignCloneContext::capture().expect("slice clone source");
            assert_eq!(key, original);
            assert_eq!(source.state().view().text_content(original), "before");
            let mut data = data.clone();
            data.fields.insert("marker".into(), "sliced".into());
            Override::Value(Some(data))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "clone-text".into(),
            class_name: "CloneText".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "clone-text",
        serde_json::from_str(r#"{"marker":"source"}"#).expect("fields"),
    )?;
    tx.text(key)?.set_text_content("before")?;
    let sliced = tx.view().export_text_slice(key, "be")?;
    assert_eq!(sliced["text"], "be");
    assert_eq!(sliced["marker"], "sliced");
    assert_eq!(tx.text_content(key), "before");
    assert_eq!(
        tx.foreign_data(key).expect("source fields").fields["marker"],
        "source"
    );
    assert!(ForeignCloneContext::capture().is_none());
    Ok(())
}

#[test]
fn an_inherited_native_clone_normalizes_its_fields_without_dropping_foreign_fields()
-> Result<(), Error> {
    #[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct NativeClone {
        language: String,
    }
    impl NodeType for NativeClone {
        const TYPE: &'static str = "native-clone";
        type Kind = ElementKind;
        impl_default_node!();
        fn after_clone(&self) -> Option<Self> {
            Some(Self {
                language: "javascript".into(),
            })
        }
    }
    impl ElementNode for NativeClone {
        element_node_base!();
    }
    struct Inherit;
    impl ForeignHooks for Inherit {}
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<NativeClone>()
        .foreign_node(ForeignNodeType {
            type_name: "native-clone-child".into(),
            class_name: "NativeCloneChild".into(),
            kind: NodeKind::Element,
            extends: Some("native-clone"),
            required_state: vec![],
            hooks: Arc::new(Inherit),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "native-clone-child",
        serde_json::from_str(r#"{"language":"js","marker":"keep"}"#).expect("fields"),
    )?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    let previous = editor.state().clone();
    let mut tx = editor.transaction();
    tx.set_indent(key, 1)?;
    assert_eq!(
        tx.foreign_data(key).expect("payload").fields["language"],
        "javascript"
    );
    assert_eq!(
        tx.foreign_data(key).expect("payload").fields["marker"],
        "keep"
    );
    assert_eq!(
        tx.foreign_data(key)
            .expect("payload")
            .fields
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["language", "marker"]
    );
    assert_eq!(tx.export_json(key)?["type"], "native-clone-child");
    assert_eq!(tx.export_json(key)?["language"], "javascript");
    assert_eq!(
        previous
            .view()
            .foreign_data(key)
            .expect("old payload")
            .fields["language"],
        "js"
    );
    tx.commit()?;
    Ok(())
}

#[test]
fn invalid_clone_fields_fail_before_installing_a_writable_payload() -> Result<(), Error> {
    #[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Native {
        label: String,
    }
    impl NodeType for Native {
        const TYPE: &'static str = "checked-native-clone";
        type Kind = ElementKind;
        impl_default_node!();
    }
    impl ElementNode for Native {
        element_node_base!();
    }
    struct Invalid;
    impl ForeignHooks for Invalid {
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            Override::Value(Some(ForeignData {
                fields: serde_json::from_str(r#"{"label":42}"#).expect("fields"),
            }))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Native>()
        .foreign_node(ForeignNodeType {
            type_name: "invalid-native-clone".into(),
            class_name: "InvalidNativeClone".into(),
            kind: NodeKind::Element,
            extends: Some("checked-native-clone"),
            required_state: vec![],
            hooks: Arc::new(Invalid),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign(
        "invalid-native-clone",
        serde_json::from_str(r#"{"label":"before"}"#).expect("fields"),
    )?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    let operation = ForeignReadOperation::begin()?;
    let result = tx.set_indent(key, 2);
    assert!(operation.finish(result).is_err());
    assert_eq!(
        tx.foreign_data(key).expect("original fields").fields["label"],
        "before"
    );
    assert_eq!(tx.element_data(key).expect("original base").indent, 0);
    assert!(ForeignCloneContext::capture().is_none());
    Ok(())
}
