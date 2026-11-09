use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicU32, Ordering},
};
struct Host {
    classes: Vec<(u32, &'static str)>,
    next: AtomicU32,
    failure: AtomicU32,
    calls: Mutex<Vec<ForeignCloneMode>>,
}
impl ForeignInstanceHooks for Host {
    fn validate_instance(&self, type_name: &str, instance: &ForeignInstance) -> Result<(), Error> {
        if self
            .classes
            .iter()
            .any(|(id, ty)| *id == instance.class_id() && *ty == type_name)
        {
            Ok(())
        } else {
            Err(Error::Invariant(
                "foreign instance class registration mismatch",
            ))
        }
    }
    fn clone_instance(
        &self,
        request: ForeignInstanceCloneRequest,
    ) -> Result<ForeignInstanceClone, Error> {
        if request.source.view().is_text(request.constructor_key) {
            assert_eq!(
                request.source.view().text_content(request.constructor_key),
                "before"
            );
        }
        if request.mode == ForeignCloneMode::Copy {
            assert!(!request.source.view().contains(request.destination_key));
        }
        self.calls.lock().unwrap().push(request.mode);
        let ty = request.source.view().type_name(request.constructor_key)?;
        let class = self
            .classes
            .iter()
            .find(|(_, name)| *name == ty)
            .ok_or(Error::Invariant("missing test class"))?
            .0;
        let instance = ForeignInstance::new(
            request.destination_owner,
            class,
            self.next.fetch_add(1, Ordering::SeqCst),
        )?;
        let instance = if request.mode == ForeignCloneMode::Ephemeral {
            instance.ephemeral()
        } else {
            instance
        };
        let mut result = ForeignInstanceClone {
            instance,
            base: request.base,
            observed_links: request.required_links,
            payload: None,
            root_cache: None,
        };
        match self.failure.load(Ordering::SeqCst) {
            1 => result.observed_links.parent = Some(NodeKey::ROOT),
            2 => result.base = BaseData::Decorator,
            3 => {
                result.instance = ForeignInstance::new(
                    result.instance.owner().clone(),
                    999,
                    result.instance.instance_id(),
                )?
            }
            4 => {
                result.payload = Some(Box::new(PayloadPatch {
                    value: 999,
                    fail: true,
                }))
            }
            5 => ForeignReadOperation::defer(Error::Invariant("caught callback failure"))?,
            6 => result.root_cache = Some("wrong root cache".into()),
            7 => {
                result.payload = Some(Box::new(PayloadPatch {
                    value: 9,
                    fail: false,
                }));
                if let BaseData::Text(data) = &mut result.base {
                    data.format = TextFormat::BOLD;
                }
            }
            _ => {}
        }
        Ok(result)
    }
}
#[test]
fn readonly_hydration_and_captures_preserve_instance_while_semantic_write_clones_it()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let state = editor.state().clone();
    let identity = state.view().foreign_record_identity(key)?;
    let instance = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
    state
        .view()
        .bind_foreign_instance(key, &identity, instance.clone())?;
    assert_eq!(
        editor.state().view().foreign_instance(key),
        Some(instance.clone())
    );
    let captured = state.view().node_or_err(key)?.capture_for_foreign_read();
    assert_eq!(captured.as_ref().key(), key);
    assert_eq!(captured.as_ref().foreign_instance(), Some(instance.clone()));
    assert!(host.calls.lock().unwrap().is_empty());
    editor.update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))?;
    assert_eq!(
        host.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::CopyOnWrite]
    );
    assert_eq!(state.view().text_content(key), "before");
    assert_eq!(state.view().foreign_instance(key), Some(instance));
    assert_eq!(
        editor
            .state()
            .view()
            .foreign_instance(key)
            .unwrap()
            .instance_id(),
        2
    );
    Ok(())
}

