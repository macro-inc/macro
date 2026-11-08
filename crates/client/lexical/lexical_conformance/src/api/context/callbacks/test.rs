use super::*;
use lexical_model::*;
use serde_json::json;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

#[test]
fn pure_model_hooks_read_captured_fields_without_reborrowing_the_source_transaction() -> Result<()>
{
    struct Hooks {
        callback: CallbackContext,
        handle: Arc<AtomicU32>,
        calls: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {
        fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            let handle = self.handle.load(Ordering::SeqCst);
            if handle == u32::MAX {
                return Override::Inherit;
            }
            let snapshot = node.state.snapshot_for_foreign_read().expect("capture");
            let indent = self
                .callback
                .read_field(&snapshot, handle, "__indent")
                .expect("raw field");
            assert_eq!(
                indent,
                node.state.element_data(node.key).expect("element").indent
            );
            assert_eq!(
                self.callback
                    .read_field(&snapshot, handle, "__type")
                    .expect("type"),
                "pure-element"
            );
            self.calls.fetch_add(1, Ordering::SeqCst);
            Override::Value(false)
        }
    }
    let mut context = Context::default();
    let callback = context.callbacks();
    let handle = Arc::new(AtomicU32::new(u32::MAX));
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .foreign_node(ForeignNodeType {
            type_name: "pure-element".into(),
            class_name: "PureElement".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                callback: callback.clone(),
                handle: handle.clone(),
                calls: calls.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let key = tx.create_foreign("pure-element", serde_json::Map::new())?;
    tx.append(NodeKey::ROOT, &[key])?;
    tx.set_indent(key, 3)?;
    let raw = context.replay.node(tx.view(), key)?;
    let node = context.encode(raw)?;
    assert_eq!(node["$h"], 0);
    handle.store(0, Ordering::SeqCst);
    assert!(!tx.is_inline(key));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let captured = tx.view().snapshot_for_foreign_read()?;
    tx.set_indent(key, 4)?;
    assert_eq!(callback.read_field(&captured, 0, "__indent")?, 3);
    assert!(!tx.is_inline(key));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    tx.flush()?;
    context.finish_update(&tx)?;
    let publishing = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(callback.read_field(&publishing, 0, "__indent")?, 4);
    let root = crate::api::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    assert!(callback.call(&mut tx, root, json!([]), None).is_err());
    let commit = tx.commit()?;
    context.publish(commit.next)?;
    assert!(callback.read_field(&publishing, 0, "__indent").is_err());
    Ok(())
}

#[test]
fn pure_raw_field_capability_rejects_originless_wrong_editor_stale_and_freed_captures() -> Result<()>
{
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut other = editor.create_conformance_peer(EditorMode::Headless)?;
    let create = crate::api::index()
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    context.call(&mut tx, create, json!(["pending"]), None)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(callback.read_field(&capture, 0, "__text")?, "pending");
    let other_tx = other.transaction();
    let wrong = other_tx.view().snapshot_for_foreign_read()?;
    assert!(callback.read_field(&wrong, 0, "__text").is_err());
    let plain = tx.committed_state().view().snapshot_for_foreign_read()?;
    assert!(callback.read_field(&plain, 0, "__text").is_err());
    drop(other_tx);
    drop(tx);
    context.discard_update()?;
    assert!(callback.read_field(&capture, 0, "__text").is_err());
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    assert!(callback.read_field(&capture, 0, "__text").is_err());
    let new = tx.view().snapshot_for_foreign_read()?;
    assert!(callback.read_field(&new, 0, "__text").is_err());
    drop(tx);
    context.discard_update()?;
    drop(context);
    assert!(callback.read_field(&new, 0, "__text").is_err());
    Ok(())
}

#[test]
fn returned_nodes_require_live_node_handles_and_the_exact_update() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut other = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let key = tx.create_text("returned")?.key();
    let encoded = callback.node(&tx, key)?;
    assert_eq!(callback.returned_node(&tx, &encoded)?, key);
    assert!(callback.returned_node(&tx, &Value::Null).is_err());
    assert!(
        callback
            .returned_node(&tx, &json!({"$key":0,"raw":"1"}))
            .is_err()
    );
    assert!(callback.returned_node(&tx, &json!({"$h":999})).is_err());
    assert!(
        callback
            .returned_node(&other.transaction(), &encoded)
            .is_err()
    );
    let capture = tx.view().snapshot_for_foreign_read()?;
    capture.with_read_transaction(tx.committed_state(), |peer| -> Result<()> {
        assert!(callback.returned_node(peer, &encoded).is_err());
        Ok(())
    })??;
    drop(tx);
    context.discard_update()?;
    let tx = editor.transaction();
    assert!(callback.returned_node(&tx, &encoded).is_err());
    Ok(())
}
