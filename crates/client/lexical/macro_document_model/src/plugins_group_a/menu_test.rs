use lexical_model::*;
use serde_json::json;

#[test]
fn menu_answers_cannot_cut_surrogates_cross_generations_or_replace_composition() -> Result<(), Error>
{
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("😀 @p")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        tx.select_end(text)?;
        Ok(text.key())
    })?;
    for (offset, expected, generation, composing) in [
        (1, "😀 @p", key.generation(), false),
        (3, "@p", key.generation() + 1, false),
        (3, "@p", key.generation(), true),
        (3, "@person", key.generation(), false),
    ] {
        editor.update(|tx| tx.set_composition_key(composing.then_some(key)))?;
        let before = editor.state().to_json()?;
        let command = super::menu::decode_command(
            "group-a.menu-select",
            &json!({
                "key":key.index(), "offset":offset, "expected":expected,
                "choice":{"kind":"text","payload":"changed"}
            })
            .to_string(),
            generation,
        )?
        .expect("command");
        assert_eq!(editor.dispatch(&command)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
        assert_eq!(editor.state().root_text_content().as_ref(), "😀 @p");
    }
    Ok(())
}

#[test]
fn emoji_answer_preserves_utf16_prefix_tail_and_rejects_replay() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("😀 :smile tail")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::text(text, Utf16Offset(9)),
            focus: Point::text(text, Utf16Offset(9)),
            resolution_dirty: false,
        })?;
        Ok(text.key())
    })?;
    let command = super::menu::decode_command(
        "group-a.menu-select",
        &json!({
            "key":key.index(),"offset":3,"expected":":smile","choice":{"kind":"text","payload":"😃"}
        })
        .to_string(),
        key.generation(),
    )?
    .expect("menu command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    assert_eq!(editor.state().root_text_content().as_ref(), "😀 😃 tail");
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("caret");
    assert_eq!(range.anchor, Point::text(key, Utf16Offset(5)));
    assert_eq!(range.focus, range.anchor);
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().root_text_content().as_ref(), "😀 😃 tail");
    Ok(())
}

#[test]
fn late_mention_rejects_moved_caret_and_retains_literal_then_inserts_typed_identity()
-> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .build()
    .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("@person")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::text(text, Utf16Offset(0)),
            focus: Point::text(text, Utf16Offset(0)),
            resolution_dirty: false,
        })?;
        Ok(text.key())
    })?;
    let command = super::menu::decode_command("group-a.menu-select", &json!({
        "key":key.index(),"offset":0,"expected":"@person","choice":{"kind":"user","payload":{
            "userId":"fixture-user","email":"user@example.com","displayName":"Person","mentionUuid":"fixture-mention"
        }}
    }).to_string(), key.generation())?.expect("menu command");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().root_text_content().as_ref(), "@person");
    editor.update(|tx| {
        tx.selection_from_view(ViewSelection::Range {
            anchor: Point::text(key, Utf16Offset(7)),
            focus: Point::text(key, Utf16Offset(7)),
            resolution_dirty: false,
        })
    })?;
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("paragraph");
    let mention = view
        .children_keys(p)?
        .into_iter()
        .find_map(|key| view.get::<crate::nodes::UserMentionNode>(key))
        .expect("typed mention");
    assert_eq!(mention.user_id.as_deref(), Some("fixture-user"));
    assert_eq!(mention.email.as_deref(), Some("user@example.com"));
    assert_eq!(mention.mention_uuid.as_deref(), Some("fixture-mention"));
    assert_eq!(mention.display_name, "Person");
    Ok(())
}

