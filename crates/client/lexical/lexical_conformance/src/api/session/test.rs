use super::*;
use lexical_model::*;
use serde_json::json;

#[test]
fn commit_flushes_only_when_the_last_successful_flush_was_invalidated() -> Result<()> {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn selection_transform(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
        ) -> Override<std::result::Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(Ok(()))
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "flush-count".into(),
            class_name: "FlushCount".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    host.begin_update(TagSet::default())?;
    let text = host.with_update(|_, tx| {
        let paragraph = tx.create(Paragraph::default())?.key();
        let text = tx.create_foreign("flush-count", SerializedNode::new())?;
        tx.text(text)?.set_text_content("text")?;
        tx.append(paragraph, &[text])?;
        tx.append(NodeKey::ROOT, &[paragraph])?;
        tx.text(text)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
        Ok(text)
    })?;
    host.commit()?;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    host.begin_update(TagSet::default())?;
    host.flush()?;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    host.commit()?;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    host.begin_update(TagSet::default())?;
    host.flush()?;
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    host.with_update(|_, tx| {
        tx.text(text)?.set_text_content("updated")?;
        Ok(())
    })?;
    host.commit()?;
    assert_eq!(calls.load(Ordering::SeqCst), 4);
    Ok(())
}

#[test]
fn failed_packet_preparation_keeps_the_committed_version_and_invalidates_pending_handles()
-> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let paragraph = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    host.begin_update(TagSet::default())?;
    let p = host.call(paragraph, json!([]), None)?;
    let r = host.call(root, json!([]), None)?;
    host.call(append, json!([p.clone()]), Some(r))?;
    let error = host
        .commit_prepared::<()>(|commit, version| {
            assert_eq!(version, 1);
            assert!(!commit.next.is_empty_state());
            Err(fail("packet preparation failed"))
        })
        .expect_err("preparation error");
    assert_eq!(error.to_string(), "packet preparation failed");
    assert!(host.state().is_empty_state());
    assert_eq!(host.committed_version(), 0);
    assert!(
        host.read_field(p["$h"].as_u64().expect("handle") as u32, "__type")
            .is_err()
    );
    host.begin_update(TagSet::default())?;
    let p = host.call(paragraph, json!([]), None)?;
    let r = host.call(root, json!([]), None)?;
    host.call(append, json!([p]), Some(r))?;
    let (commit, artifact) = host.commit_prepared(|commit, version| {
        assert_eq!(version, 2);
        Ok(commit.next.to_json()?)
    })?;
    assert_eq!(host.committed_version(), 2);
    assert_eq!(host.state().to_json()?, artifact);
    assert_eq!(commit.id, CommitId(2));
    Ok(())
}

#[test]
fn closing_noop_retains_detached_values_without_burning_a_model_commit() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let create = super::super::index()
        .binary_search(&"lexical.$createRangeSelection")
        .expect("selection") as u32;
    let collapsed = super::super::index()
        .binary_search(&"Selection.isCollapsed")
        .expect("collapsed") as u32;
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let paragraph = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    host.begin_update(TagSet::default())?;
    let selection = host.call(create, json!([]), None)?;
    assert!(host.finish_noop()?);
    assert!(host.flush().is_err());
    host.begin_update(TagSet::default())?;
    assert_eq!(host.call(collapsed, json!([]), Some(selection))?, true);
    let root = host.call(root, json!([]), None)?;
    let p = host.call(paragraph, json!([]), None)?;
    host.call(append, json!([p]), Some(root))?;
    assert!(!host.finish_noop()?);
    assert_eq!(host.commit()?.id, CommitId(1));
    Ok(())
}

