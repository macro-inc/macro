use super::*;
use lexical_model::*;

#[test]
fn encoded_handles_survive_suspension_and_keep_committed_fields() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let create_p = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    let content = super::super::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("content") as u32;
    let latest = super::super::index()
        .binary_search(&"LexicalNode.getLatest")
        .expect("latest") as u32;
    let writable = super::super::index()
        .binary_search(&"LexicalNode.getWritable")
        .expect("writable") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let text = host.call(&mut tx, create, json!(["a"]), None)?;
    assert_eq!(text, json!({"$h":0,"key":"1","type":"text","ver":1}));
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    let paragraph = host.call(&mut tx, create_p, json!([]), None)?;
    host.call(&mut tx, append, json!([text]), Some(paragraph.clone()))?;
    let root = host.call(&mut tx, root, json!([]), None)?;
    host.call(&mut tx, append, json!([paragraph]), Some(root))?;
    assert_eq!(
        host.call(&mut tx, latest, json!([]), Some(json!({"$h":0})))?,
        json!({"$h":0})
    );
    tx.flush()?;
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    assert_eq!(host.publish(commit.next)?, 1);
    host.release_version(1)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert!(host.read_field(&mut tx, 0, "__text").is_err());
    let get_by_key = super::super::index()
        .binary_search(&"lexical.$getNodeByKey")
        .expect("get node") as u32;
    let recaptured = host.call(&mut tx, get_by_key, json!(["1"]), None)?;
    assert_eq!(recaptured["ver"], 1);
    let recaptured_id = recaptured["$h"].as_u64().expect("handle") as u32;
    let new_text = host.call(&mut tx, writable, json!([]), Some(recaptured.clone()))?;
    assert_eq!(new_text["key"], "1");
    assert_eq!(new_text["ver"], 2);
    assert_ne!(new_text["$h"], 0);
    assert_eq!(
        host.call(&mut tx, writable, json!([]), Some(recaptured.clone()))?,
        json!({"$h":new_text["$h"]})
    );
    host.call(&mut tx, set, json!(["b"]), Some(new_text))?;
    assert_eq!(
        host.call(&mut tx, content, json!([]), Some(recaptured))?,
        "b"
    );
    assert_eq!(host.read_field(&mut tx, recaptured_id, "__text")?, "a");
    assert!(host.release_version(2).is_err());
    assert!(host.release_version(1).is_err());
    assert_eq!(host.read_field(&mut tx, recaptured_id, "__text")?, "a");
    drop(tx);
    host.discard_update()?;
    host.release_version(1)?;
    let mut tx = editor.transaction();
    assert!(host.read_field(&mut tx, recaptured_id, "__text").is_err());
    Ok(())
}

#[test]
fn selections_and_points_keep_identity_across_suspended_calls() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let set = super::super::index()
        .binary_search(&"lexical.$setSelection")
        .expect("set") as u32;
    let get = super::super::index()
        .binary_search(&"lexical.$getSelection")
        .expect("get") as u32;
    let anchor = super::super::index()
        .binary_search(&"get:anchor")
        .expect("anchor") as u32;
    let point_set = super::super::index()
        .binary_search(&"Selection.set")
        .expect("point set") as u32;
    let offset = super::super::index()
        .binary_search(&"get:offset")
        .expect("offset") as u32;
    let mut tx = editor.transaction();
    assert!(host.call(&mut tx, create, json!([]), None).is_err());
    host.begin_update(&mut tx)?;
    assert!(host.begin_update(&mut tx).is_err());
    let selection = host.call(&mut tx, create, json!([]), None)?;
    assert_eq!(selection, json!({"$sel":0,"kind":"range"}));
    host.call(&mut tx, set, json!([selection]), None)?;
    assert_eq!(host.call(&mut tx, get, json!([]), None)?, json!({"$sel":0}));
    let point = host.call(&mut tx, anchor, json!([]), Some(json!({"$sel":0})))?;
    assert_eq!(point, json!({"$pt":1}));
    let pending = tx.suspend();
    let mut tx = editor.resume(pending)?;
    host.call(
        &mut tx,
        point_set,
        json!(["root", 0, "element"]),
        Some(point),
    )?;
    assert_eq!(
        host.call(&mut tx, anchor, json!([]), Some(json!({"$sel":0})))?,
        json!({"$pt":1})
    );
    assert_eq!(
        host.call(&mut tx, offset, json!([]), Some(json!({"$pt":1})))?,
        0
    );
    tx.flush()?;
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    host.publish(commit.next)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert_eq!(
        host.call(&mut tx, get, json!([]), None)?,
        json!({"$sel":2,"kind":"range"})
    );
    assert_eq!(
        host.call(&mut tx, offset, json!([]), Some(json!({"$pt":1})))?,
        0
    );
    Ok(())
}