#[test]
fn snippet_blocks_replace_the_sole_paragraph_and_preserve_inline_or_root_placement()
-> Result<(), Error> {
    for (literal, offset, snippets, expected) in [
        (
            ";s",
            0,
            json!([{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"one"}]},{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"two"}]}]),
            "one\n\ntwo",
        ),
        (
            "before ;s after",
            7,
            json!([{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"inside"}]}]),
            "before inside after",
        ),
        (
            "before ;s after",
            7,
            json!([{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"one"}]},{"type":"paragraph","version":1,"children":[{"type":"text","version":1,"text":"two"}]}]),
            "before  after\n\none\n\ntwo",
        ),
    ] {
        let mut editor = crate::surface::preset_builder_with_mode(
            crate::EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .build()
        .expect("surface");
        let (key, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text(literal)?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            tx.selection_from_view(ViewSelection::Range {
                anchor: Point::text(text, Utf16Offset(offset + 2)),
                focus: Point::text(text, Utf16Offset(offset + 2)),
                resolution_dirty: false,
            })?;
            Ok(text.key())
        })?;
        let command = super::menu::decode_command("group-a.menu-select", &json!({
            "key":key.index(),"offset":offset,"expected":";s","choice":{"kind":"snippet","payload":snippets}
        }).to_string(), key.generation())?.expect("menu command");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        assert_eq!(editor.state().root_text_content().as_ref(), expected);
        let view = editor.state().view();
        for p in view.children_keys(NodeKey::ROOT)? {
            assert!(
                view.children_keys(p)?
                    .into_iter()
                    .all(|key| !view.is::<Paragraph>(key))
            );
        }
    }
    Ok(())
}

#[test]
fn async_snippet_resolves_only_the_live_placeholder_with_source_placement_and_history_merge()
-> Result<(), Error> {
    for (literal, offset, snippets, expected) in [
        (
            ";s",
            0,
            json!([{"type":"paragraph","children":[{"type":"text","text":"one"}]},{"type":"paragraph","children":[{"type":"text","text":"two"}]}]),
            "one\n\ntwo",
        ),
        (
            "before ;s after",
            7,
            json!([{"type":"paragraph","children":[{"type":"text","text":"inside"}]}]),
            "before inside after",
        ),
        (
            "before ;s after",
            7,
            json!([{"type":"paragraph","children":[{"type":"text","text":"one"}]},{"type":"paragraph","children":[{"type":"text","text":"two"}]}]),
            "before  after\n\none\n\ntwo",
        ),
    ] {
        let mut editor = crate::surface::preset_builder_with_mode(
            crate::EditorType::MarkdownSync,
            EditorMode::ViewAttached,
        )
        .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
            vec![1; length]
        })))
        .build()
        .expect("surface");
        let (key, _) = editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text(literal)?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[text.key()])?;
            let point = Point::text(text, Utf16Offset(offset + 2));
            tx.selection_from_view(ViewSelection::Range {
                anchor: point,
                focus: point,
                resolution_dirty: false,
            })?;
            Ok(text.key())
        })?;
        let before = editor.state().to_json()?;
        let self_insert = super::menu::decode_command("group-a.menu-select", &json!({
            "key":key.index(),"offset":offset,"expected":";s",
            "choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture","sourceDocumentId":"snippet-fixture"}}
        }).to_string(), key.generation())?.expect("self guard");
        assert_eq!(editor.dispatch(&self_insert)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, before);
        let start = super::menu::decode_command("group-a.menu-select", &json!({
            "key":key.index(),"offset":offset,"expected":";s",
            "choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture","sourceDocumentId":"target-fixture"}}
        }).to_string(), key.generation())?.expect("start");
        let (handled, commit) = editor.dispatch(&start)?;
        assert_eq!(handled, Handled::Yes);
        assert_eq!(commit.events.len(), 1);
        let request = crate::surface::event_payload(&commit.events[0])?.expect("host request");
        assert_eq!(request["documentId"], "snippet-fixture");
        let placeholder = editor
            .state()
            .view()
            .nodes_of_type::<crate::nodes::AwaitNode>()[0]
            .key();
        assert_eq!(request["key"], placeholder.index());
        assert_eq!(request["generation"], placeholder.generation());
        let await_id = editor
            .state()
            .get::<crate::nodes::AwaitNode>(placeholder)
            .expect("pending")
            .await_id
            .as_deref()
            .expect("identity");
        assert_eq!(await_id.len(), 21);
        assert_eq!(request["awaitId"], await_id);
        let resolve = super::menu::decode_command(
            "group-a.snippet-resolve",
            &json!({
                "key":placeholder.index(),"awaitId":await_id,"nodes":snippets
            })
            .to_string(),
            placeholder.generation(),
        )?
        .expect("resolve");
        let (handled, commit) = editor.dispatch(&resolve)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.tags.contains(&UpdateTag::HistoryMerge));
        assert_eq!(editor.state().root_text_content().as_ref(), expected);
        assert!(
            editor
                .state()
                .view()
                .nodes_of_type::<crate::nodes::AwaitNode>()
                .is_empty()
        );
        let completed = editor.state().to_json()?;
        assert_eq!(editor.dispatch(&resolve)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, completed);
    }
    Ok(())
}