#[test]
fn captured_unattached_nodes_keep_raw_fields_after_collection_until_version_release() -> Result<()>
{
    static FLAG: StateKey<bool> = StateKey::new("flag", |value| {
        value.and_then(Value::as_bool).unwrap_or(false)
    });
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    let get = super::super::index()
        .binary_search(&"lexical.$getNodeByKey")
        .expect("get") as u32;
    let latest = super::super::index()
        .binary_search(&"LexicalNode.getLatest")
        .expect("latest") as u32;
    let get_type = super::super::index()
        .binary_search(&"LexicalNode.getType")
        .expect("type") as u32;
    let equivalent = super::super::index()
        .binary_search(&"lexical.nodeStatesAreEquivalent")
        .expect("state equality") as u32;
    let mut tags = TagSet::default();
    tags.insert("orphan".parse().expect("tag"));
    host.begin_update(tags)?;
    let orphan = host.call(create, json!(["before"]), None)?;
    assert_eq!(orphan["$h"], 0);
    host.call(set, json!(["last"]), Some(orphan.clone()))?;
    let other = host.call(create, json!(["other"]), None)?;
    assert_eq!(other["$h"], 1);
    host.with_update(|_, tx| {
        tx.set_state(
            NodeKey::from_parts(KeyParts {
                generation: 0,
                index: 1,
            }),
            &FLAG,
            true,
        )?;
        tx.set_state(
            NodeKey::from_parts(KeyParts {
                generation: 0,
                index: 2,
            }),
            &FLAG,
            true,
        )?;
        Ok(())
    })?;
    host.flush()?;
    assert_eq!(host.call(get, json!(["1"]), None)?, Value::Null);
    assert_eq!(host.read_field(0, "__text")?, "last");
    assert_eq!(host.read_field(0, "__parent")?, Value::Null);
    assert_eq!(
        host.call(get_type, json!([]), Some(orphan.clone()))?,
        "text"
    );
    let left = host.read_field(0, "__state")?;
    let right = host.read_field(1, "__state")?;
    assert_eq!(
        host.call(equivalent, json!([left.clone(), right.clone()]), None)?,
        true
    );
    assert!(host.call(latest, json!([]), Some(orphan.clone())).is_err());
    host.commit()?;
    assert!(host.state().is_empty_state());
    assert_eq!(host.read_field(0, "__text")?, "last");
    assert_eq!(host.read_field(0, "__type")?, "text");
    host.begin_update(TagSet::default())?;
    assert_eq!(host.call(get, json!(["1"]), None)?, Value::Null);
    assert_eq!(host.read_field(0, "__text")?, "last");
    assert_eq!(host.call(equivalent, json!([left, right]), None)?, true);
    host.discard_update()?;
    host.release_version(1)?;
    assert!(host.read_field(0, "__text").is_err());
    Ok(())
}

#[test]
fn retired_writable_fields_do_not_replace_historical_captures() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("before")?.key();
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p])
    })?;
    let mut host = Session::new(editor);
    let get = super::super::index()
        .binary_search(&"lexical.$getNodeByKey")
        .expect("get") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    let remove = super::super::index()
        .binary_search(&"LexicalNode.remove")
        .expect("remove") as u32;
    host.begin_update(TagSet::default())?;
    let root_api = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let children = super::super::index()
        .binary_search(&"LexicalNode.getChildren")
        .expect("children") as u32;
    let root = host.call(root_api, json!([]), None)?;
    let p = host.call(children, json!([]), Some(root))?[0].clone();
    let historical = host.call(children, json!([]), Some(p))?[0].clone();
    let writable = host.call(set, json!(["last"]), Some(historical.clone()))?;
    let old = historical["$h"].as_u64().expect("historical handle") as u32;
    let new = writable["$h"].as_u64().expect("writable handle") as u32;
    assert_ne!(old, new);
    host.call(remove, json!([]), Some(writable))?;
    host.flush()?;
    assert_eq!(host.call(get, json!(["2"]), None)?, Value::Null);
    assert_eq!(host.read_field(old, "__text")?, "before");
    assert_eq!(host.read_field(new, "__text")?, "last");
    host.commit()?;
    assert_eq!(host.read_field(old, "__text")?, "before");
    assert_eq!(host.read_field(new, "__text")?, "last");
    host.begin_update(TagSet::default())?;
    assert_eq!(host.call(get, json!(["2"]), None)?, Value::Null);
    assert_eq!(host.read_field(old, "__text")?, "before");
    assert_eq!(host.read_field(new, "__text")?, "last");
    host.discard_update()?;
    host.release_version(0)?;
    assert!(host.read_field(old, "__text").is_err());
    assert_eq!(host.read_field(new, "__text")?, "last");
    host.release_version(1)?;
    assert!(host.read_field(new, "__text").is_err());
    Ok(())
}