#[test]
fn copies_get_fresh_keys_but_ephemeral_clones_keep_keys_without_changing_the_source()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let original = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    editor
        .state()
        .view()
        .bind_foreign_instance(key, &identity, original.clone())?;
    let ((copy_key, captured), _) = editor.update(|tx| {
        let copy = tx.copy_node(key, true)?;
        assert_ne!(copy, key);
        assert_eq!(tx.view().foreign_instance(copy).unwrap().instance_id(), 2);
        Ok((copy, tx.node_or_err(copy)?.capture_for_foreign_read()))
    })?;
    assert_eq!(captured.as_ref().key(), copy_key);
    assert_eq!(
        captured.as_ref().foreign_instance().unwrap().instance_id(),
        2
    );
    let sliced = editor.state().view().with_text_slice(key, "fore")?;
    assert_eq!(sliced.view().text_content(key), "fore");
    assert_eq!(
        sliced.view().foreign_instance(key).unwrap().instance_id(),
        3
    );
    assert!(sliced.view().foreign_instance(key).unwrap().is_ephemeral());
    assert_eq!(editor.state().view().foreign_instance(key), Some(original));
    assert_eq!(editor.state().view().text_content(key), "before");
    assert_eq!(
        host.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::Copy, ForeignCloneMode::Ephemeral]
    );
    Ok(())
}

#[test]
fn transferred_snapshots_keep_their_instance_namespace_until_a_real_write_clones()
-> Result<(), Error> {
    let mut source = Editor::builder(EditorMode::Headless).build().unwrap();
    let a = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    source.install_foreign_instance_hooks(a.clone())?;
    let (key, _) = source.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let instance = ForeignInstance::new(source.foreign_instance_owner(), 1, 1)?;
    let identity = source.state().view().foreign_record_identity(key)?;
    source
        .state()
        .view()
        .bind_foreign_instance(key, &identity, instance.clone())?;
    let snapshot = source.state().clone();
    let mut peer = source.create_conformance_peer(EditorMode::Headless)?;
    let b = Arc::new(Host {
        classes: vec![(7, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    peer.install_foreign_instance_hooks(b.clone())?;
    peer.set_editor_state(snapshot.clone(), TagSet::default())?;
    assert!(a.calls.lock().unwrap().is_empty());
    assert!(b.calls.lock().unwrap().is_empty());
    assert_eq!(
        peer.state().view().foreign_instance(key),
        Some(instance.clone())
    );
    let conflicting = ForeignInstance::new(peer.foreign_instance_owner(), 1, 1)?;
    assert_ne!(conflicting, instance);
    let identity = peer.state().view().foreign_record_identity(key)?;
    assert!(
        peer.state()
            .view()
            .bind_foreign_instance(key, &identity, conflicting)
            .is_err()
    );
    peer.update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))?;
    assert!(
        !peer
            .state()
            .view()
            .foreign_instance(key)
            .unwrap()
            .same_owner(&instance)
    );
    assert_eq!(
        peer.state()
            .view()
            .foreign_instance(key)
            .unwrap()
            .class_id(),
        7
    );
    assert_eq!(snapshot.view().foreign_instance(key), Some(instance));
    assert_eq!(snapshot.view().text_content(key), "before");
    assert!(a.calls.lock().unwrap().is_empty());
    assert_eq!(
        b.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::CopyOnWrite]
    );
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct PayloadText {
    value: u32,
}
impl NodeType for PayloadText {
    const TYPE: &'static str = "instance-text";
    type Kind = TextKind;
    crate::impl_default_node!();
}
impl TextNode for PayloadText {
    crate::text_node_base!();
}
struct PayloadPatch {
    value: u32,
    fail: bool,
}
impl ForeignPayloadPatch for PayloadPatch {
    fn apply(&self, payload: &mut dyn Any) -> Result<(), Error> {
        payload
            .downcast_mut::<PayloadText>()
            .ok_or(Error::Invariant("payload type mismatch"))?
            .value = self.value;
        if self.fail {
            Err(Error::Invariant("partial native patch failure"))
        } else {
            Ok(())
        }
    }
}
#[test]
fn failed_stages_and_partial_payload_patches_never_install_into_the_source() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<PayloadText>()
        .build()
        .unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "instance-text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create(PayloadText { value: 7 })?;
        tx.text(text)?.set_text_content("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let original = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    let wrong = ForeignInstance::new(editor.foreign_instance_owner(), 999, 1)?;
    assert!(
        editor
            .state()
            .view()
            .bind_foreign_instance(key, &identity, wrong)
            .is_err()
    );
    editor
        .state()
        .view()
        .bind_foreign_instance(key, &identity, original.clone())?;
    let before = editor.state().to_json()?;
    for failure in 1..=6 {
        host.failure.store(failure, Ordering::SeqCst);
        assert!(
            editor
                .update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))
                .is_err(),
            "failure {failure}"
        );
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(
            editor.state().view().foreign_instance(key),
            Some(original.clone())
        );
        assert_eq!(
            editor.state().view().get::<PayloadText>(key).unwrap().value,
            7
        );
        assert!(editor.state().view().foreign_record_identity(key)? == identity);
    }
    host.failure.store(1, Ordering::SeqCst);
    {
        let mut tx = editor.transaction();
        assert!(tx.text(key)?.set_text_content("after").is_err());
        assert!(!tx.has_dirty_nodes());
        tx.flush()?;
        assert!(!tx.has_foreign_effects());
    }
    host.failure.store(7, Ordering::SeqCst);
    editor.update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))?;
    assert_eq!(
        editor.state().view().get::<PayloadText>(key).unwrap().value,
        9
    );
    assert_eq!(
        editor.state().view().text(key).unwrap().format,
        TextFormat::BOLD
    );
    Ok(())
}

