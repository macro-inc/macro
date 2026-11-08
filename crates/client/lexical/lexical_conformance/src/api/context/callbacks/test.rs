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

#[test]
fn callback_selection_encoding_reuses_active_and_detached_slots_without_activation() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    let active = callback.selection(&mut tx, SelectionSlot::Active)?;
    let again = callback.selection(&mut tx, SelectionSlot::Active)?;
    assert_eq!(active["$sel"], again["$sel"]);
    assert_eq!(active["kind"], "range");
    let value = tx.selection().expect("active").snapshot_for_foreign_read();
    let detached = tx.detach_selection(value);
    let captured = callback.selection(&mut tx, detached)?;
    let repeated = callback.selection(&mut tx, detached)?;
    assert_eq!(captured["$sel"], repeated["$sel"]);
    assert_ne!(captured["$sel"], active["$sel"]);
    assert_eq!(captured["kind"], "range");
    assert_eq!(
        callback.selection(&mut tx, SelectionSlot::Active)?["$sel"],
        active["$sel"]
    );
    let id = captured["$sel"].as_u64().expect("selection handle");
    let decoded = context.replay.decode(&json!({"$sel":id}))?;
    let slot = super::super::super::lexical::slot_arg(&context.replay, &mut tx, &decoded)?;
    assert_eq!(slot, detached);
    assert_eq!(tx.anchor_at(slot)?.offset(), 1);
    assert_eq!(tx.focus_at(slot)?.offset(), 2);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn replacement_before_callback_allocates_a_new_handle_and_detaches_the_old_object() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(1)))?;
    let old = callback.selection(&mut tx, SelectionSlot::Active)?;
    tx.replace_selection(Some(Selection::Range(RangeSelection::collapsed(
        Point::text(text, Utf16Offset(2)),
    ))))?;
    let new = callback.selection(&mut tx, SelectionSlot::Active)?;
    assert_ne!(old["$sel"], new["$sel"]);
    let old_value = context.replay.decode(&old)?;
    let old_slot = crate::api::lexical::slot_arg(&context.replay, &mut tx, &old_value)?;
    assert_eq!(tx.anchor_at(old_slot)?.offset(), 3);
    assert_eq!(tx.focus_at(old_slot)?.offset(), 1);
    let new_value = context.replay.decode(&new)?;
    let new_slot = crate::api::lexical::slot_arg(&context.replay, &mut tx, &new_value)?;
    assert_eq!(new_slot, SelectionSlot::Active);
    assert_eq!(tx.anchor_at(new_slot)?.offset(), 2);
    tx.activate_foreign_selection(old_slot)?;
    let reactivated = callback.selection(&mut tx, SelectionSlot::Active)?;
    assert_eq!(reactivated["$sel"], old["$sel"]);
    let old_value = context.replay.decode(&old)?;
    assert_eq!(
        crate::api::lexical::slot_arg(&context.replay, &mut tx, &old_value)?,
        SelectionSlot::Active
    );
    let new_value = context.replay.decode(&new)?;
    let retired_new = crate::api::lexical::slot_arg(&context.replay, &mut tx, &new_value)?;
    assert_ne!(retired_new, SelectionSlot::Active);
    assert_eq!(tx.anchor_at(retired_new)?.offset(), 2);
    Ok(())
}
