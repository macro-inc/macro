use crate::{EditorType, NodeClock, nodes::*, surface};
use lexical_model::*;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

fn command(editor: &Editor, name: &str, json: &str) -> Result<Command, Error> {
    surface::decode_command(name, json, editor.state().max_key().generation(), None)?
        .ok_or(Error::Invariant("creation await command is not registered"))
}

#[test]
fn creation_await_insert_preserves_expanded_text_and_the_source_caret() -> Result<(), Error> {
    for (anchor, focus, previous, expected_left, expected_right) in [
        (2, 2, false, "ab", "cd"),
        (1, 3, false, "abc ", "d"),
        (3, 1, false, "abc ", "d"),
        (2, 2, true, "ab", "cd"),
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("Macro surface");
        let (paragraph, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("abcd")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.select_end(text)?;
            tx.set_text_node_range(text, Utf16Offset(anchor), text, Utf16Offset(focus))?;
            Ok(p.key())
        })?;
        let insert = command(
            &editor,
            "group-b.creation-await-insert",
            r#"{"awaitId":"fixture-await","text":"Creating fixture"}"#,
        )?;
        let (handled, commit) = if previous {
            editor.update(|tx| {
                tx.set_selection(None)?;
                tx.dispatch(&insert)
            })?
        } else {
            editor.dispatch(&insert)?
        };
        assert_eq!(handled, Handled::Yes);
        assert_eq!(commit.tags, TagSet::default());
        let view = editor.state().view();
        let children: Vec<_> = view.children(paragraph).collect();
        assert_eq!(children.len(), 3);
        assert_eq!(view.text_content(children[0]), expected_left);
        assert_eq!(view.text_content(children[2]), expected_right);
        let node = view.get_or_err::<AwaitNode>(children[1])?;
        assert_eq!(node.await_id.as_deref(), Some("fixture-await"));
        assert_eq!(node.text.as_deref(), Some("Creating fixture"));
        assert!(node.inline);
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("Source caret");
        assert!(range.is_collapsed());
        assert_eq!(range.anchor, Point::text(children[2], Utf16Offset::ZERO));
    }
    Ok(())
}

#[test]
fn creation_await_empty_root_wraps_once_without_an_extra_select_end() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("Macro surface");
    let insert = command(
        &editor,
        "group-b.creation-await-insert",
        r#"{"awaitId":"empty","text":""}"#,
    )?;
    assert_eq!(editor.dispatch(&insert)?.0, Handled::Yes);
    let view = editor.state().view();
    let children: Vec<_> = view.children(NodeKey::ROOT).collect();
    assert_eq!(children.len(), 1);
    let paragraph = children[0];
    assert!(view.get::<Paragraph>(paragraph).is_some());
    let nested: Vec<_> = view.children(paragraph).collect();
    assert_eq!(nested.len(), 1);
    assert!(view.get::<AwaitNode>(nested[0]).is_some());
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("Source caret");
    assert_eq!(range.anchor, Point::element(paragraph, ChildIndex(1)));
    assert_eq!(range.anchor, range.focus);
    Ok(())
}

#[test]
fn creation_await_selected_node_replaces_but_empty_node_selection_errors() -> Result<(), Error> {
    for empty in [false, true] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("Macro surface");
        let (paragraph, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let old = create_await_node(tx, Some("old".into()), Some("Old".into()), true)?;
            tx.append(p, &[old.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let mut selection = NodeSelection::new();
            if !empty {
                selection.add(old.key());
            }
            tx.replace_selection(Some(Selection::Node(selection)))?;
            Ok(p.key())
        })?;
        let before = editor.state().view().export_json(NodeKey::ROOT)?;
        let insert = command(
            &editor,
            "group-b.creation-await-insert",
            r#"{"awaitId":"new","text":"Creating fixture"}"#,
        )?;
        if empty {
            assert!(
                editor
                    .update(|tx| {
                        tx.replace_selection(Some(Selection::Node(NodeSelection::new())))?;
                        tx.dispatch(&insert)
                    })
                    .is_err()
            );
            assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
        } else {
            assert_eq!(editor.dispatch(&insert)?.0, Handled::Yes);
            let view = editor.state().view();
            let children: Vec<_> = view.children(paragraph).collect();
            assert_eq!(children.len(), 1);
            assert_eq!(
                view.get_or_err::<AwaitNode>(children[0])?
                    .await_id
                    .as_deref(),
                Some("new")
            );
            assert_eq!(
                editor
                    .state()
                    .selection()
                    .and_then(Selection::as_range)
                    .expect("caret")
                    .anchor,
                Point::element(paragraph, ChildIndex(1))
            );
        }
    }
    Ok(())
}