#[test]
fn derived_cache_writers_clone_instances_but_restoring_a_matching_root_cache_does_not()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(10, "root"), (11, "paragraph"), (12, "text")],
        next: AtomicU32::new(4),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let ((p, text), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), text.key()))
    })?;
    for (key, class, instance) in [(NodeKey::ROOT, 10, 1), (p, 11, 2), (text, 12, 3)] {
        let identity = editor.state().view().foreign_record_identity(key)?;
        editor.state().view().bind_foreign_instance(
            key,
            &identity,
            ForeignInstance::new(editor.foreign_instance_owner(), class, instance)?,
        )?;
    }
    let saved = editor.state().clone();
    assert_eq!(
        saved.view().foreign_root_cached_text()?.as_deref(),
        Some("before")
    );
    editor.update(|tx| tx.text(text)?.set_format(TextFormat::BOLD).map(|_| ()))?;
    assert_eq!(
        editor
            .state()
            .view()
            .foreign_instance(NodeKey::ROOT)
            .unwrap()
            .instance_id(),
        1
    );
    assert_eq!(
        editor
            .state()
            .view()
            .foreign_instance(p)
            .unwrap()
            .instance_id(),
        5
    );
    assert_eq!(
        editor.state().view().element(p).unwrap().text_format,
        TextFormat::BOLD
    );
    assert_eq!(
        saved.view().element(p).unwrap().text_format,
        TextFormat::empty()
    );
    assert_eq!(host.calls.lock().unwrap().len(), 2);
    let mut peer = editor.create_conformance_peer(EditorMode::ViewAttached)?;
    let peer_host = Arc::new(Host {
        classes: vec![(10, "root"), (11, "paragraph"), (12, "text")],
        next: AtomicU32::new(4),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    peer.install_foreign_instance_hooks(peer_host.clone())?;
    peer.set_editor_state(saved.clone(), TagSet::default())?;
    assert!(peer_host.calls.lock().unwrap().is_empty());
    assert_eq!(
        peer.state().view().foreign_instance(NodeKey::ROOT),
        saved.view().foreign_instance(NodeKey::ROOT)
    );
    peer.update(|tx| tx.text(text)?.set_text_content("after").map(|_| ()))?;
    assert_eq!(peer_host.calls.lock().unwrap().len(), 2);
    assert_eq!(
        peer.state().view().foreign_root_cached_text()?.as_deref(),
        Some("after")
    );
    assert_eq!(
        saved.view().foreign_root_cached_text()?.as_deref(),
        Some("before")
    );
    Ok(())
}

#[test]
fn retained_read_captures_do_not_repeat_semantic_clones_within_one_update() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    editor.state().view().bind_foreign_instance(
        key,
        &identity,
        ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?,
    )?;
    let (captured, _) = editor.update(|tx| {
        tx.text(key)?.set_text_content("first")?;
        let captured = tx.view().snapshot_for_foreign_read()?;
        tx.text(key)?.set_text_content("second")?;
        assert_eq!(captured.view().text_content(key), "first");
        assert_eq!(
            captured.view().foreign_instance(key),
            tx.view().foreign_instance(key)
        );
        Ok(captured)
    })?;
    assert_eq!(editor.state().view().text_content(key), "second");
    assert_eq!(captured.view().text_content(key), "first");
    assert_eq!(
        host.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::CopyOnWrite]
    );
    Ok(())
}