#[test]
fn discarded_updates_invalidate_handles_and_burn_their_allocated_keys() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let abandoned = host.call(&mut tx, create, json!(["abandoned"]), None)?;
    assert_eq!(abandoned["key"], "1");
    host.finish_update(&tx)?;
    assert!(host.begin_update(&mut tx).is_err());
    drop(tx);
    host.discard_update()?;
    assert!(host.discard_update().is_err());
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert!(
        host.read_field(
            &mut tx,
            abandoned["$h"].as_u64().expect("handle") as u32,
            "__text"
        )
        .is_err()
    );
    let next = host.call(&mut tx, create, json!(["next"]), None)?;
    assert_eq!(next["key"], "2");
    assert_eq!(next["ver"], 2);
    assert_ne!(next["$h"], abandoned["$h"]);
    assert!(host.publish(tx.committed_state().clone()).is_err());
    drop(tx);
    host.discard_update()?;
    Ok(())
}

#[test]
fn publication_refreshes_editor_state_handles_and_release_drops_saved_snapshots() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let state = super::super::index()
        .binary_search(&"LexicalEditor.getEditorState")
        .expect("state") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let initial = host.call(&mut tx, state, json!([]), None)?;
    assert_eq!(initial, json!({"$state":0}));
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    host.publish(commit.next)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let published = host.call(&mut tx, state, json!([]), None)?;
    assert_eq!(published, json!({"$state":1}));
    host.release_version(0)?;
    assert!(host.replay.saved_state(0).is_err());
    assert!(host.replay.saved_state(1).is_ok());
    assert!(host.replay.decode(&initial).is_err());
    assert!(host.replay.decode(&published).is_ok());
    Ok(())
}

#[test]
fn first_seen_committed_root_and_its_writable_record_have_distinct_versions() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Context::default();
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let writable = super::super::index()
        .binary_search(&"LexicalNode.getWritable")
        .expect("writable") as u32;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let committed = host.call(&mut tx, root, json!([]), None)?;
    assert_eq!(
        committed,
        json!({"$h":0,"key":"root","type":"root","ver":0})
    );
    let pending = host.call(&mut tx, writable, json!([]), Some(committed))?;
    assert_eq!(pending, json!({"$h":1,"key":"root","type":"root","ver":1}));
    assert_eq!(
        host.call(&mut tx, writable, json!([]), Some(json!({"$h":1})))?,
        json!({"$h":1})
    );
    Ok(())
}