#[test]
fn creation_await_pending_expanded_element_keeps_the_source_failure() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("Macro surface");
    let (paragraph, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("abcd")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p.key())
    })?;
    let before = editor.state().view().export_json(NodeKey::ROOT)?;
    let insert = command(
        &editor,
        "group-b.creation-await-insert",
        r#"{"awaitId":"element","text":"Creating fixture"}"#,
    )?;
    assert!(
        editor
            .update(|tx| {
                let range = RangeSelection::new(
                    Point::element(paragraph, ChildIndex(0)),
                    Point::element(paragraph, ChildIndex(1)),
                );
                tx.replace_selection(Some(Selection::Range(range)))?;
                tx.dispatch(&insert)
            })
            .is_err()
    );
    assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
    Ok(())
}

#[test]
fn creation_await_resolve_uses_attached_dfs_and_reads_clock_only_after_target() -> Result<(), Error>
{
    let calls = Arc::new(AtomicUsize::new(0));
    let clock = calls.clone();
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .extension_state(NodeClock(Arc::new(move || {
                clock.fetch_add(1, Ordering::SeqCst);
                1234
            })))
            .build()
            .expect("Macro surface");
    let ((last, first, tail), _) = editor.update(|tx| {
        let last = create_await_node(tx, Some("duplicate".into()), Some("Last".into()), true)?;
        let first = create_await_node(tx, Some("duplicate".into()), Some("First".into()), true)?;
        let detached =
            create_await_node(tx, Some("duplicate".into()), Some("Detached".into()), true)?;
        let p = tx.create(Paragraph::default())?;
        let tail = tx.create_text("Tail")?;
        tx.append(p, &[first.key(), tail.key(), last.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        assert!(!tx.is_attached(detached.key()));
        Ok((last.key(), first.key(), tail.key()))
    })?;
    let missing = command(
        &editor,
        "group-b.creation-await-resolve",
        r#"{"awaitId":"missing","replacement":{"documentId":"created","documentName":"Created","blockName":"task"}}"#,
    )?;
    let before = editor.state().view().export_json(NodeKey::ROOT)?;
    assert_eq!(editor.dispatch(&missing)?.0, Handled::Yes);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
    let resolve = command(
        &editor,
        "group-b.creation-await-resolve",
        r#"{"awaitId":"duplicate","replacement":{"documentId":"created","documentName":"Created","blockName":"task","mentionUuid":"issued"}}"#,
    )?;
    let (handled, commit) = editor.dispatch(&resolve)?;
    assert_eq!(handled, Handled::Yes);
    assert_eq!(commit.tags, TagSet::default());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let view = editor.state().view();
    assert!(!view.is_attached(first));
    assert!(view.is_attached(last));
    let paragraph = view.parent(tail).expect("paragraph");
    let replacement = view.first_child(paragraph).expect("replacement");
    let mention = view.get_or_err::<DocumentMentionNode>(replacement)?;
    assert_eq!(mention.document_id.as_deref(), Some("created"));
    assert_eq!(mention.mention_uuid.as_deref(), Some("issued"));
    assert_eq!(mention.created_at, Maybe::Value(1234));
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret")
            .anchor,
        Point::text(tail, Utf16Offset::ZERO)
    );
    Ok(())
}

#[test]
fn creation_await_delete_uses_source_neighbours_and_never_reads_constructor_clock()
-> Result<(), Error> {
    for neighbours in [
        "next",
        "previous",
        "next-decorator",
        "both-next-decorator",
        "previous-decorator",
        "none",
    ] {
        let calls = Arc::new(AtomicUsize::new(0));
        let clock = calls.clone();
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .extension_state(NodeClock(Arc::new(move || {
                    clock.fetch_add(1, Ordering::SeqCst);
                    1234
                })))
                .build()
                .expect("Macro surface");
        let ((paragraph, left, right), _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let target = create_await_node(tx, Some("remove".into()), None, true)?;
            let left = if neighbours == "previous-decorator" {
                create_await_node(tx, Some("left".into()), None, true)?.key()
            } else {
                tx.create_text("Before")?.key()
            };
            let right = if neighbours.contains("decorator") {
                create_await_node(tx, Some("right".into()), None, true)?.key()
            } else {
                tx.create_text("After")?.key()
            };
            if neighbours == "previous"
                || neighbours == "previous-decorator"
                || neighbours == "both-next-decorator"
            {
                tx.append(p, &[left])?;
            }
            tx.append(p, &[target.key()])?;
            if neighbours == "next"
                || neighbours == "next-decorator"
                || neighbours == "both-next-decorator"
            {
                tx.append(p, &[right])?;
            }
            tx.append(NodeKey::ROOT, &[p.key()])?;
            Ok((p.key(), left, right))
        })?;
        let resolve = command(
            &editor,
            "group-b.creation-await-resolve",
            r#"{"awaitId":"remove"}"#,
        )?;
        let (handled, commit) = editor.dispatch(&resolve)?;
        assert_eq!(handled, Handled::Yes);
        assert_eq!(commit.tags, TagSet::default());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let expected = match neighbours {
            "next" => Point::text(right, Utf16Offset::ZERO),
            "previous" | "both-next-decorator" => Point::text(left, Utf16Offset(6)),
            "previous-decorator" => Point::element(paragraph, ChildIndex(1)),
            _ => Point::element(paragraph, ChildIndex(0)),
        };
        let range = editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("caret");
        assert!(range.is_collapsed());
        assert_eq!(range.anchor, expected, "{neighbours}");
    }
    Ok(())
}

