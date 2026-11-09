use super::*;
use lexical_model::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

#[test]
fn ending_a_stale_read_does_not_publish_ancestor_selection_values() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let index = crate::api::index();
    let selection = index
        .binary_search(&"lexical.$getSelection")
        .expect("selection") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    let handle = callback.selection(&mut tx, SelectionSlot::Active)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    tx.set_point(PointRole::Anchor, Point::text(text, Utf16Offset(3)))?;
    context.replay.capture_slots(&tx)?;
    callback.with_read_scope(&capture, |scope| {
        let value = scope.call(selection, json!([]), None)?;
        assert_eq!(value["$sel"], handle["$sel"]);
        let point = scope.call(anchor, json!([]), Some(value))?;
        assert_eq!(scope.call(offset, json!([]), Some(point))?, 1);
        Ok(())
    })?;
    let id = context.replay.decode(&handle)?["$selection"]
        .as_u64()
        .expect("id") as usize;
    let saved = context.replay.selections.values()?;
    assert_eq!(
        saved[id]
            .as_ref()
            .expect("saved")
            .as_range()
            .expect("range")
            .anchor
            .offset(),
        3
    );
    assert_eq!(tx.anchor()?.offset(), 3);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn owned_values_persist_across_calls_and_hydrate_without_replacing_parent_slots() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let index = crate::api::index();
    let create = index
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let set = index.binary_search(&"Selection.set").expect("set") as u32;
    let clone = index.binary_search(&"Selection.clone").expect("clone") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    let current = callback.selection(&mut tx, SelectionSlot::Active)?;
    let activation = context.replay.selections.active()?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    let unrelated = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(2),
    ))));
    let unrelated_handle = callback.selection(&mut tx, unrelated)?;
    let key = text.to_string();
    context.replay.bindings.bind_key(key.clone(), text)?;
    let created = callback.with_read_scope(&capture, |scope| {
        let value = scope.call(create, json!([]), None)?;
        let point = scope.call(anchor, json!([]), Some(value.clone()))?;
        scope.call(set, json!([key, 3, "text"]), Some(point.clone()))?;
        assert_eq!(scope.call(offset, json!([]), Some(point))?, 3);
        let cloned = scope.call(clone, json!([]), Some(value.clone()))?;
        assert_ne!(cloned["$sel"], value["$sel"]);
        let point = scope.call(anchor, json!([]), Some(cloned))?;
        scope.call(set, json!([key, 4, "text"]), Some(point.clone()))?;
        assert_eq!(scope.call(offset, json!([]), Some(point))?, 4);
        assert_eq!(context.replay.selections.active()?, activation);
        Ok(value)
    })?;
    assert_ne!(created["$sel"], current["$sel"]);
    assert_ne!(created["$sel"], unrelated_handle["$sel"]);
    let point = context.call(&mut tx, anchor, json!([]), Some(created.clone()))?;
    assert_eq!(context.call(&mut tx, offset, json!([]), Some(point))?, 3);
    assert_eq!(tx.anchor_at(unrelated)?.offset(), 2);
    assert_eq!(tx.anchor()?.offset(), 1);
    assert_eq!(
        callback.selection(&mut tx, SelectionSlot::Active)?["$sel"],
        current["$sel"]
    );
    assert_eq!(context.replay.selections.active()?, activation);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn read_scopes_reject_model_effects_and_inherited_value_writes_before_dispatch() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let index = crate::api::index();
    let create = index
        .binary_search(&"lexical.$createTextNode")
        .expect("create") as u32;
    let parse = index
        .binary_search(&"lexical.$parseSerializedNode")
        .expect("parse") as u32;
    let mutate = index
        .binary_search(&"LexicalNode.setTextContent")
        .expect("mutate") as u32;
    let select = index
        .binary_search(&"lexical.$setSelection")
        .expect("select") as u32;
    let tag = index.binary_search(&"lexical.$addUpdateTag").expect("tag") as u32;
    let command = index
        .binary_search(&"LexicalEditor.dispatchCommand")
        .expect("command") as u32;
    let task = index
        .binary_search(&"lexical/LexicalUtils.scheduleMicroTask")
        .expect("task") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let set = index.binary_search(&"Selection.set").expect("set") as u32;
    let set_range = index
        .binary_search(&"Selection.setTextNodeRange")
        .expect("range") as u32;
    let get_text = index
        .binary_search(&"LexicalNode.getTextContent")
        .expect("text") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("unchanged")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(2)))?;
    let node = callback.node(&tx, text)?;
    let selection = callback.selection(&mut tx, SelectionSlot::Active)?;
    let activation = context.replay.selections.active()?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    callback.with_read_scope(&capture, |scope| {
        assert!(scope.call(create, json!(["forbidden"]), None).is_err());
        assert!(
            scope
                .call(
                    parse,
                    json!([{"type":"text","version":1,"text":"forbidden"}]),
                    None
                )
                .is_err()
        );
        assert!(
            scope
                .call(mutate, json!(["changed"]), Some(node.clone()))
                .is_err()
        );
        assert!(
            scope
                .call_native(mutate, json!(["changed"]), node.clone())
                .is_err()
        );
        assert!(scope.call(select, json!([null]), None).is_err());
        assert!(scope.call(tag, json!(["history-push"]), None).is_err());
        assert!(
            scope
                .call(
                    command,
                    json!([{"$cmd":"DELETE_CHARACTER_COMMAND"}, true]),
                    None
                )
                .is_err()
        );
        assert!(scope.call(task, json!([{"$tape":0}]), None).is_err());
        let point = scope.call(anchor, json!([]), Some(selection.clone()))?;
        assert!(
            scope
                .call(set, json!([text.to_string(), 5, "text"]), Some(point))
                .is_err()
        );
        assert!(
            scope
                .call(set_range, json!([node, 5, node, 6]), Some(selection))
                .is_err()
        );
        assert_eq!(
            scope.call(get_text, json!([]), Some(node.clone()))?,
            "unchanged"
        );
        assert_eq!(
            scope.read_field(node["$h"].as_u64().expect("handle") as u32, "__text")?,
            "unchanged"
        );
        assert!(scope.context.replay.microtasks.is_empty());
        Ok(())
    })?;
    assert_eq!(tx.text_content(text), "unchanged");
    assert_eq!(tx.anchor()?.offset(), 1);
    assert_eq!(tx.focus()?.offset(), 2);
    assert!(!tx.has_tag(&UpdateTag::HistoryPush));
    assert_eq!(context.replay.selections.active()?, activation);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn caught_read_errors_retain_new_values_but_stale_scopes_cannot_hydrate_them() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let index = crate::api::index();
    let create = index
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let set = index.binary_search(&"Selection.set").expect("set") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    let mut handle = Value::Null;
    let result: Result<()> = callback.with_read_scope(&capture, |scope| {
        handle = scope.call(create, json!([]), None)?;
        let point = scope.call(anchor, json!([]), Some(handle.clone()))?;
        scope.call(set, json!(["root", 7, "element"]), Some(point))?;
        Err(fail("callback exception"))
    });
    assert_eq!(
        result.expect_err("scope failure").to_string(),
        "callback exception"
    );
    let point = context.call(&mut tx, anchor, json!([]), Some(handle.clone()))?;
    assert_eq!(
        context.call(&mut tx, offset, json!([]), Some(point.clone()))?,
        7
    );
    callback.with_read_scope(&capture, |scope| {
        assert!(scope.call(anchor, json!([]), Some(handle.clone())).is_err());
        assert!(
            scope
                .call(set, json!(["root", 9, "element"]), Some(point.clone()))
                .is_err()
        );
        Ok(())
    })?;
    assert_eq!(
        context.call(&mut tx, offset, json!([]), Some(point.clone()))?,
        7
    );
    context.call(
        &mut tx,
        set,
        json!(["root", 9, "element"]),
        Some(point.clone()),
    )?;
    context.replay.capture_slots(&tx)?;
    callback.with_read_scope(&capture, |scope| {
        assert!(scope.call(anchor, json!([]), Some(handle.clone())).is_err());
        Ok(())
    })?;
    assert_eq!(context.call(&mut tx, offset, json!([]), Some(point))?, 9);
    let id = context.replay.decode(&handle)?["$selection"]
        .as_u64()
        .expect("id") as usize;
    let values = context.replay.selections.values()?;
    assert_eq!(
        values[id]
            .as_ref()
            .expect("saved")
            .as_range()
            .expect("range")
            .anchor
            .offset(),
        9
    );
    assert!(tx.selection().is_none());
    assert!(context.replay.selections.active()?.is_none());
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn nested_read_scopes_cannot_modify_or_publish_an_outer_scopes_new_value() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let index = crate::api::index();
    let create = index
        .binary_search(&"lexical.$createRangeSelection")
        .expect("create") as u32;
    let anchor = index.binary_search(&"get:anchor").expect("anchor") as u32;
    let offset = index.binary_search(&"get:offset").expect("offset") as u32;
    let set = index.binary_search(&"Selection.set").expect("set") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    let value = callback.with_read_scope(&capture, |outer| {
        let value = outer.call(create, json!([]), None)?;
        let point = outer.call(anchor, json!([]), Some(value.clone()))?;
        outer.call(set, json!(["root", 4, "element"]), Some(point.clone()))?;
        let nested = outer.tx.view().snapshot_for_foreign_read()?;
        callback.with_read_scope(&nested, |inner| {
            assert_eq!(inner.call(offset, json!([]), Some(point.clone()))?, 4);
            assert!(
                inner
                    .call(set, json!(["root", 9, "element"]), Some(point.clone()))
                    .is_err()
            );
            Ok(())
        })?;
        let id = outer.context.replay.decode(&value)?["$selection"]
            .as_u64()
            .expect("id") as usize;
        assert!(outer.context.replay.selections.values()?[id].is_none());
        callback.with_read_scope(&capture, |inner| {
            assert!(inner.call(offset, json!([]), Some(point.clone())).is_err());
            Ok(())
        })?;
        assert!(outer.context.replay.selections.values()?[id].is_none());
        assert_eq!(outer.call(offset, json!([]), Some(point))?, 4);
        Ok(value)
    })?;
    let point = context.call(&mut tx, anchor, json!([]), Some(value))?;
    assert_eq!(context.call(&mut tx, offset, json!([]), Some(point))?, 4);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn pure_node_hooks_make_nested_indexed_reads_without_borrowing_the_source_transaction() -> Result<()>
{
    struct Hooks {
        callback: CallbackContext,
        calls: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {
        fn is_inline(&self, node: NodeView<'_>, _: &ForeignData) -> Override<bool> {
            let index = crate::api::index();
            let root = index.binary_search(&"lexical.$getRoot").expect("root") as u32;
            let inline = index
                .binary_search(&"LexicalNode.isInline")
                .expect("inline") as u32;
            let capture = node.state.snapshot_for_foreign_read().expect("capture");
            self.callback
                .with_read_scope(&capture, |scope| {
                    let root = scope.call(root, json!([]), None)?;
                    assert_eq!(scope.call_native(inline, json!([]), root)?, false);
                    Ok(())
                })
                .expect("pure read");
            self.calls.fetch_add(1, Ordering::SeqCst);
            Override::Value(true)
        }
    }
    let mut context = Context::default();
    let callback = context.callbacks();
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "read-inline".into(),
            class_name: "ReadInline".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                callback: callback.clone(),
                calls: calls.clone(),
            }),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let key = tx.create_foreign("read-inline", serde_json::Map::new())?;
    let node = callback.node(&tx, key)?;
    let inline = crate::api::index()
        .binary_search(&"LexicalNode.isInline")
        .expect("inline") as u32;
    assert!(tx.is_inline(key));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let capture = tx.view().snapshot_for_foreign_read()?;
    callback.with_read_scope(&capture, |scope| {
        assert_eq!(scope.call(inline, json!([]), Some(node))?, true);
        Ok(())
    })?;
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn read_scope_provenance_rejects_other_editors_and_closed_updates_including_open_scopes()
-> Result<()> {
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut other = editor.create_conformance_peer(EditorMode::Headless)?;
    let root = crate::api::index()
        .binary_search(&"lexical.$getRoot")
        .expect("root") as u32;
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    let other_tx = other.transaction();
    let wrong = other_tx.view().snapshot_for_foreign_read()?;
    assert!(callback.with_read_scope(&wrong, |_| Ok(())).is_err());
    let plain = tx.committed_state().view().snapshot_for_foreign_read()?;
    assert!(callback.with_read_scope(&plain, |_| Ok(())).is_err());
    drop(other_tx);
    tx.flush()?;
    context.finish_update(&tx)?;
    callback.with_read_scope(&capture, |scope| {
        assert_eq!(scope.call(root, json!([]), None)?["key"], "root");
        Ok(())
    })?;
    drop(tx);
    callback
        .with_read_scope(&capture, |scope| {
            context.discard_update()?;
            assert!(scope.call(root, json!([]), None).is_err());
            Ok(())
        })
        .expect_err("closed scope cannot publish values");
    assert!(callback.with_read_scope(&capture, |_| Ok(())).is_err());
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    assert!(callback.with_read_scope(&capture, |_| Ok(())).is_err());
    let fresh = tx.view().snapshot_for_foreign_read()?;
    drop(tx);
    context.discard_update()?;
    drop(context);
    assert!(callback.with_read_scope(&fresh, |_| Ok(())).is_err());
    Ok(())
}