#[test]
fn host_calls_publish_only_at_commit_and_keep_caught_errors_inside_the_update() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let paragraph = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let text = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    let content = super::super::index()
        .binary_search(&"LexicalNode.getTextContent")
        .expect("content") as u32;
    assert!(host.call(text, json!(["outside"]), None).is_err());
    let mut tags = TagSet::default();
    tags.insert("host-update".parse().expect("tag"));
    host.begin_update(tags)?;
    assert!(host.begin_update(TagSet::default()).is_err());
    let root = host.call(root, json!([]), None)?;
    let p = host.call(paragraph, json!([]), None)?;
    let t = host.call(text, json!(["hello 🌍"]), None)?;
    host.call(append, json!([t]), Some(p.clone()))?;
    host.call(append, json!([p]), Some(root))?;
    assert!(host.call(u32::MAX, json!([]), None).is_err());
    host.flush()?;
    assert_eq!(host.state().root_text_content().as_ref(), "");
    assert_eq!(
        host.call(content, json!([]), Some(json!({"$h":2})))?,
        "hello 🌍"
    );
    let commit = host.commit()?;
    assert!(commit.tags.contains(&"host-update".parse().expect("tag")));
    assert_eq!(commit.next.root_text_content().as_ref(), "hello 🌍");
    assert_eq!(host.state().root_text_content().as_ref(), "hello 🌍");
    assert_eq!(host.read_field(2, "__text")?, "hello 🌍");
    assert!(host.commit().is_err());
    assert!(host.flush().is_err());
    Ok(())
}

#[test]
fn host_rollback_invalidates_handles_and_does_not_reuse_global_keys() -> Result<()> {
    let keys = SharedKeyCounter::new();
    let editor = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .build()
        .expect("editor");
    let other = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .build()
        .expect("other editor");
    let mut host = Session::new(editor);
    let mut other = Session::new(other);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    host.begin_update(TagSet::default())?;
    let abandoned = host.call(create, json!(["abandoned"]), None)?;
    assert_eq!(abandoned["key"], "1");
    host.discard_update()?;
    assert!(host.read_field(0, "__text").is_err());
    assert!(host.discard_update().is_err());
    other.begin_update(TagSet::default())?;
    let second = other.call(create, json!(["other"]), None)?;
    assert_eq!(second["key"], "2");
    host.begin_update(TagSet::default())?;
    let third = host.call(create, json!(["next"]), None)?;
    assert_eq!(third["key"], "3");
    assert_eq!(host.state().root_text_content().as_ref(), "");
    host.discard_update()?;
    other.discard_update()?;
    Ok(())
}

#[test]
fn stale_resumption_discards_host_bookkeeping_and_allows_a_new_update() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    host.begin_update(TagSet::default())?;
    host.call(create, json!(["stale"]), None)?;
    host.editor.transaction().commit()?;
    assert!(matches!(
        host.call(create, json!(["lost"]), None),
        Err(crate::replay::ReplayError::Model(
            Error::StaleSuspendedUpdate
        ))
    ));
    assert!(host.pending.is_none());
    assert!(host.read_field(0, "__text").is_err());
    host.begin_update(TagSet::default())?;
    let next = host.call(create, json!(["new"]), None)?;
    assert_eq!(next["key"], "2");
    assert_eq!(
        host.read_field(next["$h"].as_u64().expect("handle") as u32, "__text")?,
        "new"
    );
    host.discard_update()?;
    Ok(())
}