#[test]
fn creation_await_decoders_require_closed_outer_and_nested_objects() {
    for (name, payloads) in [
        (
            "group-b.creation-await-insert",
            vec![
                r#"["id","text"]"#,
                "null",
                r#"{"awaitId":"id"}"#,
                r#"{"awaitId":"id","text":null}"#,
                r#"{"awaitId":"id","text":"","extra":1}"#,
            ],
        ),
        (
            "group-b.creation-await-resolve",
            vec![
                r#"["id",null]"#,
                "null",
                r#"{"awaitId":"id","replacement":null}"#,
                r#"{"awaitId":"id","replacement":["doc","Doc","md"]}"#,
                r#"{"awaitId":"id","replacement":{"documentId":"doc","documentName":"Doc","blockName":"agent"}}"#,
                r#"{"awaitId":"id","replacement":{"documentId":"doc","documentName":"Doc","blockName":"md","mentionUuid":null}}"#,
                r#"{"awaitId":"id","replacement":{"documentId":"doc","documentName":"Doc","blockName":"md","extra":1}}"#,
            ],
        ),
    ] {
        for json in payloads {
            assert!(
                surface::decode_command(name, json, 1, None).is_err(),
                "{name}: {json}"
            );
        }
    }
}

#[test]
fn creation_await_stale_generation_has_no_effect() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("Macro surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(p)
    })?;
    let before = editor.state().view().export_json(NodeKey::ROOT)?;
    for (name, json) in [
        (
            "group-b.creation-await-insert",
            r#"{"awaitId":"stale","text":"Late"}"#,
        ),
        ("group-b.creation-await-resolve", r#"{"awaitId":"stale"}"#),
    ] {
        let stale =
            surface::decode_command(name, json, editor.state().max_key().generation() + 1, None)?
                .expect("actual command");
        assert_eq!(editor.dispatch(&stale)?.0, Handled::No);
        assert_eq!(editor.state().view().export_json(NodeKey::ROOT)?, before);
    }
    Ok(())
}
