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

#[test]
fn capture_metadata_retains_detached_keys_and_semantic_writability_across_reads()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let owner = editor.foreign_instance_owner();
    let mut tx = editor.transaction();
    assert!(tx.view().foreign_instance_owner().same_owner(&owner));
    assert!(!tx.foreign_is_writable(NodeKey::ROOT));
    let text = tx.create_text("detached")?.key();
    assert!(tx.foreign_is_writable(text));
    let source = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(source.record_keys(), vec![NodeKey::ROOT, text]);
    assert!(source.selection_identity().is_none());
    assert!(source.previous_selection_identity().is_none());
    assert!(tx.foreign_is_writable(text));
    tx.mark_dirty(NodeKey::ROOT)?;
    assert!(tx.foreign_is_writable(NodeKey::ROOT));
    let captured = tx.view().snapshot_for_foreign_read()?;
    assert!(tx.foreign_is_writable(NodeKey::ROOT));
    assert_eq!(captured.record_keys(), vec![NodeKey::ROOT, text]);
    assert_eq!(source.view().text_content(text), "detached");
    Ok(())
}

#[test]
fn captures_expose_exact_current_and_previous_selection_identities() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("selected")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        Ok(())
    })?;
    let previous = editor.state().view().snapshot_for_foreign_read()?;
    let mut tx = editor.transaction();
    tx.replace_selection(Some(Selection::Node(NodeSelection::new())))?;
    let captured = tx.view().snapshot_for_foreign_read()?;
    assert!(captured.contains_selection_identity(captured.selection_identity().unwrap()));
    assert_eq!(
        captured.previous_selection_identity(),
        previous.selection_identity()
    );
    assert_ne!(
        captured.selection_identity(),
        captured.previous_selection_identity()
    );
    Ok(())
}

#[test]
fn raw_root_cache_reads_exact_captures_without_materializing_lazy_text() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("editor");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("before")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(t.key())
    })?;
    let old_root = editor
        .state()
        .view()
        .node_or_err(NodeKey::ROOT)?
        .capture_for_foreign_read();
    assert_eq!(
        old_root.as_ref().foreign_raw_root_cached_text(),
        Some("before")
    );
    editor.update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))?;
    let current_root = editor
        .state()
        .view()
        .node_or_err(NodeKey::ROOT)?
        .capture_for_foreign_read();
    assert_eq!(current_root.as_ref().foreign_raw_root_cached_text(), None);
    assert_eq!(
        editor
            .state()
            .view()
            .node_or_err(key)?
            .foreign_raw_root_cached_text(),
        None
    );
    assert_eq!(
        old_root.as_ref().foreign_raw_root_cached_text(),
        Some("before")
    );
    assert_eq!(
        editor.state().view().foreign_root_cached_text()?.as_deref(),
        Some("after")
    );
    assert_eq!(
        current_root.as_ref().foreign_raw_root_cached_text(),
        Some("after")
    );
    assert_eq!(
        old_root.as_ref().foreign_raw_root_cached_text(),
        Some("before")
    );
    Ok(())
}

#[test]
fn weak_owner_hash_keys_keep_identity_after_expiry_without_retaining_editors() {
    let first = Editor::builder(EditorMode::Headless)
        .build()
        .expect("first");
    let second = Editor::builder(EditorMode::Headless)
        .build()
        .expect("second");
    let alias = first.foreign_instance_owner().downgrade();
    let same = first.foreign_instance_owner().downgrade();
    let other = second.foreign_instance_owner().downgrade();
    let mut owners = std::collections::HashSet::new();
    assert!(owners.insert(alias.clone()));
    assert!(owners.contains(&same));
    assert!(owners.insert(other.clone()));
    assert_eq!(owners.len(), 2);
    drop(first);
    assert!(alias.upgrade().is_none());
    assert!(owners.contains(&same));
    owners.retain(|owner| owner.upgrade().is_some());
    assert_eq!(owners.len(), 1);
    assert!(owners.contains(&other));
}

#[test]
fn removal_facts_include_collected_descendants_across_suspension() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("removed")?;
        let survivor = tx.create(Paragraph {})?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key(), survivor.key()])?;
        Ok((paragraph.key(), text.key()))
    })?;
    let mut tx = editor.transaction();
    tx.remove(paragraph, false)?;
    tx.flush()?;
    let mut removed: Vec<_> = tx.foreign_removed_keys().collect();
    removed.sort_unstable();
    let mut expected = vec![paragraph, text];
    expected.sort_unstable();
    assert_eq!(removed, expected);
    let pending = tx.suspend();
    let tx = editor.resume(pending)?;
    assert_eq!(tx.foreign_removed_keys().count(), 2);
    assert!(!tx.foreign_removed_keys().any(|key| key == NodeKey::ROOT));
    Ok(())
}