#[test]
fn explicit_restore_clones_instances_once_while_state_install_retains_them() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    let original = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
    editor
        .state()
        .view()
        .bind_foreign_instance(key, &identity, original.clone())?;
    let saved = editor.state().clone();
    editor.update(|tx| {
        tx.restore_editor_state(&saved)?;
        tx.text(key)?.set_text_content("after")?;
        Ok(())
    })?;
    assert_eq!(
        host.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::Restore]
    );
    assert_ne!(
        editor.state().view().foreign_instance(key),
        Some(original.clone())
    );
    assert_eq!(saved.view().foreign_instance(key), Some(original.clone()));
    editor.set_editor_state(saved, TagSet::default())?;
    assert_eq!(editor.state().view().foreign_instance(key), Some(original));
    assert_eq!(host.calls.lock().unwrap().len(), 1);
    Ok(())
}

#[test]
fn semantic_instance_write_materializes_learned_node_state_before_installation() -> Result<(), Error>
{
    static VALUE: StateKey<String> = StateKey::new("staged-value", |value| {
        value
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .into()
    });
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host.clone())?;
    let (key, _) = editor.update(|tx| {
        let text = tx.import_node(
            serde_json::json!({"type":"text","text":"before","$":{"staged-value":"saved"}})
                .as_object()
                .unwrap(),
        )?;
        let other = tx.create_text("other")?;
        tx.set_state(other, &VALUE, "teach".into())?;
        assert_eq!(tx.get_state(other, &VALUE)?, "teach");
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    editor.state().view().bind_foreign_instance(
        key,
        &identity,
        ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?,
    )?;
    let before = editor.state().clone();
    assert!(
        before
            .view()
            .node(key)
            .unwrap()
            .node_state()
            .unwrap()
            .unknown()
            .unwrap()
            .contains_key("staged-value")
    );
    editor.update(|tx| tx.text(key)?.set_format(TextFormat::BOLD).map(|_| ()))?;
    assert_eq!(
        editor
            .state()
            .view()
            .node(key)
            .unwrap()
            .node_state()
            .unwrap()
            .known_names()
            .collect::<Vec<_>>(),
        vec!["staged-value"]
    );
    assert!(
        !editor
            .state()
            .view()
            .node(key)
            .unwrap()
            .node_state()
            .unwrap()
            .unknown()
            .unwrap()
            .contains_key("staged-value")
    );
    assert!(
        before
            .view()
            .node(key)
            .unwrap()
            .node_state()
            .unwrap()
            .unknown()
            .unwrap()
            .contains_key("staged-value")
    );
    assert_eq!(editor.state().view().get_state(key, &VALUE)?, "saved");
    assert_eq!(host.calls.lock().unwrap().len(), 1);
    Ok(())
}

#[test]
fn bound_root_cache_survives_owned_capture_without_prior_text_reads() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "root")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host)?;
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text.key())
    })?;
    let captured = editor.state().view().snapshot_for_foreign_read()?;
    captured.view().bind_foreign_instance(
        NodeKey::ROOT,
        &captured.record_identity(NodeKey::ROOT)?,
        ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?,
    )?;
    editor.update(|tx| tx.text(key)?.set_text_content("after").map(|_| ()))?;
    let next = editor.state().view().snapshot_for_foreign_read()?;
    assert_eq!(
        next.view().foreign_root_cached_text()?.as_deref(),
        Some("after")
    );
    assert_eq!(
        captured.view().foreign_root_cached_text()?.as_deref(),
        Some("before")
    );
    assert_eq!(
        captured
            .view()
            .foreign_instance(NodeKey::ROOT)
            .unwrap()
            .instance_id(),
        1
    );
    assert_eq!(
        next.view()
            .foreign_instance(NodeKey::ROOT)
            .unwrap()
            .instance_id(),
        2
    );
    Ok(())
}