#[test]
fn async_snippet_rejects_wrong_identity_generation_and_deleted_placeholder() -> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
        vec![2; length]
    })))
    .build()
    .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text(";s")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        tx.select_end(text)?;
        Ok(text.key())
    })?;
    let start = super::menu::decode_command(
        "group-a.menu-select",
        &json!({
            "key":key.index(),"offset":0,"expected":";s",
            "choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture"}}
        })
        .to_string(),
        key.generation(),
    )?
    .expect("start");
    let (_, commit) = editor.dispatch(&start)?;
    let request = crate::surface::event_payload(&commit.events[0])?.expect("host request");
    let placeholder = editor
        .state()
        .view()
        .nodes_of_type::<crate::nodes::AwaitNode>()[0]
        .key();
    let pending = editor.state().to_json()?;
    for (await_id, generation) in [
        (json!("wrong"), placeholder.generation()),
        (request["awaitId"].clone(), placeholder.generation() + 1),
    ] {
        let answer = super::menu::decode_command("group-a.snippet-resolve", &json!({
            "key":placeholder.index(),"awaitId":await_id,"nodes":[{"type":"paragraph","children":[{"type":"text","text":"late"}]}]
        }).to_string(), generation)?.expect("late answer");
        assert_eq!(editor.dispatch(&answer)?.0, Handled::No);
        assert_eq!(editor.state().to_json()?, pending);
    }
    editor.update(|tx| tx.remove(placeholder, false))?;
    let removed = editor.state().to_json()?;
    let answer = super::menu::decode_command("group-a.snippet-resolve", &json!({
        "key":placeholder.index(),"awaitId":request["awaitId"],"nodes":[{"type":"paragraph","children":[{"type":"text","text":"late"}]}]
    }).to_string(), placeholder.generation())?.expect("removed answer");
    assert_eq!(editor.dispatch(&answer)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, removed);
    Ok(())
}

#[test]
fn async_snippet_empty_or_failed_content_removes_pending_node_at_the_adjacent_caret()
-> Result<(), Error> {
    let mut editor = crate::surface::preset_builder_with_mode(
        crate::EditorType::MarkdownSync,
        EditorMode::ViewAttached,
    )
    .extension_state(crate::NodeRandom(std::sync::Arc::new(|length| {
        vec![3; length]
    })))
    .build()
    .expect("surface");
    let (key, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before ;s after")?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.append(p, &[text.key()])?;
        let point = Point::text(text, Utf16Offset(9));
        tx.selection_from_view(ViewSelection::Range {
            anchor: point,
            focus: point,
            resolution_dirty: false,
        })?;
        Ok(text.key())
    })?;
    let start = super::menu::decode_command("group-a.menu-select", &json!({
        "key":key.index(),"offset":7,"expected":";s","choice":{"kind":"snippet-start","payload":{"documentId":"snippet-fixture"}}
    }).to_string(), key.generation())?.expect("start");
    let (_, commit) = editor.dispatch(&start)?;
    let request = crate::surface::event_payload(&commit.events[0])?.expect("host request");
    let answer = super::menu::decode_command(
        "group-a.snippet-resolve",
        &json!({
            "key":request["key"],"awaitId":request["awaitId"],"nodes":[]
        })
        .to_string(),
        key.generation(),
    )?
    .expect("failed answer");
    let (_, commit) = editor.dispatch(&answer)?;
    assert!(commit.tags.contains(&UpdateTag::HistoryMerge));
    assert!(
        editor
            .state()
            .view()
            .nodes_of_type::<crate::nodes::AwaitNode>()
            .is_empty()
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "before  after");
    let caret = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("caret");
    assert_eq!(caret.anchor, caret.focus);
    assert_eq!(caret.anchor, Point::text(key, Utf16Offset(7)));
    Ok(())
}