#[test]
fn commit_transform_failure_rolls_back_writes_and_invalidates_only_pending_handles() -> Result<()> {
    struct Reject;
    impl ForeignTransform for Reject {
        fn transform(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
        ) -> std::result::Result<(), Error> {
            tx.text(key)?.set_text_content("rejected")?;
            Err(Error::NodeNotFound(key))
        }
    }
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("before")?.key();
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p])
    })?;
    let reject = editor.register_foreign_transform("text", std::sync::Arc::new(Reject))?;
    let mut host = Session::new(editor);
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let children = super::super::index()
        .binary_search(&"LexicalNode.getChildren")
        .expect("children") as u32;
    let set = super::super::index()
        .binary_search(&"LexicalNode.setTextContent")
        .expect("set") as u32;
    host.begin_update(TagSet::default())?;
    let root = host.call(root, json!([]), None)?;
    let p = host.call(children, json!([]), Some(root))?[0].clone();
    let text = host.call(children, json!([]), Some(p))?[0].clone();
    let writable = host.call(set, json!(["changed"]), Some(text.clone()))?;
    assert_ne!(writable["$h"], text["$h"]);
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let orphan = host.call(create, json!(["discarded"]), None)?;
    host.with_update(|_, tx| Ok(tx.flush_with(FlushMode::NormalizeOnly)?))?;
    assert_eq!(
        host.read_field(orphan["$h"].as_u64().expect("handle") as u32, "__text")?,
        "discarded"
    );
    // A completed normalize-only flush needs a new write before commit runs
    // the default pipeline again (S1 §7.1).
    host.call(set, json!(["changed again"]), Some(writable.clone()))?;
    assert!(matches!(
        host.commit(),
        Err(crate::replay::ReplayError::Model(Error::NodeNotFound(_)))
    ));
    assert_eq!(host.state().root_text_content().as_ref(), "before");
    assert_eq!(
        host.read_field(text["$h"].as_u64().expect("handle") as u32, "__text")?,
        "before"
    );
    assert!(
        host.read_field(writable["$h"].as_u64().expect("handle") as u32, "__text")
            .is_err()
    );
    assert!(
        host.read_field(orphan["$h"].as_u64().expect("handle") as u32, "__text")
            .is_err()
    );
    host.editor.unregister_foreign_transform(reject);
    host.begin_update(TagSet::default())?;
    host.call(set, json!(["after"]), Some(text))?;
    assert_eq!(host.call(create, json!(["fresh"]), None)?["key"], "4");
    host.commit()?;
    assert_eq!(host.state().root_text_content().as_ref(), "after");
    Ok(())
}