#[test]
fn read_peer_encodes_source_records_and_consumes_exact_indexed_arguments() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let first = tx.create_text("first")?.key();
    let second = tx.create_text("second")?.key();
    let handle = callback.node(&tx, first)?;
    let capture = tx.view().snapshot_for_foreign_read()?;
    let _arguments = context.frames.arguments.enter(
        first,
        ForeignHook::AdjustExportJson,
        vec![json!("original")],
    );
    callback.with_read_scope(&capture, |scope| {
        assert_eq!(scope.node(first)?, json!({"$h": handle["$h"]}));
        assert_eq!(
            scope.original_arguments(second, ForeignHook::AdjustExportJson)?,
            None
        );
        assert_eq!(
            scope.original_arguments(first, ForeignHook::AdjustExportJson)?,
            Some(vec![json!("original")])
        );
        assert_eq!(
            scope.original_arguments(first, ForeignHook::AdjustExportJson)?,
            None
        );
        let id = integer(&handle["$h"])? as u32;
        assert_eq!(scope.read_field(id, "__text")?, "first");
        Ok(())
    })?;
    assert_eq!(tx.view().text_data(first)?.text.as_str(), "first");
    drop(tx);
    context.discard_update()?;
    Ok(())
}

#[test]
fn native_selection_arguments_keep_distinct_shape_equal_host_objects() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut context = Context::default();
    let callback = context.callbacks();
    let mut tx = editor.transaction();
    context.begin_update(&mut tx)?;
    let text = tx.create_text("text")?.key();
    let first_slot = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(text, Utf16Offset(1)),
        Point::text(text, Utf16Offset(3)),
    )));
    let second_slot = tx.detach_selection(
        tx.selection_at(first_slot)?
            .expect("first")
            .snapshot_for_foreign_read(),
    );
    let first = callback.selection(&mut tx, first_slot)?;
    let second = callback.selection(&mut tx, second_slot)?;
    assert_ne!(first["$sel"], second["$sel"]);
    let first_argument = tx
        .capture_foreign_selection(first_slot)?
        .expect("first argument");
    let second_argument = tx
        .capture_foreign_selection(second_slot)?
        .expect("second argument");
    let capture = tx
        .view()
        .with_foreign_selection_argument(&first_argument)
        .snapshot_for_foreign_read()?;
    callback.with_read_scope(&capture, |scope| {
        assert_eq!(
            scope.selection_argument(&first_argument)?["$sel"],
            first["$sel"]
        );
        assert_eq!(
            scope.selection_argument(&second_argument)?["$sel"],
            second["$sel"]
        );
        let anchor = crate::api::index()
            .binary_search(&"get:anchor")
            .expect("anchor") as u32;
        let offset = crate::api::index()
            .binary_search(&"get:offset")
            .expect("offset") as u32;
        let point = scope.call(anchor, json!([]), Some(first.clone()))?;
        assert_eq!(scope.call(offset, json!([]), Some(point))?, 1);
        Ok(())
    })?;
    drop(tx);
    context.discard_update()?;
    Ok(())
}