#[test]
fn nested_host_frames_share_encoded_handles_and_published_snapshot_identity() -> Result<()> {
    struct Hooks {
        callback: CallbackContext,
        seen: std::sync::Arc<std::sync::Mutex<Vec<Value>>>,
    }
    impl ForeignHooks for Hooks {
        fn insert_after(
            &self,
            tx: &mut Transaction<'_>,
            _: NodeKey,
            _: NodeKey,
            _: bool,
        ) -> Override<std::result::Result<NodeKey, Error>> {
            let result = (|| -> Result<()> {
                let latest = super::super::index()
                    .binary_search(&"LexicalNode.getLatest")
                    .expect("latest") as u32;
                assert_eq!(
                    self.callback
                        .call(tx, latest, json!([]), Some(json!({"$h":0})))?,
                    json!({"$h":0})
                );
                let create = super::super::index()
                    .binary_search(&"lexical.$createTextNode")
                    .expect("create") as u32;
                let text = self.callback.call(tx, create, json!(["nested"]), None)?;
                assert_eq!(text, json!({"$h":2,"key":"3","type":"text","ver":1}));
                let append = super::super::index()
                    .binary_search(&"LexicalNode.append")
                    .expect("append") as u32;
                self.callback
                    .call(tx, append, json!([text.clone()]), Some(json!({"$h":1})))?;
                let state = super::super::index()
                    .binary_search(&"LexicalEditor.getEditorState")
                    .expect("state") as u32;
                let state = self.callback.call(tx, state, json!([]), None)?;
                assert_eq!(state, json!({"$state":3}));
                self.seen.lock().expect("log").extend([text, state]);
                Ok(())
            })();
            match result {
                Ok(()) => Override::Inherit,
                Err(error) => Override::Value(Err(Error::invariant(error.to_string()))),
            }
        }
    }
    let mut host = Context::default();
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "host-callback-paragraph".into(),
            class_name: "HostCallbackParagraph".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: std::sync::Arc::new(Hooks {
                callback: host.callbacks(),
                seen: seen.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    let first = tx.create_foreign("host-callback-paragraph", SerializedNode::new())?;
    let sibling = tx.create(Paragraph::default())?.key();
    tx.append(NodeKey::ROOT, &[first])?;
    let first = host.replay.node(tx.view(), first)?;
    let first = host.encode(first)?;
    let sibling = host.replay.node(tx.view(), sibling)?;
    let sibling = host.encode(sibling)?;
    let insert = super::super::index()
        .binary_search(&"LexicalNode.insertAfter")
        .expect("insert") as u32;
    host.call(&mut tx, insert, json!([sibling]), Some(first))?;
    let by_key = super::super::index()
        .binary_search(&"lexical.$getNodeByKey")
        .expect("by key") as u32;
    assert_eq!(
        host.call(&mut tx, by_key, json!(["3"]), None)?,
        json!({"$h":2})
    );
    assert_eq!(host.read_field(&mut tx, 2, "__text")?, "nested");
    let state = super::super::index()
        .binary_search(&"LexicalEditor.getEditorState")
        .expect("state") as u32;
    assert_eq!(
        host.call(&mut tx, state, json!([]), None)?,
        seen.lock().expect("log")[1]
    );
    tx.flush()?;
    host.finish_update(&tx)?;
    let commit = tx.commit()?;
    host.publish(commit.next)?;
    host.release_version(0)?;
    assert!(host.replay.decode(&json!({"$state":3})).is_err());
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert_eq!(
        host.call(&mut tx, state, json!([]), None)?,
        json!({"$state":4})
    );
    assert_eq!(
        host.call(&mut tx, by_key, json!(["3"]), None)?,
        json!({"$h":2})
    );
    drop(tx);
    host.discard_update()?;
    host.release_version(1)?;
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert_eq!(
        host.call(&mut tx, state, json!([]), None)?,
        json!({"$state":5})
    );
    assert!(host.replay.decode(&json!({"$h":2})).is_err());
    drop(tx);
    host.discard_update()?;
    host.release_version(1)?;
    Ok(())
}

#[test]
fn weak_callback_context_checks_scope_editor_and_does_not_retain_snapshots() -> Result<()> {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Hooks {
        _callback: CallbackContext,
        drops: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {}
    impl Drop for Hooks {
        fn drop(&mut self) {
            self.drops.fetch_add(1, Ordering::SeqCst);
        }
    }
    let mut host = Context::default();
    let callback = host.callbacks();
    let drops = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "weak-paragraph".into(),
            class_name: "WeakParagraph".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                _callback: callback.clone(),
                drops: drops.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut peer = editor.create_conformance_peer(EditorMode::Headless)?;
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let mut tx = editor.transaction();
    assert!(matches!(
        callback.call(&mut tx, create, json!(["outside"]), None),
        Err(crate::replay::ReplayError::NoActiveEditor)
    ));
    host.begin_update(&mut tx)?;
    let mut other = peer.transaction();
    assert_eq!(
        callback
            .call(&mut other, create, json!(["wrong"]), None)
            .expect_err("other editor")
            .to_string(),
        "callback transaction belongs to another editor"
    );
    assert_eq!(
        host.call(&mut other, create, json!(["wrong"]), None)
            .expect_err("other editor")
            .to_string(),
        "callback transaction belongs to another editor"
    );
    assert_eq!(
        host.read_field(&mut other, 0, "__text")
            .expect_err("other editor field")
            .to_string(),
        "callback transaction belongs to another editor"
    );
    drop(other);
    let pending = tx.suspend();
    let mut fresh = editor.transaction();
    assert_eq!(
        callback
            .call(&mut fresh, create, json!(["fresh"]), None)
            .expect_err("other update")
            .to_string(),
        "callback transaction belongs to another update"
    );
    assert_eq!(
        host.call(&mut fresh, create, json!(["fresh"]), None)
            .expect_err("other update")
            .to_string(),
        "callback transaction belongs to another update"
    );
    assert_eq!(
        host.finish_update(&fresh)
            .expect_err("other update")
            .to_string(),
        "callback transaction belongs to another update"
    );
    assert_eq!(
        host.read_field(&mut fresh, 0, "__text")
            .expect_err("other update field")
            .to_string(),
        "callback transaction belongs to another update"
    );
    drop(fresh);
    let mut tx = editor.resume(pending)?;
    assert_eq!(
        callback.call(&mut tx, create, json!(["pending"]), None)?,
        json!({"$h":0,"key":"1","type":"text","ver":1})
    );
    drop(tx);
    host.discard_update()?;
    assert!(host.replay.decode(&json!({"$h":0})).is_err());
    let mut other = peer.transaction();
    assert_eq!(
        host.begin_update(&mut other)
            .expect_err("bound editor")
            .to_string(),
        "API context belongs to another editor"
    );
    drop(other);
    let mut tx = editor.transaction();
    host.begin_update(&mut tx)?;
    assert_eq!(
        callback.call(&mut tx, create, json!(["next"]), None)?,
        json!({"$h":1,"key":"2","type":"text","ver":2})
    );
    host.finish_update(&tx)?;
    assert!(matches!(
        callback.call(&mut tx, create, json!(["publishing"]), None),
        Err(crate::replay::ReplayError::NoActiveEditor)
    ));
    let commit = tx.commit()?;
    host.publish(commit.next.clone())?;
    drop(commit);
    let mut tx = editor.transaction();
    assert!(matches!(
        callback.call(&mut tx, create, json!(["idle"]), None),
        Err(crate::replay::ReplayError::NoActiveEditor)
    ));
    drop(tx);
    assert_eq!(
        host.read_field(&mut peer.transaction(), 1, "__text")
            .expect_err("idle other editor field")
            .to_string(),
        "API context belongs to another editor"
    );
    drop(editor);
    drop(peer);
    assert_eq!(drops.load(Ordering::SeqCst), 0);
    drop(host);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("probe");
    assert!(matches!(
        callback.call(&mut editor.transaction(), create, json!(["freed"]), None),
        Err(crate::replay::ReplayError::NoActiveEditor)
    ));
    Ok(())
}