#[test]
fn configured_context_transform_reenters_the_owned_session_and_commits_once() -> Result<()> {
    struct Transform {
        callback: crate::api::CallbackContext,
    }
    impl ForeignTransform for Transform {
        fn transform(
            &self,
            tx: &mut Transaction<'_>,
            key: NodeKey,
        ) -> std::result::Result<(), Error> {
            let result = (|| -> Result<()> {
                let get = super::super::index()
                    .binary_search(&"lexical.$getNodeByKey")
                    .expect("get") as u32;
                let content = super::super::index()
                    .binary_search(&"LexicalNode.getTextContent")
                    .expect("content") as u32;
                let set = super::super::index()
                    .binary_search(&"LexicalNode.setTextContent")
                    .expect("set") as u32;
                let node = self
                    .callback
                    .call(tx, get, json!([key.to_string()]), None)?;
                assert_eq!(self.callback.node(tx, key)?["$h"], node["$h"]);
                if self
                    .callback
                    .call(tx, content, json!([]), Some(node.clone()))?
                    == "a"
                {
                    self.callback.call(tx, set, json!(["b"]), Some(node))?;
                    let create = super::super::index()
                        .binary_search(&"lexical.$createTextNode")
                        .expect("create") as u32;
                    let orphan = self.callback.call(tx, create, json!(["first"]), None)?;
                    assert_eq!(orphan["$h"], 4);
                    tx.text(NodeKey::from_parts(KeyParts {
                        generation: 0,
                        index: 3,
                    }))?
                    .set_text_content("last")?;
                }
                Ok(())
            })();
            result.map_err(|error| Error::invariant(error.to_string()))
        }
    }
    let context = Context::default();
    let callback = context.callbacks();
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    editor.register_foreign_transform("text", std::sync::Arc::new(Transform { callback }))?;
    let mut host = Session::with_context(editor, context)?;
    let create = super::super::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("text") as u32;
    let paragraph = super::super::index()
        .binary_search(&"lexical.$createParagraphNode")
        .expect("paragraph") as u32;
    let root = super::super::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let append = super::super::index()
        .binary_search(&"LexicalNode.append")
        .expect("append") as u32;
    host.begin_update(TagSet::default())?;
    let text = host.call(create, json!(["a"]), None)?;
    assert_eq!(text, json!({"$h":0,"key":"1","type":"text","ver":1}));
    let paragraph = host.call(paragraph, json!([]), None)?;
    host.call(append, json!([text]), Some(paragraph.clone()))?;
    let root = host.call(root, json!([]), None)?;
    host.call(append, json!([paragraph]), Some(root))?;
    assert_eq!(host.state().root_text_content().as_ref(), "");
    host.flush()?;
    assert_eq!(host.state().root_text_content().as_ref(), "");
    assert_eq!(host.read_field(0, "__text")?, "b");
    assert_eq!(host.read_field(4, "__text")?, "last");
    let commit = host.commit()?;
    assert_eq!(commit.id, CommitId(1));
    assert_eq!(commit.next.root_text_content().as_ref(), "b");
    assert_eq!(host.state().root_text_content().as_ref(), "b");
    assert_eq!(host.read_field(4, "__text")?, "last");
    Ok(())
}

#[test]
fn configured_session_rejects_active_contexts_and_another_editor_binding() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let other = editor.create_conformance_peer(EditorMode::Headless)?;
    let mut context = Context::default();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    drop(tx);
    context.discard_update()?;
    match Session::with_context(other, context) {
        Ok(_) => panic!("bound context must reject another editor"),
        Err(error) => assert_eq!(error.to_string(), "API context belongs to another editor"),
    }
    let mut context = Context::default();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    drop(tx);
    match Session::with_context(editor, context) {
        Ok(_) => panic!("active context must reject attachment"),
        Err(error) => assert_eq!(error.to_string(), "an API update is already active"),
    }
    Ok(())
}

#[test]
fn detached_direction_memo_survives_host_boundaries_but_explicit_clone_clears_it() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    let create = crate::api::index()
        .binary_search(&"lexical.$createRangeSelection")
        .expect("range") as u32;
    let backward = crate::api::index()
        .binary_search(&"Selection.isBackward")
        .expect("backward") as u32;
    let cached = crate::api::index()
        .binary_search(&"get:_cachedIsBackward")
        .expect("cache") as u32;
    let clone = crate::api::index()
        .binary_search(&"Selection.clone")
        .expect("clone") as u32;
    host.begin_update(TagSet::default())?;
    let selection = host.call(create, json!([]), None)?;
    assert_eq!(
        host.call(backward, json!([]), Some(selection.clone()))?,
        false
    );
    assert_eq!(
        host.call(cached, json!([]), Some(selection.clone()))?,
        false
    );
    assert!(host.finish_noop()?);
    host.begin_update(TagSet::default())?;
    assert_eq!(
        host.call(cached, json!([]), Some(selection.clone()))?,
        false
    );
    let copy = host.call(clone, json!([]), Some(selection.clone()))?;
    assert_eq!(host.call(cached, json!([]), Some(copy))?, Value::Null);
    host.discard_update()?;
    host.begin_update(TagSet::default())?;
    assert_eq!(host.call(cached, json!([]), Some(selection))?, false);
    assert!(host.finish_noop()?);
    Ok(())
}

mod state;

mod failure;