#[test]
fn failed_node_state_parse_keeps_the_original_instance_and_record() -> Result<(), Error> {
    static VALUE: StateKey<String> = StateKey::new("staged-failure", |value| {
        if value.and_then(serde_json::Value::as_str) == Some("reject") {
            ForeignReadOperation::defer(Error::Invariant("staged state parse rejected")).unwrap();
        }
        String::new()
    });
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    editor.install_foreign_instance_hooks(host)?;
    let (key, _) = editor.update(|tx| {
        let text = tx.import_node(
            serde_json::json!({"type":"text","text":"before","$":{"staged-failure":"reject"}})
                .as_object()
                .unwrap(),
        )?;
        let other = tx.create_text("other")?;
        tx.set_state(other, &VALUE, "teach".into())?;
        let p = tx.create(Paragraph::default())?;
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let identity = editor.state().view().foreign_record_identity(key)?;
    let instance = ForeignInstance::new(editor.foreign_instance_owner(), 1, 1)?;
    editor
        .state()
        .view()
        .bind_foreign_instance(key, &identity, instance.clone())?;
    let before = editor.state().to_json()?;
    assert!(
        editor
            .update(|tx| tx.text(key)?.set_format(TextFormat::BOLD).map(|_| ()))
            .is_err()
    );
    assert_eq!(editor.state().to_json()?, before);
    assert!(editor.state().view().foreign_record_identity(key)? == identity);
    assert_eq!(editor.state().view().foreign_instance(key), Some(instance));
    Ok(())
}

#[test]
fn builder_installs_instance_host_before_initial_state_publication()
-> Result<(), Box<dyn std::error::Error>> {
    struct BindInitial(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Plugin for BindInitial {
        fn name(&self) -> &'static str {
            "bind-initial-instance"
        }
        fn commands(&self) -> &[CommandRegistration] {
            &[]
        }
        fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
            Ok(Handled::No)
        }
        fn after_commit(&self, tx: &mut Transaction<'_>, _: &Commit) -> Result<(), Error> {
            if !self.0.swap(true, Ordering::SeqCst) {
                let key = tx.nodes_of_type::<Text>()[0].key();
                let identity = tx.view().foreign_record_identity(key)?;
                let instance = ForeignInstance::new(tx.foreign_editor_identity(), 1, 1)?;
                tx.view().bind_foreign_instance(key, &identity, instance)?;
            }
            Ok(())
        }
    }
    let host = Arc::new(Host {
        classes: vec![(1, "text")],
        next: AtomicU32::new(2),
        failure: AtomicU32::new(0),
        calls: Mutex::new(vec![]),
    });
    let bound = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let json = serde_json::from_value(
        serde_json::json!({"root":{"type":"root","version":1,"children":[{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"before","format":0,"detail":0,"mode":"normal","style":""}]}]}}),
    )?;
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_instance_hooks(host.clone())
        .plugin(BindInitial(bound.clone()))
        .initial_state(json)
        .build()?;
    assert!(bound.load(Ordering::SeqCst));
    let key = editor.state().view().nodes_of_type::<Text>()[0].key();
    assert_eq!(
        editor
            .state()
            .view()
            .foreign_instance(key)
            .unwrap()
            .instance_id(),
        1
    );
    editor.update(|tx| {
        tx.text(key)?.set_text_content("after")?;
        Ok(())
    })?;
    assert_eq!(
        host.calls.lock().unwrap().as_slice(),
        &[ForeignCloneMode::CopyOnWrite]
    );
    assert_eq!(
        editor
            .state()
            .view()
            .foreign_instance(key)
            .unwrap()
            .instance_id(),
        2
    );
    Ok(())
}
