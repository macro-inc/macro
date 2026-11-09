use super::*;
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

#[test]
fn owner_registry_keys_expire_after_the_last_editor_state_and_instance() -> Result<(), Error> {
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let owner = editor.foreign_instance_owner();
    let weak = owner.downgrade();
    let state = editor.state().clone();
    let instance = ForeignInstance::new(owner.clone(), 1, 1)?;
    assert!(owner.same_owner(&weak.upgrade().unwrap()));
    assert!(weak.same_owner(&owner.downgrade()));
    let other = Editor::builder(EditorMode::Headless).build().unwrap();
    assert!(!owner.same_owner(&other.foreign_instance_owner()));
    drop(owner);
    drop(editor);
    assert!(weak.upgrade().is_some());
    drop(state);
    assert!(weak.upgrade().is_some());
    drop(instance);
    assert!(weak.upgrade().is_none());
    Ok(())
}

#[test]
fn render_records_capture_typed_native_fields_without_public_export_calls() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn adjust_export_json(
            &self,
            _node: NodeView<'_>,
            _data: &ForeignData,
            _json: &mut SerializedNode,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(Err(Error::Invariant("public export must not render")))
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "render-paragraph".into(),
            class_name: "RenderParagraph".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .unwrap();
    struct Instances;
    impl ForeignInstanceHooks for Instances {
        fn validate_instance(
            &self,
            _type_name: &str,
            _instance: &ForeignInstance,
        ) -> Result<(), Error> {
            Ok(())
        }
        fn clone_instance(
            &self,
            _request: ForeignInstanceCloneRequest,
        ) -> Result<ForeignInstanceClone, Error> {
            Err(Error::Invariant(
                "unhydrated capture must not construct instances",
            ))
        }
    }
    editor.install_foreign_instance_hooks(Arc::new(Instances))?;
    let (key, commit) = editor.update(|tx| {
        let p = tx.create_foreign("render-paragraph", SerializedNode::new())?;
        tx.append(NodeKey::ROOT, &[p])?;
        Ok(p)
    })?;
    let diff = commit.diff(&DiffOptions {
        include_state: true,
    })?;
    assert!(diff.ops.iter().any(
        |op| matches!(op,DiffOp::CreateElement { key:k,props,.. } if *k == key && props.is_empty())
    ));
    let source = editor.state().view().snapshot_for_foreign_read()?;
    let records = source.render_records([key, NodeKey::ROOT])?;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].record().key(), key);
    assert_eq!(records[0].native_type(), Some("paragraph"));
    assert!(records[0].native::<Paragraph>().is_some());
    assert!(records[0].native::<Text>().is_none());
    assert_eq!(records[0].links().parent, Some(NodeKey::ROOT));
    assert!(records[0].identity() == &source.record_identity(key)?);
    assert!(
        records[0]
            .owner()
            .same_owner(&editor.foreign_instance_owner())
    );
    assert!(source.view().export_json(key).is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    editor.update(|tx| tx.append(key, &[]))?;
    assert_eq!(records[0].links().size, 0);
    Ok(())
}

#[test]
fn bound_instance_diff_skips_public_export_indent_and_node_state_callbacks() -> Result<(), Error> {
    struct Hooks(Arc<AtomicU32>);
    impl ForeignHooks for Hooks {
        fn adjust_export_json(
            &self,
            _node: NodeView<'_>,
            _data: &ForeignData,
            _json: &mut SerializedNode,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(Err(Error::Invariant("export used during render")))
        }
        fn indent(&self, _node: NodeView<'_>, _data: &ForeignData) -> Override<u32> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(9)
        }
    }
    struct Codec(Arc<AtomicU32>);
    impl ForeignStateCodec for Codec {
        fn is_equal(&self, a: &serde_json::Value, b: &serde_json::Value) -> bool {
            self.0.fetch_add(1, Ordering::SeqCst);
            a == b
        }
        fn is_default(&self, _value: &serde_json::Value) -> bool {
            self.0.fetch_add(1, Ordering::SeqCst);
            false
        }
    }
    struct Instances(AtomicU32);
    impl ForeignInstanceHooks for Instances {
        fn validate_instance(
            &self,
            type_name: &str,
            instance: &ForeignInstance,
        ) -> Result<(), Error> {
            if type_name == "render-bound" && instance.class_id() == 1 {
                Ok(())
            } else {
                Err(Error::Invariant("invalid render instance"))
            }
        }
        fn clone_instance(
            &self,
            request: ForeignInstanceCloneRequest,
        ) -> Result<ForeignInstanceClone, Error> {
            Ok(ForeignInstanceClone {
                instance: ForeignInstance::new(
                    request.destination_owner,
                    1,
                    self.0.fetch_add(1, Ordering::SeqCst),
                )?,
                base: request.base,
                observed_links: request.required_links,
                payload: None,
                root_cache: None,
            })
        }
    }
    let calls = Arc::new(AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "render-bound".into(),
            class_name: "RenderBound".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .foreign_state(ForeignStateConfig {
            key: "render-state".into(),
            flat: false,
            codec: Arc::new(Codec(calls.clone())),
        })
        .build()
        .unwrap();
    editor.install_foreign_instance_hooks(Arc::new(Instances(AtomicU32::new(2))))?;
    let (key, _) = editor.update(|tx| {
        let key = tx.create_foreign("render-bound", SerializedNode::new())?;
        tx.set_foreign_state(key, "render-state", 1.into())?;
        tx.append(NodeKey::ROOT, &[key])?;
        Ok(key)
    })?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    editor.state().view().bind_foreign_instance(
        key,
        &identity,
        ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?,
    )?;
    let (_, commit) = editor.update(|tx| {
        tx.set_foreign_field(key, "custom-js-field", true.into())?;
        tx.set_foreign_state(key, "render-state", 2.into())?;
        tx.set_indent(key, 2)?;
        Ok(())
    })?;
    calls.store(0, Ordering::SeqCst);
    let diff = commit.diff(&DiffOptions {
        include_state: true,
    })?;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(
        diff.ops
            .iter()
            .any(|op| matches!(op,DiffOp::ElementProps{key:k,props} if *k==key && props.indent==2))
    );
    assert!(diff.ops.iter().any(|op|matches!(op,DiffOp::NodeProps{key:k,props} if *k==key && !props.contains_key("custom-js-field"))));
    assert!(
        !diff
            .ops
            .iter()
            .any(|op| matches!(op,DiffOp::State{key:k,..} if *k==key))
    );
    let records = commit
        .next
        .view()
        .snapshot_for_foreign_read()?
        .render_records([key])?;
    assert_eq!(
        records[0]
            .record()
            .foreign_instance()
            .unwrap()
            .instance_id(),
        2
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}
